import type { Sandbox } from '../sandbox';
import type { InlineAgentLogger, ProviderFactory } from '../index';
import type { InlineAgentConfig } from '../configSchema';
import type { AssistantStep, ManualChatModelAdapter } from '../manualChatModel';
export type { AssistantStep, ManualChatModelAdapter } from '../manualChatModel';
import {
  addTokens,
  incrementIterations,
  type InlineAgentRunState,
  type NoteRecord,
} from '../runState';
import { bridgeStream, type BridgeChunk } from '../eventBridge';
import {
  DEFAULT_AUTOCOMPACT_THRESHOLD_PCT,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  tokenTick,
} from '../budgets';
import type { ExternalEvent } from '../../base';
import { createFetchUrlTool, type FetchUrlConfig } from '../tools/fetchUrl';
import { createSearchWebTool, type SearchWebConfig } from '../tools/searchWeb';
import {
  createReadFileTool,
  createWriteFileTool,
  createListDirTool,
  createDeleteFileTool,
  createAppendFileTool,
  createGrepTool,
  createGlobTool,
  createDownloadToFileTool,
} from '../tools/fileOps';
import { createExtractNoteTool } from '../tools/extractNote';
import { createTodoWriteTool } from '../tools/todoWrite';
import { wrapToolResultForLLM } from '../tools/untrustedWrap';
import { rewriteConsumedToolResults, type RewriteMessage } from './messageRewriter';
import { compactMessages, decideCompaction } from '../compaction';
import type { InlineToolHandle } from '../branches/simpleBranch';

export interface ResearchStepCtx {
  readonly providerFactory: ProviderFactory;
  readonly config: InlineAgentConfig;
  readonly sandbox: Sandbox;
  readonly runState: InlineAgentRunState;
  readonly signal: AbortSignal;
  readonly logger: InlineAgentLogger;
  readonly planStep: string;
  readonly stepIndex: number;
  readonly perStepIterations: number;
  readonly searchWebApiKey: string;
  readonly tokenLimit: number;
  readonly initialMessages?: readonly RewriteMessage[];
  readonly runReactLoop?: (input: ResearchLoopInput) => AsyncIterable<BridgeChunk>;
  readonly now?: () => number;
}

export interface ResearchLoopInput {
  readonly tools: readonly InlineToolHandle[];
  readonly maxIterations: number;
  readonly signal: AbortSignal;
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
  readonly planStep: string;
  readonly stepIndex: number;
  readonly tokenLimit: number;
  readonly messages: readonly RewriteMessage[];
  readonly contextWindowTokens?: number;
  readonly autocompactThresholdPct?: number;
}

export interface ResearchStepResult {
  readonly notes: readonly NoteRecord[];
  readonly nextMessages: readonly RewriteMessage[];
  readonly status: 'completed' | 'iteration_limit' | 'token_limit' | 'aborted' | 'error';
  readonly errorCode?: string;
}

export function buildResearchStepTools(input: {
  readonly config: InlineAgentConfig;
  readonly sandbox: Sandbox;
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
  readonly signal: AbortSignal;
  readonly searchWebApiKey: string;
}): readonly InlineToolHandle[] {
  const { config, sandbox, runState, logger, signal } = input;
  const tools: InlineToolHandle[] = [];
  let fetchUrlTool: ReturnType<typeof createFetchUrlTool> | null = null;
  if (config.tools.fetchUrl.enabled) {
    const fetchCfg: FetchUrlConfig = {
      enabled: config.tools.fetchUrl.enabled,
      allowlist: config.tools.fetchUrl.allowlist,
      blocklist: config.tools.fetchUrl.blocklist,
      timeoutMs: config.tools.fetchUrl.timeoutMs,
      maxBytes: config.tools.fetchUrl.maxBytes,
      requireDnsResolveCheck: config.tools.fetchUrl.requireDnsResolveCheck,
      headerDenylist: config.tools.fetchUrl.headerDenylist,
    };
    fetchUrlTool = createFetchUrlTool({ config: fetchCfg, signal, logger });
    tools.push(fetchUrlTool);
  }
  if (config.tools.searchWeb.enabled) {
    const searchCfg: SearchWebConfig = {
      enabled: config.tools.searchWeb.enabled,
      apiKey: input.searchWebApiKey,
      defaultMaxResults: config.tools.searchWeb.defaultMaxResults,
      defaultSearchDepth: config.tools.searchWeb.defaultSearchDepth,
      defaultTopic: config.tools.searchWeb.defaultTopic,
      includeAnswer: config.tools.searchWeb.includeAnswer,
      timeoutMs: config.tools.searchWeb.timeoutMs,
      maxBytes: config.tools.searchWeb.maxBytes,
    };
    tools.push(createSearchWebTool({ config: searchCfg, signal, logger }));
  }
  if (config.tools.fileOps.enabled) {
    tools.push(createReadFileTool({ sandbox, signal, logger }));
    tools.push(createWriteFileTool({ sandbox, signal, logger }));
    tools.push(createAppendFileTool({ sandbox, signal, logger }));
    tools.push(createListDirTool({ sandbox, signal, logger }));
    tools.push(createDeleteFileTool({ sandbox, signal, logger }));
    tools.push(createGrepTool({ sandbox, signal, logger }));
    tools.push(createGlobTool({ sandbox, signal, logger }));
    if (fetchUrlTool !== null) {
      tools.push(createDownloadToFileTool({ sandbox, signal, logger, fetchUrl: fetchUrlTool }));
    }
  }
  // FR-IA-38: extract_note mandatory; publish_artifact excluded.
  tools.push(createExtractNoteTool({ runState, logger }));
  tools.push(createTodoWriteTool({ runState, logger }));
  return tools;
}

export async function* runManualResearchLoop(
  ctx: ResearchLoopInput,
  adapter: ManualChatModelAdapter,
): AsyncIterable<BridgeChunk> {
  const messages: RewriteMessage[] = [...ctx.messages];
  if (!messages.some((m) => m.role === 'user' || m.role === 'human')) {
    messages.push({ role: 'user', content: `Step ${ctx.stepIndex + 1}: ${ctx.planStep}` });
  }
  const consumedRefs = new Map<string, string>();
  const lastToolCallByName = new Map<string, string>();

  for (let iteration = 0; iteration < ctx.maxIterations; iteration += 1) {
    if (ctx.signal.aborted) return;
    const stepResult = yield* runIteration(
      ctx,
      adapter,
      messages,
      consumedRefs,
      lastToolCallByName,
    );
    if (stepResult === 'terminate') return;
    maybeCompactMessages(messages, ctx);
  }
  yield {
    kind: 'node_complete',
    node: 'researchStep',
    durationMs: 0,
    stepIndex: ctx.stepIndex,
  };
  yield {
    kind: 'error',
    error: {
      code: 'iteration_limit',
      message: `researchStep ${ctx.stepIndex} exceeded ${ctx.maxIterations} iterations`,
    },
  };
}

async function* runIteration(
  ctx: ResearchLoopInput,
  adapter: ManualChatModelAdapter,
  messages: RewriteMessage[],
  consumedRefs: Map<string, string>,
  lastToolCallByName: Map<string, string>,
): AsyncGenerator<BridgeChunk, 'continue' | 'terminate'> {
  const visible = rewriteConsumedToolResults(messages, consumedRefs);
  incrementIterations(ctx.runState, 1);
  let step: AssistantStep;
  try {
    step = await adapter.invokeTurn({
      messages: visible,
      toolNames: ctx.tools.map((t) => t.name),
      signal: ctx.signal,
    });
  } catch (err) {
    yield { kind: 'error', error: err };
    return 'terminate';
  }
  const tokenStat = tokenTick({
    cumulativeTokens: ctx.runState.cumulativeTokens,
    addedInputEstimate: 0,
    observedUsage: step.usage,
    maxTokens: ctx.tokenLimit,
  });
  addTokens(ctx.runState, step.usage);
  if (tokenStat.over) {
    yield {
      kind: 'error',
      error: {
        code: 'token_limit',
        message: `Inline agent token budget exhausted: cumulative ${ctx.runState.cumulativeTokens} > maxTokens ${ctx.tokenLimit}. Increase \`budgets.maxTokens\` in plugin settings (default 100000).`,
      },
    };
    return 'terminate';
  }
  if (step.text.length > 0) yield { kind: 'text', chunk: step.text };
  if (step.toolCalls.length === 0) {
    messages.push({ role: 'assistant', content: step.text });
    yield { kind: 'node_complete', node: 'researchStep', durationMs: 0, stepIndex: ctx.stepIndex };
    yield { kind: 'done' };
    return 'terminate';
  }
  messages.push({ role: 'assistant', content: step.text });
  for (const call of step.toolCalls) {
    yield* invokeAndRecord(call, ctx, messages, consumedRefs, lastToolCallByName);
  }
  return 'continue';
}

async function* invokeAndRecord(
  call: AssistantStep['toolCalls'][number],
  ctx: ResearchLoopInput,
  messages: RewriteMessage[],
  consumedRefs: Map<string, string>,
  lastToolCallByName: Map<string, string>,
): AsyncGenerator<BridgeChunk, void> {
  const tool = ctx.tools.find((t) => t.name === call.name);
  if (tool === undefined) {
    messages.push({
      role: 'tool',
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({ ok: false, error: 'unknown_tool' }),
    });
    return;
  }
  yield { kind: 'tool_start', tool: call.name, args: call.args };
  const { result, ok, errorCode, durationMs } = await invokeTool(tool, call);
  yield {
    kind: 'tool_end',
    tool: call.name,
    ok,
    durationMs,
    ...(errorCode !== undefined ? { error: errorCode } : {}),
  };
  messages.push({
    role: 'tool',
    toolCallId: call.id,
    name: call.name,
    content: JSON.stringify(wrapToolResultForLLM(call.name, result)),
  });
  trackConsumption(call, result, ok, consumedRefs, lastToolCallByName);
}

async function invokeTool(
  tool: { invoke(args: unknown): Promise<unknown> | unknown },
  call: { name: string; args: unknown },
): Promise<{ result: unknown; ok: boolean; errorCode: string | undefined; durationMs: number }> {
  const startedAt = Date.now();
  let result: unknown;
  let ok = true;
  let errorCode: string | undefined;
  try {
    result = await tool.invoke(call.args);
    if (typeof result === 'object' && result !== null && 'ok' in result) {
      const r = result as { ok: boolean; error?: string };
      ok = r.ok;
      if (!r.ok && typeof r.error === 'string') errorCode = r.error;
    }
  } catch (err) {
    ok = false;
    errorCode = err instanceof Error ? err.message : 'tool_throw';
    result = { ok: false, error: errorCode };
  }
  return { result, ok, errorCode, durationMs: Date.now() - startedAt };
}

// FR-IA-39: when extract_note succeeds, mark the most-recent fetch_url /
// search_web tool result as consumed.
function trackConsumption(
  call: { id: string; name: string },
  result: unknown,
  ok: boolean,
  consumedRefs: Map<string, string>,
  lastToolCallByName: Map<string, string>,
): void {
  if (call.name === 'extract_note' && ok) {
    const noteId =
      typeof result === 'object' && result !== null && 'data' in result
        ? ((result as { data?: { id?: string } }).data?.id ?? null)
        : null;
    if (typeof noteId !== 'string') return;
    for (const consumedTool of ['fetch_url', 'search_web']) {
      const consumedId = lastToolCallByName.get(consumedTool);
      if (consumedId !== undefined && !consumedRefs.has(consumedId)) {
        consumedRefs.set(consumedId, noteId);
        return;
      }
    }
    return;
  }
  if (call.name === 'fetch_url' || call.name === 'search_web') {
    lastToolCallByName.set(call.name, call.id);
  }
}

function maybeCompactMessages(messages: RewriteMessage[], ctx: ResearchLoopInput): void {
  const decision = decideCompaction(
    messages,
    ctx.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
    ctx.autocompactThresholdPct ?? DEFAULT_AUTOCOMPACT_THRESHOLD_PCT,
  );
  if (!decision.shouldCompact) return;
  const result = compactMessages(messages, ctx.runState);
  if (result.droppedCount === 0) return;
  ctx.logger.info('externalAgent.adapter.inlineAgent.autocompact', {
    route: 'multistep',
    stepIndex: ctx.stepIndex,
    droppedCount: result.droppedCount,
    preTokens: result.preTokens,
    postTokens: result.postTokens,
    thresholdTokens: decision.thresholdTokens,
  });
  messages.length = 0;
  for (const m of result.messages) messages.push(m);
}

export async function* runResearchStep(ctx: ResearchStepCtx): AsyncIterable<ExternalEvent> {
  const tools = buildResearchStepTools({
    config: ctx.config,
    sandbox: ctx.sandbox,
    runState: ctx.runState,
    logger: ctx.logger,
    signal: ctx.signal,
    searchWebApiKey: ctx.searchWebApiKey,
  });
  const loopCtx: ResearchLoopInput = {
    tools,
    maxIterations: ctx.perStepIterations,
    signal: ctx.signal,
    runState: ctx.runState,
    logger: ctx.logger,
    planStep: ctx.planStep,
    stepIndex: ctx.stepIndex,
    tokenLimit: ctx.tokenLimit,
    messages: ctx.initialMessages ?? [],
  };
  if (ctx.runReactLoop !== undefined) {
    yield* bridgeStream(ctx.runReactLoop(loopCtx), { logger: ctx.logger });
    return;
  }
  // F16/F18 wires the LangChain `BaseChatModel` → `ManualChatModelAdapter`.
  yield* bridgeStream(
    (async function* (): AsyncIterable<BridgeChunk> {
      yield {
        kind: 'error',
        error: {
          code: 'not_implemented',
          message: 'researchStep default loop requires F16 manualAdapter wiring',
        },
      };
    })(),
    { logger: ctx.logger },
  );
}
