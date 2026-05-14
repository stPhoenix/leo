import { z } from 'zod';
import type { Logger } from '@/platform/Logger';
import type { ChatMessage, OpenAITool, ProviderChatRequest, StreamEvent } from '@/providers/types';
import { EXTERNAL_AGENT_LOG } from './loggingNamespaces';
import { getPiiDetectSystemPrompt } from '@/prompts/agent/externalAgent/piiDetectPrompt';

export type PiiKind =
  | 'email'
  | 'phone'
  | 'governmentId'
  | 'paymentCard'
  | 'apiKey'
  | 'jwt'
  | 'iban'
  | 'ipAddress'
  | 'urlWithAuth'
  | 'other';

const PII_KINDS: readonly PiiKind[] = [
  'email',
  'phone',
  'governmentId',
  'paymentCard',
  'apiKey',
  'jwt',
  'iban',
  'ipAddress',
  'urlWithAuth',
  'other',
];

export interface PiiFinding {
  readonly id: string;
  readonly kind: PiiKind;
  readonly start: number;
  readonly end: number;
  readonly sample: string;
  readonly suggestion: 'mask' | 'remove';
  readonly note?: string;
}

export interface PiiDetectProvider {
  stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface PiiDetectAgentOptions {
  readonly provider: PiiDetectProvider;
  readonly model: () => string;
  readonly temperature?: () => number;
  readonly maxTokens?: () => number;
  readonly logger?: Logger;
  readonly systemPromptOverride?: () => string;
  readonly chunkBudgetChars?: number;
  readonly chunkOverlapChars?: number;
  readonly maxParallelChunks?: number;
  readonly now?: () => number;
}

export interface PiiDetectAgent {
  detect(text: string, signal: AbortSignal): Promise<readonly PiiFinding[]>;
}

const DEFAULT_CHUNK_BUDGET = 6_000;
const DEFAULT_CHUNK_OVERLAP = 256;
const DEFAULT_MAX_PARALLEL = 3;

const REPORT_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'report_findings',
    description:
      "Report all sensitive substrings present in the supplied text. Each finding's `text` field MUST be a verbatim substring of the input.",
    parameters: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: PII_KINDS,
                description: 'Category of sensitive content.',
              },
              text: {
                type: 'string',
                description: 'Verbatim substring of the input.',
              },
              suggestion: {
                type: 'string',
                enum: ['mask', 'remove'],
                description: 'Recommended treatment.',
              },
              note: {
                type: 'string',
                description: 'Optional one-line rationale (used mainly for kind=other).',
              },
            },
            required: ['kind', 'text', 'suggestion'],
          },
        },
      },
      required: ['findings'],
    },
  },
};

const ReportSchema = z.object({
  findings: z.array(
    z.object({
      kind: z.enum(PII_KINDS as unknown as [PiiKind, ...PiiKind[]]),
      text: z.string().min(1),
      suggestion: z.enum(['mask', 'remove']),
      note: z.string().optional(),
    }),
  ),
});

interface RawFinding {
  readonly kind: PiiKind;
  readonly text: string;
  readonly suggestion: 'mask' | 'remove';
  readonly note?: string;
}

interface Chunk {
  readonly text: string;
  readonly offset: number;
  readonly index: number;
}

class PiiDetectError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PiiDetectError';
    this.code = code;
  }
}

export function createPiiDetectAgent(opts: PiiDetectAgentOptions): PiiDetectAgent {
  const logger = opts.logger;
  const sysPrompt = opts.systemPromptOverride ?? getPiiDetectSystemPrompt;
  const chunkBudget = Math.max(512, opts.chunkBudgetChars ?? DEFAULT_CHUNK_BUDGET);
  const chunkOverlap = Math.max(0, opts.chunkOverlapChars ?? DEFAULT_CHUNK_OVERLAP);
  const maxParallel = Math.max(1, opts.maxParallelChunks ?? DEFAULT_MAX_PARALLEL);
  const now = opts.now ?? ((): number => Date.now());

  return {
    async detect(text: string, signal: AbortSignal): Promise<readonly PiiFinding[]> {
      if (text.trim().length === 0) {
        logger?.debug(EXTERNAL_AGENT_LOG.piiCheck.skipped, { reason: 'empty-prompt' });
        return [];
      }
      const chunks = chunkText(text, chunkBudget, chunkOverlap);
      const startedAt = now();
      const reports = await runWithLimit(
        chunks,
        maxParallel,
        async (chunk) => runOneChunk(chunk, signal, opts, sysPrompt),
        signal,
      );
      if (signal.aborted) return [];
      const merged = mergeFindings(text, reports.flat(), logger);
      const counts: Partial<Record<PiiKind, number>> = {};
      for (const f of merged) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
      logger?.debug(EXTERNAL_AGENT_LOG.piiCheck.scanned, {
        chunkCount: chunks.length,
        durationMs: now() - startedAt,
        total: merged.length,
        counts,
      });
      return merged;
    },
  };
}

async function runOneChunk(
  chunk: Chunk,
  signal: AbortSignal,
  opts: PiiDetectAgentOptions,
  sysPrompt: () => string,
): Promise<readonly RawFinding[]> {
  const messages: ChatMessage[] = [
    { role: 'system', content: sysPrompt() },
    { role: 'user', content: chunk.text },
  ];
  const req: ProviderChatRequest = {
    model: opts.model(),
    messages,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature() } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens() } : {}),
    tools: [REPORT_TOOL],
  };
  const accum = { textBuffer: '', toolCalls: [] as Array<{ name: string; argsJson: string }> };
  const toolBufs = new Map<number, { id: string; name: string; args: string }>();
  try {
    for await (const event of opts.provider.stream(req, signal)) {
      if (signal.aborted) break;
      const outcome = applyPiiStreamEvent(event, accum, toolBufs);
      if (outcome === 'done') {
        return parseChunkOutput(accum.toolCalls, accum.textBuffer, opts.logger, chunk.index);
      }
    }
  } catch (err) {
    if (signal.aborted) return [];
    opts.logger?.warn(EXTERNAL_AGENT_LOG.piiCheck.error, {
      code: err instanceof PiiDetectError ? err.code : 'provider_error',
      chunkIndex: chunk.index,
    });
    throw err instanceof Error ? err : new Error(String(err));
  }
  return parseChunkOutput(accum.toolCalls, accum.textBuffer, opts.logger, chunk.index);
}

interface PiiStreamAccum {
  textBuffer: string;
  toolCalls: Array<{ name: string; argsJson: string }>;
}

function applyPiiStreamEvent(
  event: StreamEvent,
  accum: PiiStreamAccum,
  toolBufs: Map<number, { id: string; name: string; args: string }>,
): 'continue' | 'done' {
  if (event.type === 'token') {
    accum.textBuffer += event.text;
    return 'continue';
  }
  if (event.type === 'tool_call') {
    accum.toolCalls.push({ name: event.call.name, argsJson: event.call.argsJson });
    return 'continue';
  }
  if (event.type === 'block_start') {
    if (event.block.type === 'tool_use') {
      toolBufs.set(event.index, { id: event.block.id, name: event.block.name, args: '' });
    }
    return 'continue';
  }
  if (event.type === 'block_delta') {
    applyPiiBlockDelta(event, accum, toolBufs);
    return 'continue';
  }
  if (event.type === 'block_stop') {
    const buf = toolBufs.get(event.index);
    if (buf !== undefined) {
      accum.toolCalls.push({
        name: buf.name,
        argsJson: buf.args.length === 0 ? '{}' : buf.args,
      });
      toolBufs.delete(event.index);
    }
    return 'continue';
  }
  if (event.type === 'error') throw event.error;
  if (event.type === 'done') return 'done';
  return 'continue';
}

function applyPiiBlockDelta(
  event: Extract<StreamEvent, { type: 'block_delta' }>,
  accum: PiiStreamAccum,
  toolBufs: Map<number, { id: string; name: string; args: string }>,
): void {
  if (event.delta.type === 'text_delta') {
    accum.textBuffer += event.delta.text;
    return;
  }
  if (event.delta.type === 'input_json_delta') {
    const buf = toolBufs.get(event.index);
    if (buf !== undefined) buf.args += event.delta.partial_json;
  }
}

function parseChunkOutput(
  toolCalls: ReadonlyArray<{ name: string; argsJson: string }>,
  textBuffer: string,
  logger: Logger | undefined,
  chunkIndex: number,
): readonly RawFinding[] {
  const call = toolCalls.find((c) => c.name === 'report_findings');
  if (call === undefined) {
    logger?.warn(EXTERNAL_AGENT_LOG.piiCheck.error, {
      code: 'pii_detect_invalid_tool',
      chunkIndex,
      textBufferLen: textBuffer.length,
    });
    throw new PiiDetectError(
      'pii_detect_invalid_tool',
      'pii_detect_invalid_tool: PII detector did not call report_findings',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.argsJson);
  } catch {
    throw new PiiDetectError(
      'pii_detect_invalid_tool',
      'pii_detect_invalid_tool: report_findings args were not valid JSON',
    );
  }
  const result = ReportSchema.safeParse(parsed);
  if (!result.success) {
    throw new PiiDetectError(
      'pii_detect_invalid_tool',
      `pii_detect_invalid_tool: report_findings payload failed validation: ${result.error.message}`,
    );
  }
  return result.data.findings;
}

function mergeFindings(
  originalText: string,
  raws: readonly RawFinding[],
  logger: Logger | undefined,
): readonly PiiFinding[] {
  const byId = new Map<string, PiiFinding>();
  for (const raw of raws) {
    if (raw.text.length === 0) continue;
    let cursor = 0;
    let found = false;
    while (cursor <= originalText.length - raw.text.length) {
      const idx = originalText.indexOf(raw.text, cursor);
      if (idx < 0) break;
      found = true;
      const start = idx;
      const end = idx + raw.text.length;
      const id = stableId(raw.kind, start, end);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          kind: raw.kind,
          start,
          end,
          sample: originalText.slice(start, end),
          suggestion: raw.suggestion,
          ...(raw.note !== undefined && raw.kind === 'other' ? { note: raw.note } : {}),
        });
      }
      cursor = end;
    }
    if (!found) {
      logger?.debug(EXTERNAL_AGENT_LOG.piiCheck.hallucinated, { kind: raw.kind });
    }
  }
  return [...byId.values()].sort((a, b) => a.start - b.start);
}

export function chunkText(text: string, budget: number, overlap: number): readonly Chunk[] {
  if (text.length <= budget) return [{ text, offset: 0, index: 0 }];
  const chunks: Chunk[] = [];
  let cursor = 0;
  let index = 0;
  while (cursor < text.length) {
    const end = Math.min(cursor + budget, text.length);
    let cut = end;
    if (end < text.length) {
      const window = text.slice(cursor, end);
      const para = window.lastIndexOf('\n\n');
      const sentence = window.lastIndexOf('. ');
      const newline = window.lastIndexOf('\n');
      const candidate = Math.max(para, sentence, newline);
      if (candidate > Math.floor(budget * 0.5)) {
        cut = cursor + candidate + 1;
      }
    }
    const slice = text.slice(cursor, cut);
    chunks.push({ text: slice, offset: cursor, index });
    if (cut >= text.length) break;
    cursor = Math.max(cut - overlap, cursor + 1);
    index += 1;
  }
  return chunks;
}

async function runWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal: AbortSignal,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      if (signal.aborted) return;
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  }
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

function stableId(kind: PiiKind, start: number, end: number): string {
  const hashInput = `${kind}:${start}:${end}`;
  return `${kind}-${fnv1a32(hashInput)}`;
}

function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
