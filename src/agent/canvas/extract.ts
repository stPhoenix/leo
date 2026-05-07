import type { Logger } from '@/platform/Logger';
import type {
  ChatMessage,
  OpenAITool,
  ProviderChatRequest,
  ProviderTraceContext,
  StreamEvent,
} from '@/providers/types';
import { createSemaphore, type Semaphore } from '@/agent/wiki/ingest/semaphore';
import { runBatched } from '@/agent/wiki/ingest/runBatched';
import { CANVAS_BUDGETS } from './budgets';
import { CANVAS_LOG } from './loggingNamespaces';
import { getCanvasExtractorSystemPrompt } from './extractPrompt';
import { ExtractorOutput, type EntityTypeDef, type RelationTypeDef } from './schemas';
import type { ExtractorOutput as ExtractorOutputT } from './schemas';
import type { FetchedCanvasItem } from './fetch';
import { chunkCanvasBody, type CanvasChunk } from './chunker';
import { mergeChunkOutputs } from './extractMerge';

const REPORT_EXTRACTION_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'report_extraction',
    description: [
      'Emit extracted entities and edges as a single JSON payload.',
      '',
      'Each entity MUST have: tempId (short string id like "e1","e2"... unique within this call), type (one of the supplied entityTypes.name), name (string).',
      'Each edge MUST have: fromTempId (string referencing an entity.tempId in this call), toTempId (string referencing an entity.tempId in this call), type (one of the supplied relationTypes.name).',
      'fromTempId / toTempId are NOT free-form names — they are entity tempIds you assigned in the entities array of this same call.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        schemaVersion: { type: 'number' },
        sourceRef: { type: 'string' },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tempId: {
                type: 'string',
                description: 'short unique id within this call (e.g. "e1")',
              },
              type: {
                type: 'string',
                description: 'must equal one of the supplied entityTypes.name',
              },
              name: { type: 'string' },
              fields: {
                type: 'object',
                description:
                  'free-form structured attributes. For ordinal-series entities (commandments, parables, articles, chapters), include `position` as an integer 1..N when the source numbers them.',
              },
              definedIn: {
                type: 'string',
                description:
                  'Canonical defining resource for this entity when the source body explicitly references one — wikilink ([[name]]), URL (https://…), or vault path (wiki/pages/foo.md). Used by the reducer to deduplicate cross-source name divergence. Omit when no such link exists in the body.',
              },
            },
            required: ['tempId', 'type', 'name'],
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fromTempId: { type: 'string', description: 'entity.tempId from the entities array' },
              toTempId: { type: 'string', description: 'entity.tempId from the entities array' },
              type: {
                type: 'string',
                description: 'must equal one of the supplied relationTypes.name',
              },
              label: { type: 'string' },
            },
            required: ['fromTempId', 'toTempId', 'type'],
          },
        },
      },
      required: ['schemaVersion', 'sourceRef', 'entities', 'edges'],
    },
  },
};

export interface CanvasExtractorProvider {
  stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface RunExtractorsDeps {
  readonly provider: CanvasExtractorProvider;
  readonly model: () => string;
  readonly temperature?: () => number;
  readonly maxTokens?: () => number;
  readonly logger?: Logger;
  readonly semaphoreOverride?: Semaphore;
  readonly chunkSemaphoreOverride?: Semaphore;
}

export interface RunExtractorsInput {
  readonly items: readonly FetchedCanvasItem[];
  readonly schema: {
    readonly entityTypes: readonly EntityTypeDef[];
    readonly relationTypes: readonly RelationTypeDef[];
  };
  readonly originalAsk: string;
  readonly signal: AbortSignal;
  readonly traceConfig?: ProviderTraceContext;
}

export interface ExtractorPerSourceError {
  readonly ref: string;
  readonly code: 'extract_invalid' | 'aborted' | 'extract_failed';
  readonly message: string;
}

export interface RunExtractorsResult {
  readonly outputs: ReadonlyMap<string, ExtractorOutputT>;
  readonly perSourceErrors: readonly ExtractorPerSourceError[];
}

export async function runExtractors(
  input: RunExtractorsInput,
  deps: RunExtractorsDeps,
): Promise<RunExtractorsResult> {
  const semaphore =
    deps.semaphoreOverride ??
    createSemaphore({ maxConcurrency: CANVAS_BUDGETS.extractorConcurrency });
  const outputs = new Map<string, ExtractorOutputT>();
  const errors: ExtractorPerSourceError[] = [];

  const fetchedItems = input.items.filter((it) => it.status === 'fetched' && it.fetched);

  await Promise.all(
    fetchedItems.map(async (item) => {
      const ref = item.fetched!.sourceRef;
      let release: (() => void) | null = null;
      try {
        release = await semaphore.acquire(input.signal);
      } catch {
        errors.push({ ref, code: 'aborted', message: 'aborted' });
        return;
      }
      try {
        if (input.signal.aborted) {
          errors.push({ ref, code: 'aborted', message: 'aborted' });
          return;
        }
        const result = await extractSource(item, input, deps);
        if (result.kind === 'ok') {
          outputs.set(ref, result.output);
          return;
        }
        if (result.kind === 'empty') {
          return;
        }
        if (result.kind === 'aborted') {
          errors.push({ ref, code: 'aborted', message: 'aborted' });
          return;
        }
        errors.push({ ref, code: 'extract_invalid', message: result.error });
        deps.logger?.warn(CANVAS_LOG.create.extract.failed, {
          ref,
          code: 'extract_invalid',
          error: result.error,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = input.signal.aborted ? 'aborted' : 'extract_failed';
        errors.push({ ref, code, message });
      } finally {
        if (release !== null) release();
      }
    }),
  );

  return { outputs, perSourceErrors: errors };
}

interface ExtractAttemptOk {
  readonly kind: 'ok';
  readonly output: ExtractorOutputT;
}
interface ExtractAttemptInvalid {
  readonly kind: 'invalid';
  readonly error: string;
}
type ExtractSourceResult =
  | ExtractAttemptOk
  | ExtractAttemptInvalid
  | { readonly kind: 'aborted' }
  | { readonly kind: 'empty' };

async function extractSource(
  item: FetchedCanvasItem,
  input: RunExtractorsInput,
  deps: RunExtractorsDeps,
): Promise<ExtractSourceResult> {
  const fetched = item.fetched!;
  const ref = fetched.sourceRef;
  const chunks = chunkCanvasBody({
    body: fetched.body,
    ...(fetched.contentType !== undefined ? { contentType: fetched.contentType } : {}),
    targetTokens: CANVAS_BUDGETS.extractorChunkSizeTokens,
    overlapTokens: CANVAS_BUDGETS.extractorChunkOverlapTokens,
    maxChunks: CANVAS_BUDGETS.chunksPerSourceMax,
  });
  if (chunks.length === 0) return { kind: 'empty' };
  if (chunks.length > 1) {
    deps.logger?.info('canvas.extract.chunked', { ref, chunkCount: chunks.length });
  }

  const total = chunks.length;
  const chunkSem =
    deps.chunkSemaphoreOverride ??
    createSemaphore({ maxConcurrency: CANVAS_BUDGETS.chunkConcurrency });

  let results: readonly (ExtractAttemptOk | ExtractAttemptInvalid)[];
  try {
    results = await runBatched(
      chunks,
      chunkSem,
      (chunk, signal) => extractOneChunk(item, chunk, total, input, deps, signal),
      input.signal,
    );
  } catch (err) {
    if (input.signal.aborted) return { kind: 'aborted' };
    throw err;
  }

  const oks = results.filter((r): r is ExtractAttemptOk => r.kind === 'ok');
  if (oks.length === 0) {
    const detail = results
      .map((r, i) => `chunk[${i}]: ${r.kind === 'invalid' ? r.error : 'ok'}`)
      .join('; ');
    return { kind: 'invalid', error: detail };
  }
  if (oks.length < results.length) {
    deps.logger?.warn('canvas.extract.partial', {
      ref,
      ok: oks.length,
      total: results.length,
    });
  }
  const merged = mergeChunkOutputs({
    sourceRef: ref,
    chunkOutputs: oks.map((r) => r.output),
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  });
  return { kind: 'ok', output: merged };
}

async function extractOneChunk(
  item: FetchedCanvasItem,
  chunk: CanvasChunk,
  total: number,
  input: RunExtractorsInput,
  deps: RunExtractorsDeps,
  signal: AbortSignal,
): Promise<ExtractAttemptOk | ExtractAttemptInvalid> {
  const ref = item.fetched!.sourceRef;
  const headerLines: string[] = [`sourceRef: ${ref}`, `chunk: ${chunk.index + 1}/${total}`];
  if (chunk.headingPath.length > 0) {
    headerLines.push(`headingPath: ${chunk.headingPath.join(' > ')}`);
  }
  const userContent = `${headerLines.join('\n')}\n\n---\n${chunk.text}`;

  const baseMessages: ChatMessage[] = [
    {
      role: 'system',
      content: getCanvasExtractorSystemPrompt({
        entityTypes: input.schema.entityTypes,
        relationTypes: input.schema.relationTypes,
        originalAsk: input.originalAsk,
      }),
    },
    { role: 'user', content: userContent },
  ];

  const first = await invokeOnce(baseMessages, ref, input, deps, signal);
  if (first.kind === 'ok') return first;

  const retryMessages: ChatMessage[] = [
    ...baseMessages,
    {
      role: 'assistant',
      content: 'The previous extraction failed schema validation.',
    },
    {
      role: 'user',
      content: `Validation error: ${first.error}. Re-emit report_extraction with a corrected payload (remember caps: entities ≤ 100, edges ≤ 200).`,
    },
  ];
  return invokeOnce(retryMessages, ref, input, deps, signal);
}

async function invokeOnce(
  messages: readonly ChatMessage[],
  ref: string,
  input: RunExtractorsInput,
  deps: RunExtractorsDeps,
  signal: AbortSignal,
): Promise<ExtractAttemptOk | ExtractAttemptInvalid> {
  const req: ProviderChatRequest = {
    model: deps.model(),
    messages,
    ...(deps.temperature !== undefined ? { temperature: deps.temperature() } : {}),
    maxTokens: deps.maxTokens !== undefined ? deps.maxTokens() : CANVAS_BUDGETS.extractorOutputCap,
    tools: [REPORT_EXTRACTION_TOOL],
    ...(input.traceConfig !== undefined ? { trace: input.traceConfig } : {}),
  };
  const collected = await collectStream(deps.provider.stream(req, signal), signal);
  const call = collected.toolCalls.find((c) => c.name === 'report_extraction');
  if (call === undefined) {
    return { kind: 'invalid', error: 'no report_extraction tool call' };
  }
  const parsed = tryParseJson(call.argsJson);
  if (parsed === null) {
    deps.logger?.debug(CANVAS_LOG.create.extract.failed, {
      ref,
      stage: 'invalid_extract_candidate',
      error: 'arg_json_unparseable',
      candidateJson: safeStringify(call.argsJson, 4096),
    });
    return { kind: 'invalid', error: 'arg_json_unparseable' };
  }
  const candidate = withDefaults(parsed, ref);
  const validation = ExtractorOutput.safeParse(candidate);
  if (!validation.success) {
    const error = validation.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    deps.logger?.debug(CANVAS_LOG.create.extract.failed, {
      ref,
      stage: 'invalid_extract_candidate',
      error,
      candidateJson: safeStringify(candidate, 4096),
    });
    return { kind: 'invalid', error };
  }
  const filtered = filterToSchema(validation.data, input.schema, ref, deps.logger);
  return { kind: 'ok', output: filtered };
}

/**
 * Drop any entity whose `type` is not in the refine-emitted entityTypes, and
 * any edge whose `type` is not in relationTypes or whose endpoints reference
 * a dropped entity. The schema is the structural relevance filter — if refine
 * narrowed it to "commandment, case, testament", the extractor cannot inject
 * "parable" or "sin" nodes even if the LLM ignored the prompt rule.
 */
function filterToSchema(
  output: ExtractorOutputT,
  schema: RunExtractorsInput['schema'],
  ref: string,
  logger: Logger | undefined,
): ExtractorOutputT {
  const allowedEntityTypes = new Set(schema.entityTypes.map((t) => t.name));
  const allowedRelationTypes = new Set(schema.relationTypes.map((t) => t.name));
  const keptEntities = output.entities.filter((e) => allowedEntityTypes.has(e.type));
  const droppedEntities = output.entities.length - keptEntities.length;
  const keptTempIds = new Set(keptEntities.map((e) => e.tempId));
  const keptEdges = output.edges.filter(
    (e) =>
      allowedRelationTypes.has(e.type) &&
      keptTempIds.has(e.fromTempId) &&
      keptTempIds.has(e.toTempId),
  );
  const droppedEdges = output.edges.length - keptEdges.length;
  if (droppedEntities > 0 || droppedEdges > 0) {
    logger?.debug('canvas.extract.schema_filtered', {
      ref,
      droppedEntities,
      droppedEdges,
      keptEntities: keptEntities.length,
      keptEdges: keptEdges.length,
    });
  }
  return {
    schemaVersion: output.schemaVersion,
    sourceRef: output.sourceRef,
    entities: keptEntities,
    edges: keptEdges,
  };
}

function safeStringify(value: unknown, cap: number): string {
  let s: string;
  try {
    if (typeof value === 'string') {
      s = value;
    } else {
      const j = JSON.stringify(value);
      s = typeof j === 'string' ? j : String(value);
    }
  } catch {
    return '<unserializable>';
  }
  return s.length <= cap ? s : `${s.slice(0, cap)}…`;
}

interface CollectedStream {
  readonly textBuffer: string;
  readonly toolCalls: ReadonlyArray<{ name: string; argsJson: string }>;
}

type ToolBufMap = Map<number, { id: string; name: string; args: string }>;

function applyExtractDelta(
  ev: Extract<ExtractStreamEvent, { type: 'block_delta' }>,
  toolBufs: ToolBufMap,
  textBuffer: string,
): string {
  if (ev.delta?.type === 'input_json_delta') {
    const buf = toolBufs.get(ev.index);
    if (buf !== undefined) buf.args += (ev.delta as { partial_json: string }).partial_json;
    return textBuffer;
  }
  if (ev.delta?.type === 'text_delta') {
    return textBuffer + (ev.delta as { text: string }).text;
  }
  return textBuffer;
}

function flushToolBuf(
  ev: Extract<ExtractStreamEvent, { type: 'block_stop' }>,
  toolBufs: ToolBufMap,
  toolCalls: Array<{ name: string; argsJson: string }>,
): void {
  const buf = toolBufs.get(ev.index);
  if (buf !== undefined) {
    toolCalls.push({ name: buf.name, argsJson: buf.args.length === 0 ? '{}' : buf.args });
    toolBufs.delete(ev.index);
  }
}

async function collectStream(
  stream: AsyncIterable<StreamEvent>,
  signal: AbortSignal,
): Promise<CollectedStream> {
  let textBuffer = '';
  const toolCalls: Array<{ name: string; argsJson: string }> = [];
  const toolBufs: ToolBufMap = new Map();
  for await (const ev of stream as AsyncIterable<ExtractStreamEvent>) {
    if (signal.aborted) break;
    if (ev.type === 'token') textBuffer += ev.text ?? '';
    else if (ev.type === 'tool_call')
      toolCalls.push({ name: ev.call.name, argsJson: ev.call.argsJson });
    else if (ev.type === 'block_start' && ev.block?.type === 'tool_use') {
      const block = ev.block as { id: string; name: string };
      toolBufs.set(ev.index, { id: block.id, name: block.name, args: '' });
    } else if (ev.type === 'block_delta') textBuffer = applyExtractDelta(ev, toolBufs, textBuffer);
    else if (ev.type === 'block_stop') flushToolBuf(ev, toolBufs, toolCalls);
    else if (ev.type === 'done' || ev.type === 'error') break;
  }
  return { textBuffer, toolCalls };
}

function tryParseJson(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function withDefaults(raw: unknown, ref: string): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const out = { ...(raw as Record<string, unknown>) };
  if (out.schemaVersion === undefined) out.schemaVersion = 1;
  if (out.sourceRef === undefined) out.sourceRef = ref;
  return out;
}

type ExtractStreamEvent =
  | { readonly type: 'token'; readonly text?: string }
  | { readonly type: 'tool_call'; readonly call: { name: string; argsJson: string } }
  | {
      readonly type: 'block_start';
      readonly index: number;
      readonly block: { type: string; id?: string; name?: string };
    }
  | {
      readonly type: 'block_delta';
      readonly index: number;
      readonly delta: { type: string; text?: string; partial_json?: string };
    }
  | { readonly type: 'block_stop'; readonly index: number }
  | { readonly type: 'done' }
  | { readonly type: 'error'; readonly error?: Error };
