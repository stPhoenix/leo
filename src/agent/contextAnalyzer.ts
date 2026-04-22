import type { Logger } from '@/platform/Logger';
import type { ChatMessage } from '@/providers/types';
import { MICROCOMPACT_BOUNDARY_MARKER } from './microcompact';
import { COMPACT_BOUNDARY_MARKER } from './autocompact';

export interface ContextAnalyzerInputs {
  readonly messages: readonly ChatMessage[];
  readonly originalMessages?: readonly ChatMessage[];
  readonly model: string;
  readonly terminalWidth?: number;
  readonly signal?: AbortSignal;
  readonly logger: Logger;
  readonly counters: ContextCounters;
  readonly projectView?: (messages: readonly ChatMessage[]) => readonly ChatMessage[];
  readonly microcompact?: (messages: readonly ChatMessage[]) => readonly ChatMessage[];
}

export interface ContextCounters {
  readonly countSystemTokens: (ctx: CounterContext) => Promise<number>;
  readonly countMemoryFileTokens: (ctx: CounterContext) => Promise<number>;
  readonly countBuiltInToolTokens: (ctx: CounterContext) => Promise<number>;
  readonly countMcpToolTokens: (ctx: CounterContext) => Promise<number>;
  readonly countCustomAgentTokens: (ctx: CounterContext) => Promise<number>;
  readonly countSlashCommandTokens: (ctx: CounterContext) => Promise<number>;
  readonly approximateMessageTokens: (ctx: CounterContext) => Promise<number>;
  readonly countSkillTokens: (ctx: CounterContext) => Promise<number>;
}

export interface CounterContext {
  readonly messages: readonly ChatMessage[];
  readonly originalMessages: readonly ChatMessage[];
  readonly model: string;
  readonly signal?: AbortSignal;
}

export interface ContextData {
  readonly systemTokens: number;
  readonly memoryFileTokens: number;
  readonly builtInToolTokens: number;
  readonly mcpToolTokens: number;
  readonly customAgentTokens: number;
  readonly slashCommandTokens: number;
  readonly messageTokens: number;
  readonly skillTokens: number;
  readonly skillCountFailed: boolean;
  readonly totalTokens: number;
  readonly tokenTotalSource: 'api' | 'estimated';
  readonly pipelineMessageCount: number;
  readonly model: string;
}

export async function analyzeContextUsage(inputs: ContextAnalyzerInputs): Promise<ContextData> {
  throwIfAborted(inputs.signal);
  const filtered = filterAfterLastBoundary(inputs.messages);
  throwIfAborted(inputs.signal);
  const viewed = inputs.projectView !== undefined ? inputs.projectView(filtered) : filtered;
  throwIfAborted(inputs.signal);
  const microcompacted = inputs.microcompact !== undefined ? inputs.microcompact(viewed) : viewed;
  throwIfAborted(inputs.signal);

  const counterCtx: CounterContext = {
    messages: microcompacted,
    originalMessages: inputs.originalMessages ?? inputs.messages,
    model: inputs.model,
    ...(inputs.signal !== undefined ? { signal: inputs.signal } : {}),
  };

  const [
    systemTokens,
    memoryFileTokens,
    builtInToolTokens,
    mcpToolTokens,
    customAgentTokens,
    slashCommandTokens,
    messageTokens,
  ] = await Promise.all([
    inputs.counters.countSystemTokens(counterCtx),
    inputs.counters.countMemoryFileTokens(counterCtx),
    inputs.counters.countBuiltInToolTokens(counterCtx),
    inputs.counters.countMcpToolTokens(counterCtx),
    inputs.counters.countCustomAgentTokens(counterCtx),
    inputs.counters.countSlashCommandTokens(counterCtx),
    inputs.counters.approximateMessageTokens(counterCtx),
  ]);

  throwIfAborted(inputs.signal);

  let skillTokens = 0;
  let skillCountFailed = false;
  try {
    skillTokens = await inputs.counters.countSkillTokens(counterCtx);
  } catch (err) {
    if (isAbortError(err)) throw err;
    skillCountFailed = true;
    inputs.logger.warn('context.skill_count_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const estimatedTotal =
    systemTokens +
    memoryFileTokens +
    builtInToolTokens +
    mcpToolTokens +
    customAgentTokens +
    slashCommandTokens +
    messageTokens +
    skillTokens;
  const apiTotal = extractApiUsageTotal(counterCtx.originalMessages);
  const totalTokens = apiTotal ?? estimatedTotal;
  const tokenTotalSource: 'api' | 'estimated' = apiTotal !== null ? 'api' : 'estimated';

  return {
    systemTokens,
    memoryFileTokens,
    builtInToolTokens,
    mcpToolTokens,
    customAgentTokens,
    slashCommandTokens,
    messageTokens,
    skillTokens,
    skillCountFailed,
    totalTokens,
    tokenTotalSource,
    pipelineMessageCount: microcompacted.length,
    model: inputs.model,
  };
}

export function filterAfterLastBoundary(messages: readonly ChatMessage[]): ChatMessage[] {
  let lastIdx = -1;
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i]!;
    if (
      m.role === 'system' &&
      (m.content === COMPACT_BOUNDARY_MARKER || m.content === MICROCOMPACT_BOUNDARY_MARKER)
    ) {
      lastIdx = i;
    }
  }
  return messages.slice(lastIdx + 1);
}

interface MessageWithUsage extends ChatMessage {
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_creation_input_tokens?: number;
    readonly cache_read_input_tokens?: number;
  };
}

function extractApiUsageTotal(messages: readonly ChatMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as MessageWithUsage;
    if (m.role !== 'assistant') continue;
    if (m.usage === undefined) continue;
    const input = m.usage.input_tokens ?? 0;
    const cacheCreate = m.usage.cache_creation_input_tokens ?? 0;
    const cacheRead = m.usage.cache_read_input_tokens ?? 0;
    return input + cacheCreate + cacheRead;
  }
  return null;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException('aborted', 'AbortError');
  }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}
