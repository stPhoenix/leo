import type { Logger } from '@/platform/Logger';
import type {
  ChatMessage,
  ProviderChatRequest,
  ProviderTraceContext,
  StreamEvent,
} from '@/providers/types';
import { CANVAS_BUDGETS } from './budgets';
import { CANVAS_LOG } from './loggingNamespaces';
import { getCanvasRefineSystemPrompt } from '@/prompts/agent/canvas/refinePrompt';
import { CANVAS_REFINE_TOOLS } from '@/prompts/agent/canvas/refineToolDescriptions';
import { RunPlan } from './schemas';
import type { RunPlan as RunPlanT } from './schemas';

export interface RefineMessage {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string;
}

export interface CanvasRefineProvider {
  stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface CanvasRefineOptions {
  readonly provider: CanvasRefineProvider;
  readonly model: () => string;
  readonly temperature?: () => number;
  readonly maxTokens?: () => number;
  readonly logger?: Logger;
  readonly systemPromptOverride?: () => string;
  readonly maxClarifications?: number;
}

export interface CanvasRefineStepInput {
  readonly originalAsk: string;
  readonly history: readonly RefineMessage[];
  readonly targetPath?: string | undefined;
  readonly tombstoneSummary?: string | undefined;
  readonly questionCount: number;
  readonly signal: AbortSignal;
  readonly traceConfig?: ProviderTraceContext;
}

export type CanvasRefineDecision =
  | { readonly kind: 'plan'; readonly plan: RunPlanT; readonly assistantMessage?: RefineMessage }
  | {
      readonly kind: 'question';
      readonly question: string;
      readonly assistantMessage?: RefineMessage;
    }
  | { readonly kind: 'error'; readonly code: string; readonly message?: string };

export interface CanvasRefine {
  step(input: CanvasRefineStepInput): Promise<CanvasRefineDecision>;
}

const DEFAULT_MAX_TOKENS = 8192;

export function createCanvasRefine(opts: CanvasRefineOptions): CanvasRefine {
  const promptFn = opts.systemPromptOverride ?? getCanvasRefineSystemPrompt;
  const maxClarifications = opts.maxClarifications ?? CANVAS_BUDGETS.refineClarifyMax;

  return {
    async step(input) {
      if (input.questionCount >= maxClarifications) {
        return { kind: 'error', code: 'refine_unresolved' };
      }

      const messages: ChatMessage[] = [
        { role: 'system', content: promptFn() },
        ...buildContextMessages(input),
        ...input.history.map((m) => ({ role: m.role, content: m.content })),
      ];

      const req: ProviderChatRequest = {
        model: opts.model(),
        messages,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature() } : {}),
        maxTokens: opts.maxTokens !== undefined ? opts.maxTokens() : DEFAULT_MAX_TOKENS,
        tools: CANVAS_REFINE_TOOLS,
        ...(input.traceConfig !== undefined ? { trace: input.traceConfig } : {}),
      };

      const collected = await collectStream(opts.provider.stream(req, input.signal), input.signal);
      const decision = await classify(collected, opts.logger, input);
      if (decision.kind !== 'invalid_plan_retry') return decision;

      // Single retry with parser-error injected as tool message.
      const retryMessages: ChatMessage[] = [
        ...messages,
        {
          role: 'assistant',
          content:
            collected.textBuffer.length > 0
              ? collected.textBuffer
              : 'The previous plan failed schema validation.',
        },
        {
          role: 'user',
          content: `Plan validation failed: ${decision.error}. Re-emit emit_run_plan with a corrected plan.`,
        },
      ];
      const retryReq: ProviderChatRequest = { ...req, messages: retryMessages };
      const retryCollected = await collectStream(
        opts.provider.stream(retryReq, input.signal),
        input.signal,
      );
      const retryDecision = await classify(retryCollected, opts.logger, input);
      if (retryDecision.kind === 'invalid_plan_retry') {
        opts.logger?.warn(CANVAS_LOG.create.refine.failed, {
          code: 'refine_invalid_plan',
          error: retryDecision.error,
        });
        return { kind: 'error', code: 'refine_invalid_plan', message: retryDecision.error };
      }
      return retryDecision;
    },
  };
}

function buildContextMessages(input: CanvasRefineStepInput): ChatMessage[] {
  const out: ChatMessage[] = [];
  const lines: string[] = [];
  lines.push(`User ask: ${input.originalAsk}`);
  if (input.targetPath !== undefined && input.targetPath.length > 0) {
    lines.push(
      `Authoritative targetPath: ${input.targetPath} (use verbatim as RunPlan.outputPath).`,
    );
  }
  if (input.tombstoneSummary !== undefined && input.tombstoneSummary.length > 0) {
    lines.push(
      `Tombstone summary (entities the user removed previously; do not re-include unless explicitly re-asked):\n${input.tombstoneSummary}`,
    );
  }
  out.push({ role: 'user', content: lines.join('\n\n') });
  return out;
}

interface CollectedStream {
  readonly textBuffer: string;
  readonly toolCalls: ReadonlyArray<{ name: string; argsJson: string }>;
}

type RefineToolBufMap = Map<number, { id: string; name: string; args: string }>;

function applyRefineDelta(
  ev: Extract<RefineStreamEvent, { type: 'block_delta' }>,
  toolBufs: RefineToolBufMap,
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

function flushRefineToolBuf(
  ev: Extract<RefineStreamEvent, { type: 'block_stop' }>,
  toolBufs: RefineToolBufMap,
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
  const toolBufs: RefineToolBufMap = new Map();
  for await (const event of stream as AsyncIterable<RefineStreamEvent>) {
    if (signal.aborted) break;
    if (event.type === 'token') textBuffer += event.text ?? '';
    else if (event.type === 'tool_call')
      toolCalls.push({ name: event.call.name, argsJson: event.call.argsJson });
    else if (event.type === 'block_start' && event.block?.type === 'tool_use') {
      const block = event.block as { id: string; name: string };
      toolBufs.set(event.index, { id: block.id, name: block.name, args: '' });
    } else if (event.type === 'block_delta')
      textBuffer = applyRefineDelta(event, toolBufs, textBuffer);
    else if (event.type === 'block_stop') flushRefineToolBuf(event, toolBufs, toolCalls);
    else if (event.type === 'done' || event.type === 'error') break;
  }
  return { textBuffer, toolCalls };
}

type Classification = CanvasRefineDecision | { kind: 'invalid_plan_retry'; error: string };

async function classify(
  collected: CollectedStream,
  logger: Logger | undefined,
  input: CanvasRefineStepInput,
): Promise<Classification> {
  const planCall = collected.toolCalls.find((c) => c.name === 'emit_run_plan');
  const askCall = collected.toolCalls.find((c) => c.name === 'ask_clarifying_question');
  const foreign = collected.toolCalls.find(
    (c) => c.name !== 'emit_run_plan' && c.name !== 'ask_clarifying_question',
  );
  if (foreign !== undefined) {
    logger?.warn(CANVAS_LOG.create.refine.failed, {
      code: 'refine_invalid_tool',
      tool: foreign.name,
    });
    return { kind: 'error', code: 'refine_invalid_tool' };
  }
  if (planCall !== undefined) return classifyPlan(planCall, collected, logger, input);
  if (askCall !== undefined) return classifyAsk(askCall, collected);
  return classifyNoToolCall(collected, logger);
}

function classifyPlan(
  planCall: { argsJson: string },
  collected: CollectedStream,
  logger: Logger | undefined,
  input: CanvasRefineStepInput,
): Classification {
  const parsed = tryParseJson(planCall.argsJson);
  if (parsed === null) {
    logger?.debug(CANVAS_LOG.create.refine.failed, {
      stage: 'invalid_plan_candidate',
      error: 'arg_json_unparseable',
      candidateJson: safeStringify(planCall.argsJson, 4096),
    });
    return { kind: 'invalid_plan_retry', error: 'arg_json_unparseable' };
  }
  const candidate = (parsed as { plan?: unknown }).plan ?? parsed;
  const validation = RunPlan.safeParse(coerceRunPlan(candidate, input.targetPath));
  if (!validation.success) {
    const error = validation.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    logger?.debug(CANVAS_LOG.create.refine.failed, {
      stage: 'invalid_plan_candidate',
      error,
      candidateJson: safeStringify(candidate, 4096),
    });
    return { kind: 'invalid_plan_retry', error };
  }
  return {
    kind: 'plan',
    plan: validation.data,
    ...(collected.textBuffer.length > 0
      ? { assistantMessage: { role: 'assistant', content: collected.textBuffer } as const }
      : {}),
  };
}

function classifyAsk(askCall: { argsJson: string }, collected: CollectedStream): Classification {
  const parsed = tryParseJson(askCall.argsJson);
  const question =
    (parsed !== null && typeof (parsed as { question?: unknown }).question === 'string'
      ? (parsed as { question: string }).question
      : null) ?? collected.textBuffer.trim();
  if (question.length === 0) return { kind: 'error', code: 'refine_empty_question' };
  return {
    kind: 'question',
    question,
    ...(collected.textBuffer.length > 0
      ? { assistantMessage: { role: 'assistant', content: collected.textBuffer } as const }
      : {}),
  };
}

function classifyNoToolCall(
  collected: CollectedStream,
  logger: Logger | undefined,
): Classification {
  logger?.warn(CANVAS_LOG.create.refine.failed, {
    code: 'refine_no_tool_call',
    textChars: collected.textBuffer.length,
    toolCallCount: collected.toolCalls.length,
  });
  return {
    kind: 'error',
    code: 'refine_no_tool_call',
    message:
      collected.textBuffer.length > 0
        ? `Model emitted ${collected.textBuffer.length} text chars but no tool call (likely max_tokens cap during reasoning). Increase Provider › Max output tokens.`
        : 'Model returned no output. Check provider connectivity and model availability.',
  };
}

function tryParseJson(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const SOURCE_HINT_KIND_SYNONYMS: Readonly<Record<string, string>> = {
  glob: 'vaultGlob',
  tag: 'vaultTag',
  frontmatter: 'vaultFrontmatter',
  note: 'mention',
  link: 'mention',
  file: 'mention',
};

export function coerceRunPlan(raw: unknown, targetPath: string | undefined): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (out.schemaVersion === undefined) out.schemaVersion = 1;
  if (targetPath !== undefined && targetPath.length > 0) {
    out.outputPath = targetPath;
  }
  if (Array.isArray(out.sourceHints)) {
    out.sourceHints = out.sourceHints.map((entry) => {
      if (entry === null || typeof entry !== 'object') return entry;
      const e = entry as Record<string, unknown>;
      if (typeof e.kind !== 'string') return entry;
      const synonym = SOURCE_HINT_KIND_SYNONYMS[e.kind.toLowerCase()];
      if (synonym === undefined) return entry;
      return { ...e, kind: synonym };
    });
  }
  if (out.relationTypes === undefined || out.relationTypes === null) {
    out.relationTypes = [];
  }
  return out;
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

type RefineStreamEvent =
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
