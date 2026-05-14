import type { Logger } from '@/platform/Logger';
import type { ChatMessage, ProviderChatRequest, StreamEvent } from '@/providers/types';
import { chatContentText } from '@/providers/types';
import {
  COMPACT_MAX_OUTPUT_TOKENS,
  MAX_COMPACT_STREAMING_RETRIES,
  POST_COMPACT_MAX_FILES_TO_RESTORE,
  POST_COMPACT_MAX_TOKENS_PER_FILE,
  POST_COMPACT_MAX_TOKENS_PER_SKILL,
  POST_COMPACT_SKILLS_TOKEN_BUDGET,
  POST_COMPACT_TOKEN_BUDGET,
  autoCompactThresholdFor,
  resolveContextWindow,
} from './compactConstants';
import { COMPACT_SYSTEM_PROMPT, getCompactPrompt } from '@/prompts/agent/compactPrompts';
import {
  ERROR_MESSAGE_PROMPT_TOO_LONG,
  MAX_PTL_RETRIES,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  truncateHeadForPTLRetry,
} from './ptlRetry';
import {
  recordFailure as breakerRecordFailure,
  recordSuccess as breakerRecordSuccess,
  shouldSkipForCircuitBreaker,
  type AutoCompactTrackingState,
  type BreakerStatusChannel,
} from './autocompactBreaker';
import type { CompactPhaseSink } from './compact/phaseSink';
import {
  estimateMessageTokens,
  roughTokenCountEstimation,
  tokenCountWithEstimation,
  type TokenBlock,
  type TokenMessage,
} from './tokenEstimator';
import { toTokenBlock } from '@/chat/contextBridge';

export const COMPACT_BOUNDARY_MARKER = '[leo.compact.boundary]';
export const SUMMARY_PREFIX = 'Summary:\n';
export const FAILURE_REASON_NO_STREAM = 'no_streaming_response';
export const FAILURE_REASON_NO_SUMMARY = 'no_summary';
export const FAILURE_REASON_API_ERROR = 'api_error';

export type CompactTrigger = 'auto' | 'manual';

export interface SystemCompactBoundaryMessage extends ChatMessage {
  readonly role: 'system';
  readonly content: string;
  readonly compactMetadata: {
    readonly trigger: CompactTrigger;
    readonly preTokens: number;
  };
}

export interface CompactSummaryMessage extends ChatMessage {
  readonly role: 'user';
  readonly content: string;
  readonly isCompactSummary: true;
  readonly isVisibleInTranscriptOnly: true;
}

export interface CompactAttachment {
  readonly kind:
    | 'file'
    | 'skill'
    | 'plan'
    | 'plan_mode'
    | 'async_agent'
    | 'deferred_tools'
    | 'agent_listing'
    | 'mcp_instructions';
  readonly message: ChatMessage;
  readonly tokens: number;
  readonly id?: string;
}

export interface CompactionResult {
  readonly boundaryMarker: SystemCompactBoundaryMessage;
  readonly summaryMessages: readonly CompactSummaryMessage[];
  readonly messagesToKeep?: readonly ChatMessage[];
  readonly attachments: readonly CompactAttachment[];
  readonly hookResults: readonly ChatMessage[];
  readonly preCompactTokenCount: number;
  readonly postCompactTokenCount: number;
  readonly truePostCompactTokenCount: number;
  readonly isAutoCompact: boolean;
  readonly querySource: string;
  readonly compactionInputTokens: number;
  readonly compactionOutputTokens: number;
  readonly compactionTotalTokens: number;
}

export interface AutocompactProvider {
  stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface RecentFileSource {
  list(): readonly { readonly path: string; readonly mtime?: number }[];
  read(path: string, signal?: AbortSignal): Promise<string>;
}

export interface InvokedSkill {
  readonly id: string;
  readonly content: string;
}

export interface PlanSource {
  current(): string | null;
}

export interface PlanModeSource {
  inPlanMode(): boolean;
  instructions(): string;
}

export interface AutocompactOptions {
  readonly logger: Logger;
  readonly provider: AutocompactProvider;
  readonly model: string;
  readonly providerMaxInputTokens?: number;
  readonly userOverride?: number;
  readonly maxOutputTokensForModel?: number;
  readonly querySource: string;
  readonly customInstructions?: string;
  readonly snipTokensFreed?: number;
  readonly signal?: AbortSignal;
  readonly trigger?: CompactTrigger;
  readonly recentFiles?: RecentFileSource;
  readonly invokedSkills?: readonly InvokedSkill[];
  readonly plan?: PlanSource;
  readonly planMode?: PlanModeSource;
  readonly keepAliveIntervalMs?: number;
  readonly retryBaseMs?: number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
  readonly sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => number;
  readonly tracking?: AutoCompactTrackingState;
  readonly breakerNotifications?: BreakerStatusChannel;
  readonly phaseSink?: CompactPhaseSink;
  readonly exactCounter?: (
    messages: readonly ChatMessage[],
    signal?: AbortSignal,
  ) => Promise<number>;
}

const DEFAULT_KEEP_ALIVE_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 1_000;

export interface ShouldAutoCompactInput {
  readonly messages: readonly ChatMessage[];
  readonly model: string;
  readonly providerMaxInputTokens?: number;
  readonly userOverride?: number;
  readonly maxOutputTokensForModel?: number;
  readonly querySource?: string;
  readonly snipTokensFreed?: number;
}

export const EXACT_GATE_FRACTION = 0.8;

export interface ShouldAutoCompactExactInput extends ShouldAutoCompactInput {
  readonly exactCounter?: (
    messages: readonly ChatMessage[],
    signal?: AbortSignal,
  ) => Promise<number>;
  readonly signal?: AbortSignal;
  readonly logger?: Logger;
}

export function shouldAutoCompact(input: ShouldAutoCompactInput): boolean {
  if (input.querySource === 'compact') return false;
  const tokenMessages = toTokenMessages(input.messages);
  const estimated = tokenCountWithEstimation(tokenMessages);
  const tokens = estimated ?? estimateMessageTokens(tokenMessages);
  const contextWindow = resolveContextWindow({
    model: input.model,
    ...(input.providerMaxInputTokens !== undefined
      ? { providerMaxInputTokens: input.providerMaxInputTokens }
      : {}),
    ...(input.userOverride !== undefined ? { userOverride: input.userOverride } : {}),
  });
  const maxOutput = input.maxOutputTokensForModel ?? COMPACT_MAX_OUTPUT_TOKENS;
  const threshold = autoCompactThresholdFor(contextWindow, maxOutput);
  const snip = input.snipTokensFreed ?? 0;
  return tokens - snip >= threshold;
}

export async function shouldAutoCompactExact(input: ShouldAutoCompactExactInput): Promise<boolean> {
  if (input.querySource === 'compact') return false;
  const tokenMessages = toTokenMessages(input.messages);
  const estimated = tokenCountWithEstimation(tokenMessages);
  const heuristicTokens = estimated ?? estimateMessageTokens(tokenMessages);
  const contextWindow = resolveContextWindow({
    model: input.model,
    ...(input.providerMaxInputTokens !== undefined
      ? { providerMaxInputTokens: input.providerMaxInputTokens }
      : {}),
    ...(input.userOverride !== undefined ? { userOverride: input.userOverride } : {}),
  });
  const maxOutput = input.maxOutputTokensForModel ?? COMPACT_MAX_OUTPUT_TOKENS;
  const threshold = autoCompactThresholdFor(contextWindow, maxOutput);
  const snip = input.snipTokensFreed ?? 0;
  const heuristicNet = heuristicTokens - snip;
  if (input.exactCounter === undefined) return heuristicNet >= threshold;
  if (heuristicNet < threshold * EXACT_GATE_FRACTION) return false;
  try {
    const exact = await input.exactCounter(input.messages, input.signal);
    return exact - snip >= threshold;
  } catch (err) {
    input.logger?.warn('autocompact.exact_counter_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return heuristicNet >= threshold;
  }
}

export function autoCompactThresholdForInput(
  input: Pick<
    ShouldAutoCompactInput,
    'model' | 'providerMaxInputTokens' | 'userOverride' | 'maxOutputTokensForModel'
  >,
): number {
  const contextWindow = resolveContextWindow({
    model: input.model,
    ...(input.providerMaxInputTokens !== undefined
      ? { providerMaxInputTokens: input.providerMaxInputTokens }
      : {}),
    ...(input.userOverride !== undefined ? { userOverride: input.userOverride } : {}),
  });
  const maxOutput = input.maxOutputTokensForModel ?? COMPACT_MAX_OUTPUT_TOKENS;
  return autoCompactThresholdFor(contextWindow, maxOutput);
}

export async function autoCompactIfNeeded(
  messages: readonly ChatMessage[],
  opts: AutocompactOptions,
): Promise<CompactionResult | null> {
  if (opts.querySource === 'compact') return null;
  if (opts.tracking !== undefined && shouldSkipForCircuitBreaker(opts.tracking)) {
    opts.phaseSink?.error(
      'circuit_broken',
      'Autocompact disabled for this session (3 consecutive failures)',
    );
    return null;
  }
  const decision = await shouldAutoCompactExact({
    messages,
    model: opts.model,
    ...(opts.providerMaxInputTokens !== undefined
      ? { providerMaxInputTokens: opts.providerMaxInputTokens }
      : {}),
    ...(opts.userOverride !== undefined ? { userOverride: opts.userOverride } : {}),
    ...(opts.maxOutputTokensForModel !== undefined
      ? { maxOutputTokensForModel: opts.maxOutputTokensForModel }
      : {}),
    ...(opts.querySource !== undefined ? { querySource: opts.querySource } : {}),
    ...(opts.snipTokensFreed !== undefined ? { snipTokensFreed: opts.snipTokensFreed } : {}),
    ...(opts.exactCounter !== undefined ? { exactCounter: opts.exactCounter } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    logger: opts.logger,
  });
  if (!decision) return null;
  return runCompaction(messages, opts);
}

export async function runManualCompaction(
  messages: readonly ChatMessage[],
  opts: AutocompactOptions,
): Promise<CompactionResult | null> {
  if (opts.tracking !== undefined && shouldSkipForCircuitBreaker(opts.tracking)) {
    opts.phaseSink?.error(
      'circuit_broken',
      'Compaction disabled for this session (3 consecutive failures)',
    );
    return null;
  }
  return runCompaction(messages, { ...opts, trigger: 'manual' });
}

function failNoStream(opts: AutocompactOptions, preCompactTokenCount: number): null {
  opts.logger.warn('tengu_compact_failed', {
    reason: FAILURE_REASON_NO_STREAM,
    preCompactTokenCount,
  });
  recordFailureIfTracked(opts);
  if (opts.signal?.aborted) opts.phaseSink?.cancelled();
  else opts.phaseSink?.error('no_stream', 'No streaming response from provider');
  return null;
}

function throwPtl(opts: AutocompactOptions, preCompactTokenCount: number): never {
  opts.logger.warn('tengu_compact_failed', { reason: 'prompt_too_long', preCompactTokenCount });
  recordFailureIfTracked(opts);
  opts.phaseSink?.error('prompt_too_long', ERROR_MESSAGE_PROMPT_TOO_LONG);
  throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG);
}

interface SummarizationLoopResult {
  readonly result: StreamCallResult | null;
}

async function runSummarizationLoop(
  initial: readonly ChatMessage[],
  opts: AutocompactOptions,
  preCompactTokenCount: number,
): Promise<SummarizationLoopResult> {
  let messagesToSummarize: readonly ChatMessage[] = initial;
  let ptlAttempts = 0;
  for (;;) {
    if (opts.signal?.aborted) {
      opts.phaseSink?.cancelled();
      return { result: null };
    }
    const streamResult = await runSummarizationWithRetries(
      {
        systemPrompt: COMPACT_SYSTEM_PROMPT,
        messages: messagesToSummarize,
        querySource: 'compact',
      },
      opts,
    );
    if (streamResult === null) {
      failNoStream(opts, preCompactTokenCount);
      return { result: null };
    }
    if (!streamResult.text.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)) {
      return { result: streamResult };
    }
    ptlAttempts += 1;
    if (ptlAttempts > MAX_PTL_RETRIES) throwPtl(opts, preCompactTokenCount);
    const truncated = truncateHeadForPTLRetry(messagesToSummarize, streamResult.text);
    if (truncated === null) throwPtl(opts, preCompactTokenCount);
    opts.logger.info('tengu_compact_ptl_retry', {
      attempt: ptlAttempts,
      droppedMessages: truncated.droppedMessages,
      remainingMessages: truncated.remainingMessages,
    });
    messagesToSummarize = truncated.messages;
  }
}

export async function runCompaction(
  messages: readonly ChatMessage[],
  opts: AutocompactOptions,
): Promise<CompactionResult | null> {
  const preCompactTokenCount = estimateMessageTokens(toTokenMessages(messages));
  const trigger: CompactTrigger = opts.trigger ?? 'auto';
  opts.phaseSink?.start(trigger, preCompactTokenCount);
  const summaryPrompt = getCompactPrompt(opts.customInstructions);
  const afterBoundary = getMessagesAfterCompactBoundary(messages);
  const prepared: ChatMessage[] = stripReinjectedAttachments(afterBoundary);
  prepared.push({ role: 'user', content: summaryPrompt });
  const normalized = normalizeMessagesForAPI(stripImagesFromMessages(prepared));

  opts.phaseSink?.summarizing();

  const { result: streamResult } = await runSummarizationLoop(
    normalized,
    opts,
    preCompactTokenCount,
  );
  if (streamResult === null) return null;

  let formattedSummary: string;
  try {
    formattedSummary = formatCompactSummary(streamResult.text);
  } catch {
    opts.logger.warn('tengu_compact_failed', {
      reason: FAILURE_REASON_NO_SUMMARY,
      preCompactTokenCount,
    });
    recordFailureIfTracked(opts);
    opts.phaseSink?.error('no_summary', 'Could not extract summary from response');
    return null;
  }

  opts.phaseSink?.buildingAttachments();

  const boundaryMarker: SystemCompactBoundaryMessage = {
    role: 'system',
    content: COMPACT_BOUNDARY_MARKER,
    compactMetadata: { trigger, preTokens: preCompactTokenCount },
  };
  const summaryMessages: CompactSummaryMessage[] = [
    {
      role: 'user',
      content: formattedSummary,
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    },
  ];

  const attachments = await buildAttachments(messages, opts);
  const hookResults: readonly ChatMessage[] = [];

  const postCompactMessages = buildPostCompactMessages({
    boundaryMarker,
    summaryMessages,
    attachments,
    hookResults,
    preCompactTokenCount,
    postCompactTokenCount: 0,
    truePostCompactTokenCount: 0,
    isAutoCompact: trigger === 'auto',
    querySource: opts.querySource,
    compactionInputTokens: streamResult.inputTokens,
    compactionOutputTokens: streamResult.outputTokens,
    compactionTotalTokens: streamResult.inputTokens + streamResult.outputTokens,
  });
  const postTokens = estimateMessageTokens(toTokenMessages(postCompactMessages));

  const result: CompactionResult = {
    boundaryMarker,
    summaryMessages,
    attachments,
    hookResults,
    preCompactTokenCount,
    postCompactTokenCount: postTokens,
    truePostCompactTokenCount: postTokens,
    isAutoCompact: trigger === 'auto',
    querySource: opts.querySource,
    compactionInputTokens: streamResult.inputTokens,
    compactionOutputTokens: streamResult.outputTokens,
    compactionTotalTokens: streamResult.inputTokens + streamResult.outputTokens,
  };

  recordSuccessIfTracked(opts);

  opts.logger.info('tengu_compact', {
    preCompactTokenCount,
    postCompactTokenCount: postTokens,
    truePostCompactTokenCount: postTokens,
    autoCompactThreshold: autoCompactThresholdForInput({
      model: opts.model,
      ...(opts.providerMaxInputTokens !== undefined
        ? { providerMaxInputTokens: opts.providerMaxInputTokens }
        : {}),
      ...(opts.userOverride !== undefined ? { userOverride: opts.userOverride } : {}),
      ...(opts.maxOutputTokensForModel !== undefined
        ? { maxOutputTokensForModel: opts.maxOutputTokensForModel }
        : {}),
    }),
    isAutoCompact: trigger === 'auto',
    querySource: opts.querySource,
    compactionInputTokens: streamResult.inputTokens,
    compactionOutputTokens: streamResult.outputTokens,
    compactionTotalTokens: streamResult.inputTokens + streamResult.outputTokens,
  });

  opts.phaseSink?.done(result);
  return result;
}

interface StreamCallResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

async function delayBeforeRetry(
  attempt: number,
  err: unknown,
  retryBaseMs: number,
  opts: AutocompactOptions,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
): Promise<boolean> {
  opts.logger.warn('tengu_compact_streaming_retry', {
    attempt: attempt + 1,
    error: err instanceof Error ? err.message : String(err),
  });
  const delay = retryBaseMs * Math.pow(2, attempt);
  try {
    await sleep(delay, opts.signal);
    return true;
  } catch {
    return false;
  }
}

async function runSummarizationWithRetries(
  call: {
    readonly systemPrompt: string;
    readonly messages: readonly ChatMessage[];
    readonly querySource: string;
  },
  opts: AutocompactOptions,
): Promise<StreamCallResult | null> {
  const maxAttempts = MAX_COMPACT_STREAMING_RETRIES + 1;
  const retryBaseMs = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const sleep = opts.sleepFn ?? defaultSleep;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (opts.signal?.aborted) return null;
    try {
      return await runStreamOnce(call, opts);
    } catch (err) {
      if (opts.signal?.aborted) return null;
      if (attempt >= maxAttempts - 1) return null;
      const slept = await delayBeforeRetry(attempt, err, retryBaseMs, opts, sleep);
      if (!slept) return null;
    }
  }
  return null;
}

interface StreamAccumulator {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// Returns true if loop should break.
function applyStreamEvent(ev: StreamEvent, acc: StreamAccumulator): boolean {
  if (ev.type === 'token') {
    acc.text += ev.text;
    return false;
  }
  if (ev.type === 'block_delta' && ev.delta.type === 'text_delta') {
    // langchain-backed providers (lmstudio/openai/anthropic/ollama/custom)
    // emit text through content-block framing, not the legacy `token` shape.
    acc.text += ev.delta.text;
    return false;
  }
  if (ev.type === 'usage') {
    acc.inputTokens = ev.input;
    acc.outputTokens = ev.output;
    return false;
  }
  if (ev.type === 'message_delta' && ev.usage !== undefined) {
    if (typeof ev.usage.input === 'number') acc.inputTokens = ev.usage.input;
    if (typeof ev.usage.output === 'number') acc.outputTokens = ev.usage.output;
    return false;
  }
  if (ev.type === 'error') throw ev.error;
  return ev.type === 'done';
}

async function runStreamOnce(
  call: {
    readonly systemPrompt: string;
    readonly messages: readonly ChatMessage[];
    readonly querySource: string;
  },
  opts: AutocompactOptions,
): Promise<StreamCallResult> {
  const maxOutput = Math.min(
    COMPACT_MAX_OUTPUT_TOKENS,
    opts.maxOutputTokensForModel ?? COMPACT_MAX_OUTPUT_TOKENS,
  );
  const req: ProviderChatRequest = {
    model: opts.model,
    messages: [{ role: 'system', content: call.systemPrompt }, ...call.messages],
    maxTokens: maxOutput,
  };
  const innerAbort = new AbortController();
  const detach = linkSignals(opts.signal, innerAbort);
  const setIntervalFn = opts.setIntervalFn ?? setInterval;
  const clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
  const keepAliveMs = opts.keepAliveIntervalMs ?? DEFAULT_KEEP_ALIVE_MS;
  const keepAlive = setIntervalFn((): void => {
    opts.logger.debug('keepAlive.tick', { querySource: call.querySource });
  }, keepAliveMs);
  const acc: StreamAccumulator = { text: '', inputTokens: 0, outputTokens: 0 };
  let sawEvent = false;
  try {
    for await (const ev of opts.provider.stream(req, innerAbort.signal)) {
      sawEvent = true;
      if (innerAbort.signal.aborted) break;
      if (applyStreamEvent(ev, acc)) break;
    }
  } finally {
    clearIntervalFn(keepAlive);
    detach();
  }
  if (!sawEvent || acc.text.length === 0) {
    throw new Error('empty summarization response');
  }
  return { text: acc.text, inputTokens: acc.inputTokens, outputTokens: acc.outputTokens };
}

function linkSignals(outer: AbortSignal | undefined, inner: AbortController): () => void {
  if (outer === undefined) return (): void => undefined;
  if (outer.aborted) {
    inner.abort();
    return (): void => undefined;
  }
  const onAbort = (): void => inner.abort();
  outer.addEventListener('abort', onAbort, { once: true });
  return (): void => outer.removeEventListener('abort', onAbort);
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const t = setTimeout((): void => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(new Error('aborted'));
    };
    function cleanup(): void {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function formatCompactSummary(summary: string): string {
  const withoutAnalysis = summary.replace(/<analysis>[\s\S]*?<\/analysis>/g, '');
  const match = /<summary>([\s\S]*?)<\/summary>/.exec(withoutAnalysis);
  if (match === null) {
    throw new Error('no <summary> block in compact output');
  }
  const body = match[1]!.trim();
  const prefixed = SUMMARY_PREFIX + body;
  const collapsed = prefixed.replace(/\n{3,}/g, '\n\n');
  return collapsed.trim();
}

export function buildPostCompactMessages(
  result: Omit<CompactionResult, 'postCompactTokenCount' | 'truePostCompactTokenCount'> & {
    readonly postCompactTokenCount?: number;
    readonly truePostCompactTokenCount?: number;
  },
): ChatMessage[] {
  const out: ChatMessage[] = [];
  out.push(result.boundaryMarker);
  for (const m of result.summaryMessages) out.push(m);
  if (result.messagesToKeep !== undefined) {
    for (const m of result.messagesToKeep) out.push(m);
  }
  for (const a of result.attachments) out.push(a.message);
  for (const h of result.hookResults) out.push(h);
  return out;
}

export function getMessagesAfterCompactBoundary(messages: readonly ChatMessage[]): ChatMessage[] {
  let startIdx = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role === 'system' && m.content === COMPACT_BOUNDARY_MARKER) {
      startIdx = i + 1;
      break;
    }
  }
  return messages.slice(startIdx);
}

const SKILL_DISCOVERY_PREFIX = '[leo.skill.discovery]';
const SKILL_LISTING_PREFIX = '[leo.skill.listing]';

export function stripReinjectedAttachments(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => {
    if (m.role !== 'system') return true;
    const text = chatContentText(m.content);
    return !text.startsWith(SKILL_DISCOVERY_PREFIX) && !text.startsWith(SKILL_LISTING_PREFIX);
  });
}

export function stripImagesFromMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    ...m,
    content: chatContentText(m.content)
      .replace(/\[image:[^\]]*\]/g, '[image]')
      .replace(/\[document:[^\]]*\]/g, '[document]'),
  }));
}

export function normalizeMessagesForAPI(messages: readonly ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (out.length === 0) {
      out.push(m);
      continue;
    }
    const last = out[out.length - 1]!;
    if (
      last.role === 'assistant' &&
      m.role === 'assistant' &&
      (last.toolCalls ?? []).length === 0 &&
      (m.toolCalls ?? []).length === 0
    ) {
      out[out.length - 1] = {
        role: 'assistant',
        content: chatContentText(last.content) + chatContentText(m.content),
      };
      continue;
    }
    out.push(m);
  }
  return out;
}

async function buildAttachments(
  preCompactMessages: readonly ChatMessage[],
  opts: AutocompactOptions,
): Promise<readonly CompactAttachment[]> {
  const attachments: CompactAttachment[] = [];
  let budgetRemaining = POST_COMPACT_TOKEN_BUDGET;

  const fileAttachments = await buildFileAttachments(preCompactMessages, opts, budgetRemaining);
  for (const a of fileAttachments) {
    attachments.push(a);
    budgetRemaining -= a.tokens;
  }

  const skillAttachments = buildSkillAttachments(opts, budgetRemaining);
  for (const a of skillAttachments) {
    attachments.push(a);
    budgetRemaining -= a.tokens;
  }

  if (opts.plan !== undefined && budgetRemaining > 0) {
    const planText = opts.plan.current();
    if (planText !== null) {
      const tokens = Math.min(budgetRemaining, roughTokenCountEstimation(planText));
      if (tokens > 0) {
        attachments.push({
          kind: 'plan',
          tokens,
          message: {
            role: 'system',
            content: truncateToTokens(planText, tokens),
          },
        });
        budgetRemaining -= tokens;
      }
    }
  }

  if (opts.planMode !== undefined && budgetRemaining > 0 && opts.planMode.inPlanMode()) {
    const text = opts.planMode.instructions();
    const tokens = Math.min(budgetRemaining, roughTokenCountEstimation(text));
    if (tokens > 0) {
      attachments.push({
        kind: 'plan_mode',
        tokens,
        message: {
          role: 'system',
          content: truncateToTokens(text, tokens),
        },
      });
    }
  }

  return attachments;
}

async function buildFileAttachments(
  preCompactMessages: readonly ChatMessage[],
  opts: AutocompactOptions,
  budgetRemaining: number,
): Promise<readonly CompactAttachment[]> {
  if (opts.recentFiles === undefined) return [];
  const alreadyVisible = collectVisibleFilePaths(preCompactMessages);
  const candidates = [...opts.recentFiles.list()]
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    .filter((c) => !alreadyVisible.has(c.path))
    .slice(0, POST_COMPACT_MAX_FILES_TO_RESTORE);
  const out: CompactAttachment[] = [];
  for (const candidate of candidates) {
    if (budgetRemaining <= 0) break;
    let body: string;
    try {
      body = await opts.recentFiles.read(candidate.path, opts.signal);
    } catch {
      continue;
    }
    const cappedPerFile = Math.min(POST_COMPACT_MAX_TOKENS_PER_FILE, budgetRemaining);
    const tokens = Math.min(cappedPerFile, roughTokenCountEstimation(body));
    if (tokens <= 0) continue;
    const truncated = truncateToTokens(body, tokens);
    out.push({
      kind: 'file',
      id: candidate.path,
      tokens,
      message: {
        role: 'system',
        content: `[leo.compact.file ${candidate.path}]\n${truncated}`,
      },
    });
    budgetRemaining -= tokens;
  }
  return out;
}

function buildSkillAttachments(
  opts: AutocompactOptions,
  budgetRemaining: number,
): readonly CompactAttachment[] {
  if (opts.invokedSkills === undefined) return [];
  const out: CompactAttachment[] = [];
  let skillBudget = Math.min(POST_COMPACT_SKILLS_TOKEN_BUDGET, budgetRemaining);
  for (const skill of opts.invokedSkills) {
    if (skillBudget <= 0) break;
    const perSkillCap = Math.min(POST_COMPACT_MAX_TOKENS_PER_SKILL, skillBudget);
    const raw = roughTokenCountEstimation(skill.content);
    const tokens = Math.min(perSkillCap, raw);
    if (tokens <= 0) continue;
    const truncated = truncateToTokens(skill.content, tokens);
    out.push({
      kind: 'skill',
      id: skill.id,
      tokens,
      message: {
        role: 'system',
        content: `[leo.compact.skill ${skill.id}]\n${truncated}`,
      },
    });
    skillBudget -= tokens;
  }
  return out;
}

function collectVisibleFilePaths(messages: readonly ChatMessage[]): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const m of messages) {
    const matches = chatContentText(m.content).match(
      /[A-Za-z0-9_\-./]+\.(?:md|ts|tsx|js|jsx|json|canvas)/g, // NOSONAR(typescript:S5852): bounded char class + literal extension alternation, linear time.
    );
    if (matches !== null) {
      for (const p of matches) paths.add(p);
    }
  }
  return paths;
}

function truncateToTokens(text: string, tokenCap: number): string {
  if (tokenCap <= 0) return '';
  const bytesPerToken = 4;
  const byteCap = tokenCap * bytesPerToken;
  if (text.length <= byteCap) return text;
  return text.slice(0, byteCap);
}

function toTokenMessages(messages: readonly ChatMessage[]): TokenMessage[] {
  return messages.map((m) => {
    const content: string | readonly TokenBlock[] =
      typeof m.content === 'string' ? m.content : m.content.map(toTokenBlock);
    return { role: m.role, content };
  });
}

function recordFailureIfTracked(opts: AutocompactOptions): void {
  if (opts.tracking === undefined) return;
  breakerRecordFailure(opts.tracking, {
    logger: opts.logger,
    ...(opts.breakerNotifications !== undefined
      ? { notifications: opts.breakerNotifications }
      : {}),
  });
}

function recordSuccessIfTracked(opts: AutocompactOptions): void {
  if (opts.tracking === undefined) return;
  breakerRecordSuccess(opts.tracking, {
    logger: opts.logger,
    ...(opts.breakerNotifications !== undefined
      ? { notifications: opts.breakerNotifications }
      : {}),
  });
}

export function isCompactBoundary(m: ChatMessage): m is SystemCompactBoundaryMessage {
  return (
    m.role === 'system' &&
    m.content === COMPACT_BOUNDARY_MARKER &&
    (m as SystemCompactBoundaryMessage).compactMetadata !== undefined
  );
}
