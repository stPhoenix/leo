import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ExternalEvent } from '../base';
import type { InlineAgentLogger, InvokeTraceConfig, ProviderFactory } from './index';
import { resolveSystemPrompt } from './index';
import { getInlineAgentResearchPrompt, getInlineAgentSynthesizePrompt } from './systemPrompt';
import { inlineAgentConfigSchema, type InlineAgentConfig } from './configSchema';
import { Sandbox } from './sandbox';
import { createInitialRunState, setPlan, type InlineAgentRunState } from './runState';
import {
  composeAbortSignal,
  perStepBudget,
  selectMaxIterations,
  type ComposedAbort,
} from './budgets';
import { bridgeStream, mapAdapterError, mapNodeComplete, type BridgeChunk } from './eventBridge';
import { classifyTask } from './router';
import { buildSimpleBranchTools, runManualLoop, type ReactLoopCtx } from './branches/simpleBranch';
import { planSteps } from './multistep/planner';
import {
  buildResearchStepTools,
  runManualResearchLoop,
  type ManualChatModelAdapter,
} from './multistep/researchStep';
import {
  buildSynthesizeTools,
  buildSynthesizePrompt,
  runManualSynthesizeLoop,
  selectSynthesizeIterations,
} from './multistep/synthesize';
import {
  dropRawToolMessagesAtStepBoundary,
  type RewriteMessage,
} from './multistep/messageRewriter';
import { flushPublishedArtifacts } from './artifactFlush';

export interface InlineAgentGraphDeps {
  readonly providerFactory: ProviderFactory;
  readonly logger: InlineAgentLogger;
  /** Optional override: convert a BaseChatModel into a ManualChatModelAdapter. */
  readonly chatModelAdapter?: (
    model: BaseChatModel,
    traceConfig?: InvokeTraceConfig,
  ) => ManualChatModelAdapter;
  /** Optional override of the wall-clock signal helper for tests. */
  readonly composeSignal?: typeof composeAbortSignal;
  /** Optional resolved Tavily api key (already walked from safeStorage:). */
  readonly resolveSearchWebApiKey?: (config: InlineAgentConfig) => string;
  /** Optional Langfuse trace config attached to every LLM invoke. */
  readonly traceConfig?: InvokeTraceConfig;
}

export interface InlineAgentGraphInput {
  readonly refinedAsk: string;
  readonly systemPrompt: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly config: unknown;
  readonly runId: string;
}

export const FORBIDDEN_TOOL_NAMES: readonly string[] = ['delegate_external'];

export function assertNoExternalDelegate(
  toolLists: readonly {
    readonly branch: string;
    readonly tools: readonly { readonly name: string }[];
  }[],
): void {
  for (const list of toolLists) {
    for (const tool of list.tools) {
      if (FORBIDDEN_TOOL_NAMES.includes(tool.name)) {
        throw new Error(
          `recursion_guard_violation: branch '${list.branch}' contains forbidden tool '${tool.name}'`,
        );
      }
    }
  }
}

interface InlineModelSetup {
  readonly chatModel: BaseChatModel;
  readonly manualAdapter: ManualChatModelAdapter;
  readonly error: null;
}

interface InlineModelSetupError {
  readonly chatModel: null;
  readonly manualAdapter: null;
  readonly error: ExternalEvent;
}

function resolveInlineModel(
  deps: InlineAgentGraphDeps,
  parsed: InlineAgentConfig,
  composed: ComposedAbort,
): InlineModelSetup | InlineModelSetupError {
  let chatModel: BaseChatModel | null;
  try {
    chatModel = deps.providerFactory(parsed.providerId, parsed.model, {
      temperature: parsed.temperature,
      signal: composed.signal,
    });
  } catch {
    chatModel = null;
  }
  if (chatModel === null) {
    return {
      chatModel: null,
      manualAdapter: null,
      error: mapAdapterError({
        code: 'invalid_provider',
        message: `providerFactory failed for ${parsed.providerId}/${parsed.model}`,
      }),
    };
  }
  const manualAdapter =
    deps.chatModelAdapter !== undefined
      ? deps.chatModelAdapter(chatModel, deps.traceConfig)
      : ((chatModel as unknown as { manualAdapter?: ManualChatModelAdapter }).manualAdapter ??
        null);
  if (manualAdapter === null) {
    return {
      chatModel: null,
      manualAdapter: null,
      error: mapAdapterError({
        code: 'invalid_provider',
        message: 'inline agent requires a ManualChatModelAdapter (set deps.chatModelAdapter)',
      }),
    };
  }
  return { chatModel, manualAdapter, error: null };
}

async function* runPlanPhase(args: {
  classifier: { route: 'simple' | 'multistep'; initialPlan?: readonly string[] };
  deps: InlineAgentGraphDeps;
  parsed: InlineAgentConfig;
  input: InlineAgentGraphInput;
  composed: ComposedAbort;
  runState: InlineAgentRunState;
  chatModel: BaseChatModel;
}): AsyncGenerator<ExternalEvent, { route: 'simple' | 'multistep'; plan: readonly string[] }> {
  const { classifier, deps, parsed, input, composed, runState, chatModel } = args;
  if (classifier.route !== 'multistep') {
    return { route: classifier.route, plan: [] };
  }
  const planResult = await planSteps({
    providerFactory: deps.providerFactory,
    config: parsed,
    refinedAsk: input.refinedAsk,
    ...(classifier.initialPlan !== undefined ? { initialPlan: classifier.initialPlan } : {}),
    signal: composed.signal,
    runState,
    logger: deps.logger,
    chatModel,
    ...(deps.traceConfig !== undefined ? { traceConfig: deps.traceConfig } : {}),
  });
  if (planResult.ok) {
    setPlan(runState, planResult.plan);
    yield mapNodeComplete({ node: 'planner', durationMs: 0, planLength: planResult.plan.length });
    return { route: 'multistep', plan: planResult.plan };
  }
  if (planResult.reason === 'empty') {
    deps.logger.warn('externalAgent.adapter.inlineAgent.multistep.planner-fallback', {
      reason: planResult.reason,
    });
  }
  return { route: 'simple', plan: [] };
}

export async function* runInlineAgentGraph(
  deps: InlineAgentGraphDeps,
  input: InlineAgentGraphInput,
): AsyncIterable<ExternalEvent> {
  let parsed: InlineAgentConfig;
  try {
    parsed = inlineAgentConfigSchema.parse(input.config ?? {});
  } catch (err) {
    yield mapAdapterError({
      code: 'invalid_config',
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const compose = deps.composeSignal ?? composeAbortSignal;
  const wallClockMs = Math.max(1, parsed.budgets.wallClockMs);
  const effectiveTimeoutMs = Math.min(input.timeoutMs || wallClockMs, wallClockMs);
  const inlineRunStartedAt = Date.now();
  const composed = compose(input.signal, effectiveTimeoutMs);
  deps.logger.info('externalAgent.adapter.inlineAgent.composed.start', {
    runId: input.runId,
    inputTimeoutMs: input.timeoutMs ?? null,
    wallClockMs,
    effectiveTimeoutMs,
    hostAlreadyAborted: input.signal.aborted,
  });
  const onComposedAbort = (): void => {
    deps.logger.warn('externalAgent.adapter.inlineAgent.composed.abort', {
      runId: input.runId,
      reason: composed.reason() ?? 'unknown',
      elapsedMs: Date.now() - inlineRunStartedAt,
      hostAborted: input.signal.aborted,
    });
  };
  composed.signal.addEventListener('abort', onComposedAbort, { once: true });

  const sandbox = new Sandbox({
    runId: input.runId,
    logger: deps.logger,
    quotaBytes: parsed.sandbox.quotaBytes,
  });
  const runState = createInitialRunState({
    runId: input.runId,
    sandboxRoot: sandbox.root,
    routingMode: parsed.routing.mode,
    startedAt: Date.now(),
  });

  try {
    const initResult = await sandbox.init();
    if (!initResult.ok) {
      yield mapAdapterError({
        code: initResult.error,
        message: initResult.cause ?? 'sandbox initialization failed',
      });
      return;
    }

    const searchWebApiKey =
      deps.resolveSearchWebApiKey?.(parsed) ?? parsed.tools.searchWeb.apiKeyRef ?? '';

    // Recursion-guard pre-check on tool-list assembly.
    const simpleTools = buildSimpleBranchTools({
      config: parsed,
      sandbox,
      runState,
      logger: deps.logger,
      signal: composed.signal,
      searchWebApiKey,
    });
    const researchTools = buildResearchStepTools({
      config: parsed,
      sandbox,
      runState,
      logger: deps.logger,
      signal: composed.signal,
      searchWebApiKey,
    });
    const synthTools = buildSynthesizeTools({
      config: parsed,
      sandbox,
      runState,
      logger: deps.logger,
    });
    try {
      assertNoExternalDelegate([
        { branch: 'simple', tools: simpleTools },
        { branch: 'researchStep', tools: researchTools },
        { branch: 'synthesize', tools: synthTools },
      ]);
    } catch (err) {
      yield mapAdapterError({
        code: 'recursion_guard_violation',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const composedSystemPrompt = resolveSystemPrompt({
      hostPrompt: input.systemPrompt,
      override: null,
    });

    const modelSetup = resolveInlineModel(deps, parsed, composed);
    if (modelSetup.error !== null) {
      yield modelSetup.error;
      return;
    }
    const { chatModel, manualAdapter } = modelSetup;

    // Phase 1 — classify + plan
    const classifier = await classifyTask({
      providerFactory: deps.providerFactory,
      config: parsed,
      refinedAsk: input.refinedAsk,
      signal: composed.signal,
      runState,
      logger: deps.logger,
      chatModel,
      ...(deps.traceConfig !== undefined ? { traceConfig: deps.traceConfig } : {}),
    });
    yield mapNodeComplete({
      node: 'classify_task',
      durationMs: 0,
      route: classifier.route,
      ...(classifier.initialPlan !== undefined
        ? { planLength: classifier.initialPlan.length }
        : {}),
    });

    const planPhase = yield* runPlanPhase({
      classifier,
      deps,
      parsed,
      input,
      composed,
      runState,
      chatModel,
    });
    const route = planPhase.route;
    const plan = planPhase.plan;

    // Phase 2 — branch execution
    const branchOutcome =
      route === 'simple'
        ? runSimpleBranch({
            parsed,
            input,
            manualAdapter,
            chatModel,
            simpleTools,
            composedSystemPrompt,
            composed,
            runState,
            logger: deps.logger,
          })
        : runMultistepBranch({
            parsed,
            input,
            manualAdapter,
            researchTools,
            synthTools,
            plan,
            composed,
            runState,
            logger: deps.logger,
          });

    let deferredError: ExternalEvent | null = null;
    let earlyReturn = false;
    for await (const ev of branchOutcome) {
      if (ev.type === 'deferred-error') {
        deferredError = ev.event;
        continue;
      }
      if (ev.type === 'early-return') {
        yield ev.event;
        earlyReturn = true;
        break;
      }
      yield ev;
    }
    if (earlyReturn) return;

    // Phase 3 — flush artifacts (partial-flush on error path is intentional;
    // FR-IA-36 keeps prior nominations even when the branch terminated with
    // `iteration_limit`).
    yield* flushPublishedArtifacts({ runState, sandbox, logger: deps.logger });
    if (deferredError !== null) {
      yield enrichWallClockError(deferredError, composed, effectiveTimeoutMs);
      return;
    }
    yield { type: 'done' };
  } catch (err) {
    yield enrichWallClockError(mapAdapterError(err), composed, effectiveTimeoutMs);
  } finally {
    composed.cancel();
    await sandbox.cleanup();
  }
}

function enrichWallClockError(
  ev: ExternalEvent,
  composed: { reason: () => 'host' | 'timeout' | null },
  effectiveTimeoutMs: number,
): ExternalEvent {
  if (ev.type !== 'error') return ev;
  if (composed.reason() !== 'timeout') return ev;
  const seconds = Math.round(effectiveTimeoutMs / 1000);
  return {
    type: 'error',
    error: {
      code: 'wall_clock_exceeded',
      message: `Inline agent wall-clock budget exhausted (${effectiveTimeoutMs}ms / ~${seconds}s). Increase \`budgets.wallClockMs\` in plugin settings; current value is too short for the task. Underlying: ${ev.error.code} — ${ev.error.message}`,
    },
  };
}

function composeStagePrompt(hostPrompt: string, stagePrompt: string): string {
  if (hostPrompt.length === 0) return stagePrompt;
  return `${hostPrompt}\n\n${stagePrompt}`;
}

type BranchEvent =
  | ExternalEvent
  | { readonly type: 'deferred-error'; readonly event: ExternalEvent }
  | { readonly type: 'early-return'; readonly event: ExternalEvent };

interface SimpleBranchInput {
  readonly parsed: InlineAgentConfig;
  readonly input: InlineAgentGraphInput;
  readonly manualAdapter: ManualChatModelAdapter;
  readonly chatModel: BaseChatModel;
  readonly simpleTools: ReturnType<typeof buildSimpleBranchTools>;
  readonly composedSystemPrompt: string;
  readonly composed: { readonly signal: AbortSignal };
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
}

async function* runSimpleBranch(args: SimpleBranchInput): AsyncIterable<BranchEvent> {
  const {
    parsed,
    input,
    manualAdapter,
    chatModel,
    simpleTools,
    composedSystemPrompt,
    composed,
    runState,
    logger,
  } = args;
  const cap = selectMaxIterations('simple', parsed.budgets);
  const remaining = Math.max(0, cap - runState.iterations);
  const loopCtx: ReactLoopCtx = {
    chatModel,
    tools: simpleTools,
    maxIterations: remaining,
    signal: composed.signal,
    refinedAsk: input.refinedAsk,
    systemPrompt: composedSystemPrompt,
    runState,
    logger,
    tokenLimit: parsed.budgets.maxTokens,
    contextWindowTokens: parsed.budgets.contextWindowTokens,
    autocompactThresholdPct: parsed.budgets.autocompactThresholdPct,
  };
  for await (const ev of bridgeStream(runManualLoop(loopCtx, manualAdapter), { logger })) {
    if (ev.type === 'error') {
      yield { type: 'deferred-error', event: ev };
      return;
    }
    if (ev.type === 'done') return;
    yield ev;
  }
}

interface MultistepBranchInput {
  readonly parsed: InlineAgentConfig;
  readonly input: InlineAgentGraphInput;
  readonly manualAdapter: ManualChatModelAdapter;
  readonly researchTools: ReturnType<typeof buildResearchStepTools>;
  readonly synthTools: ReturnType<typeof buildSynthesizeTools>;
  readonly plan: readonly string[];
  readonly composed: { readonly signal: AbortSignal };
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
}

async function* runMultistepBranch(args: MultistepBranchInput): AsyncIterable<BranchEvent> {
  const {
    parsed,
    input,
    manualAdapter,
    researchTools,
    synthTools,
    plan,
    composed,
    runState,
    logger,
  } = args;
  const cap = selectMaxIterations('multistep', parsed.budgets);
  const researchSystemPrompt = composeStagePrompt(
    input.systemPrompt,
    getInlineAgentResearchPrompt(),
  );
  let messagesCarried: readonly RewriteMessage[] = [
    { role: 'system', content: researchSystemPrompt },
    { role: 'user', content: input.refinedAsk },
  ];
  const researchOutcome = yield* runResearchSteps({
    parsed,
    manualAdapter,
    researchTools,
    plan,
    cap,
    composed,
    runState,
    logger,
    initialMessages: messagesCarried,
  });
  if (researchOutcome.aborted) return;
  messagesCarried = researchOutcome.messages;

  const remainingIterations = Math.max(0, cap - runState.iterations);
  const synthMax = selectSynthesizeIterations(remainingIterations);
  const synthMessages: readonly RewriteMessage[] = [
    {
      role: 'system',
      content: composeStagePrompt(input.systemPrompt, getInlineAgentSynthesizePrompt()),
    },
    {
      role: 'user',
      content: buildSynthesizePrompt({
        refinedAsk: input.refinedAsk,
        plan,
        notes: runState.notes,
        scratchpad: runState.scratchpad,
      }),
    },
  ];
  const synthGen = runManualSynthesizeLoop(
    {
      tools: synthTools,
      maxIterations: synthMax,
      signal: composed.signal,
      runState,
      logger,
      tokenLimit: parsed.budgets.maxTokens,
      messages: synthMessages,
    },
    manualAdapter,
  );
  for await (const ev of bridgeStream(synthGen, { logger })) {
    if (ev.type === 'error') {
      yield { type: 'deferred-error', event: ev };
      return;
    }
    if (ev.type === 'done') return;
    yield ev;
  }
}

interface ResearchStepsInput {
  readonly parsed: InlineAgentConfig;
  readonly manualAdapter: ManualChatModelAdapter;
  readonly researchTools: ReturnType<typeof buildResearchStepTools>;
  readonly plan: readonly string[];
  readonly cap: number;
  readonly composed: { readonly signal: AbortSignal };
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
  readonly initialMessages: readonly RewriteMessage[];
}

async function* runResearchSteps(
  args: ResearchStepsInput,
): AsyncGenerator<BranchEvent, { aborted: boolean; messages: readonly RewriteMessage[] }> {
  const { parsed, manualAdapter, researchTools, plan, cap, composed, runState, logger } = args;
  let messagesCarried = args.initialMessages;
  const remainingSteps = plan.length;
  for (let i = 0; i < remainingSteps; i += 1) {
    runState.currentStep = i;
    const remainingIterations = Math.max(0, cap - runState.iterations);
    const remaining = remainingSteps - i;
    const stepBudget = perStepBudget({ remainingIterations, remainingSteps: remaining });
    if (stepBudget <= 0 || composed.signal.aborted) break;
    const generator = runManualResearchLoop(
      {
        tools: researchTools,
        maxIterations: stepBudget,
        signal: composed.signal,
        runState,
        logger,
        planStep: plan[i] ?? '',
        stepIndex: i,
        tokenLimit: parsed.budgets.maxTokens,
        messages: messagesCarried,
        contextWindowTokens: parsed.budgets.contextWindowTokens,
        autocompactThresholdPct: parsed.budgets.autocompactThresholdPct,
      },
      manualAdapter,
    );
    const stepOutcome = yield* runResearchStep(generator, logger);
    if (stepOutcome === 'token-limit') return { aborted: true, messages: messagesCarried };
    if (stepOutcome === 'aborted') return { aborted: true, messages: messagesCarried };
    messagesCarried = dropRawToolMessagesAtStepBoundary(messagesCarried);
  }
  return { aborted: false, messages: messagesCarried };
}

async function* runResearchStep(
  generator: AsyncIterable<BridgeChunk>,
  logger: InlineAgentLogger,
): AsyncGenerator<BranchEvent, 'continue' | 'aborted' | 'token-limit'> {
  for await (const ev of bridgeStream(generator, { logger })) {
    if (ev.type === 'error') {
      const code = ev.error.code;
      if (code === 'iteration_limit') return 'continue'; // step-level cap; advance.
      if (code === 'token_limit') {
        yield { type: 'early-return', event: ev };
        return 'token-limit';
      }
      yield ev;
      return 'aborted';
    }
    if (ev.type === 'done') return 'continue';
    yield ev;
  }
  return 'continue';
}
