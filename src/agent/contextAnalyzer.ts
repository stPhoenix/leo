import type { Logger } from '@/platform/Logger';
import type { ChatMessage } from '@/providers/types';
import { MICROCOMPACT_BOUNDARY_MARKER } from './microcompact';
import { COMPACT_BOUNDARY_MARKER } from './autocompact';
import { apiUsageTokens, tokenCountWithEstimation, type TokenMessage } from './tokenEstimator';
import type { MessageBreakdown } from './messageBreakdown';

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
  readonly exactCounter?: (
    messages: readonly ChatMessage[],
    signal?: AbortSignal,
  ) => Promise<number>;
}

export interface MessageTokenResult {
  readonly total: number;
  readonly breakdown: MessageBreakdown;
}

export interface ContextCounters {
  readonly countSystemTokens: (ctx: CounterContext) => Promise<number>;
  readonly countMemoryFileTokens: (ctx: CounterContext) => Promise<number>;
  readonly countBuiltInToolTokens: (ctx: CounterContext) => Promise<number>;
  readonly countMcpToolTokens: (ctx: CounterContext) => Promise<number>;
  readonly countCustomAgentTokens: (ctx: CounterContext) => Promise<number>;
  readonly countSlashCommandTokens: (ctx: CounterContext) => Promise<number>;
  readonly approximateMessageTokens: (ctx: CounterContext) => Promise<MessageTokenResult>;
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
  readonly messageBreakdown: MessageBreakdown;
  readonly skillTokens: number;
  readonly skillCountFailed: boolean;
  readonly totalTokens: number;
  readonly tokenTotalSource: TokenTotalSource;
  readonly pipelineMessageCount: number;
  readonly model: string;
}

export type TokenTotalSource = 'api' | 'hybrid' | 'estimated' | 'exact';

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

  const counts = await runParallelCounters(inputs, counterCtx);
  throwIfAborted(inputs.signal);
  const { skillTokens, skillCountFailed } = await countSkillsTolerant(inputs, counterCtx);

  const estimatedTotal = sumEstimatedTotal(counts, skillTokens);
  const originalAsTokenMessages = counterCtx.originalMessages as unknown as readonly TokenMessage[];
  const apiTotal = apiUsageTokens(originalAsTokenMessages);
  const hybridTotal = apiTotal === null ? tokenCountWithEstimation(originalAsTokenMessages) : null;
  const exactTotal = await safeExactCount(inputs, microcompacted);

  const { totalTokens, tokenTotalSource } = pickTokenTotal({
    exactTotal,
    apiTotal,
    hybridTotal,
    estimatedTotal,
  });

  return {
    ...counts,
    skillTokens,
    skillCountFailed,
    totalTokens,
    tokenTotalSource,
    pipelineMessageCount: microcompacted.length,
    model: inputs.model,
  };
}

interface ParallelCounts {
  systemTokens: number;
  memoryFileTokens: number;
  builtInToolTokens: number;
  mcpToolTokens: number;
  customAgentTokens: number;
  slashCommandTokens: number;
  messageTokens: number;
  messageBreakdown: ContextData['messageBreakdown'];
}

async function runParallelCounters(
  inputs: ContextAnalyzerInputs,
  counterCtx: CounterContext,
): Promise<ParallelCounts> {
  const [
    systemTokens,
    memoryFileTokens,
    builtInToolTokens,
    mcpToolTokens,
    customAgentTokens,
    slashCommandTokens,
    messageResult,
  ] = await Promise.all([
    inputs.counters.countSystemTokens(counterCtx),
    inputs.counters.countMemoryFileTokens(counterCtx),
    inputs.counters.countBuiltInToolTokens(counterCtx),
    inputs.counters.countMcpToolTokens(counterCtx),
    inputs.counters.countCustomAgentTokens(counterCtx),
    inputs.counters.countSlashCommandTokens(counterCtx),
    inputs.counters.approximateMessageTokens(counterCtx),
  ]);
  return {
    systemTokens,
    memoryFileTokens,
    builtInToolTokens,
    mcpToolTokens,
    customAgentTokens,
    slashCommandTokens,
    messageTokens: messageResult.total,
    messageBreakdown: messageResult.breakdown,
  };
}

async function countSkillsTolerant(
  inputs: ContextAnalyzerInputs,
  counterCtx: CounterContext,
): Promise<{ skillTokens: number; skillCountFailed: boolean }> {
  try {
    return {
      skillTokens: await inputs.counters.countSkillTokens(counterCtx),
      skillCountFailed: false,
    };
  } catch (err) {
    if (isAbortError(err)) throw err;
    inputs.logger.warn('context.skill_count_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { skillTokens: 0, skillCountFailed: true };
  }
}

function sumEstimatedTotal(c: ParallelCounts, skillTokens: number): number {
  return (
    c.systemTokens +
    c.memoryFileTokens +
    c.builtInToolTokens +
    c.mcpToolTokens +
    c.customAgentTokens +
    c.slashCommandTokens +
    c.messageTokens +
    skillTokens
  );
}

async function safeExactCount(
  inputs: ContextAnalyzerInputs,
  microcompacted: readonly ChatMessage[],
): Promise<number | null> {
  if (inputs.exactCounter === undefined) return null;
  try {
    return await inputs.exactCounter(microcompacted, inputs.signal);
  } catch (err) {
    if (isAbortError(err)) throw err;
    inputs.logger.warn('context.exact_counter_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function pickTokenTotal(args: {
  exactTotal: number | null;
  apiTotal: number | null;
  hybridTotal: number | null;
  estimatedTotal: number;
}): { totalTokens: number; tokenTotalSource: TokenTotalSource } {
  const { exactTotal, apiTotal, hybridTotal, estimatedTotal } = args;
  if (exactTotal !== null && exactTotal > 0) {
    return { totalTokens: exactTotal, tokenTotalSource: 'exact' };
  }
  if (apiTotal !== null && apiTotal > 0) {
    return { totalTokens: apiTotal, tokenTotalSource: 'api' };
  }
  if (hybridTotal !== null && hybridTotal > 0) {
    return { totalTokens: hybridTotal, tokenTotalSource: 'hybrid' };
  }
  return { totalTokens: estimatedTotal, tokenTotalSource: 'estimated' };
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
