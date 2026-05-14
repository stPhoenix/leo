import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { type AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { classifyTaskOutputSchema, type ClassifyTaskOutput } from './tools/schemas';
import type { InlineAgentConfig } from './configSchema';
import type { InlineAgentLogger, InvokeTraceConfig, ProviderFactory } from './index';
import { addTokens, incrementIterations, setRoute, type InlineAgentRunState } from './runState';
import type { BridgeChunk } from './eventBridge';

import {
  CLASSIFIER_SYSTEM_PROMPT,
  TOOL_DESCRIPTIONS,
  buildClassifierUserPrompt,
  type ToolInventoryItem,
} from '@/prompts/agent/externalAgent/adapters/inlineAgent/routerPrompts';

export type { ToolInventoryItem };

export function buildToolInventory(config: InlineAgentConfig): ToolInventoryItem[] {
  const inv: ToolInventoryItem[] = [];
  if (config.tools.fetchUrl.enabled) {
    inv.push({ toolId: 'fetch_url', oneLineDescription: TOOL_DESCRIPTIONS.fetch_url! });
  }
  if (config.tools.searchWeb.enabled) {
    inv.push({ toolId: 'search_web', oneLineDescription: TOOL_DESCRIPTIONS.search_web! });
  }
  if (config.tools.fileOps.enabled) {
    inv.push({ toolId: 'read_file', oneLineDescription: TOOL_DESCRIPTIONS.read_file! });
    inv.push({ toolId: 'write_file', oneLineDescription: TOOL_DESCRIPTIONS.write_file! });
    inv.push({ toolId: 'list_dir', oneLineDescription: TOOL_DESCRIPTIONS.list_dir! });
    inv.push({ toolId: 'delete_file', oneLineDescription: TOOL_DESCRIPTIONS.delete_file! });
  }
  inv.push({ toolId: 'publish_artifact', oneLineDescription: TOOL_DESCRIPTIONS.publish_artifact! });
  return inv;
}

export interface ClassifyTaskInput {
  readonly providerFactory: ProviderFactory;
  readonly config: InlineAgentConfig;
  readonly refinedAsk: string;
  readonly signal: AbortSignal;
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
  readonly emit?: (chunk: BridgeChunk) => void;
  /**
   * Optional override (testing) — bypass providerFactory and use a pre-built
   * ChatModel.
   */
  readonly chatModel?: BaseChatModel;
  readonly now?: () => number;
  readonly traceConfig?: InvokeTraceConfig;
}

export interface ClassifyTaskNodeResult {
  readonly route: 'simple' | 'multistep';
  readonly reasoning: string;
  readonly initialPlan?: readonly string[];
  readonly fallback?: boolean;
}

export async function classifyTask(input: ClassifyTaskInput): Promise<ClassifyTaskNodeResult> {
  const override = handleRoutingOverride(input);
  if (override !== null) return override;

  const now = input.now ?? ((): number => Date.now());
  const start = now();
  const planMaxSteps = input.config.planner.planMaxSteps;
  const userPrompt = buildClassifierUserPrompt(
    input.refinedAsk,
    buildToolInventory(input.config),
    planMaxSteps,
  );

  const baseModel =
    input.chatModel ??
    input.providerFactory(input.config.providerId, input.config.model, {
      temperature: input.config.temperature,
      signal: input.signal,
    });

  const parsed = await runClassifierWithRetry(input, baseModel, userPrompt, now);
  if (parsed === null) return emitFallback(input, start, now);

  return emitClassified(input, parsed, planMaxSteps, start, now);
}

function handleRoutingOverride(input: ClassifyTaskInput): ClassifyTaskNodeResult | null {
  const mode = input.config.routing.mode;
  if (mode === 'simple' || mode === 'deep') {
    const route: 'simple' | 'multistep' = mode === 'simple' ? 'simple' : 'multistep';
    setRoute(input.runState, route);
    input.emit?.({ kind: 'node_complete', node: 'classify_task', durationMs: 0, route });
    return { route, reasoning: `override:${mode}` };
  }
  return null;
}

async function runClassifierWithRetry(
  input: ClassifyTaskInput,
  baseModel: BaseChatModel,
  userPrompt: string,
  now: () => number,
): Promise<ClassifyTaskOutput | null> {
  let lastError: unknown = null;
  const classifyStartedAt = now();
  for (let i = 0; i < 2; i += 1) {
    const attemptStart = now();
    try {
      incrementIterations(input.runState, 1);
      addTokens(input.runState, estimateTokens(input.refinedAsk) + 200);
      const model =
        i === 0
          ? baseModel
          : (input.chatModel ??
            input.providerFactory(input.config.providerId, input.config.model, {
              temperature: 0,
              signal: input.signal,
            }));
      input.logger.info('externalAgent.adapter.inlineAgent.router.attempt.start', {
        attempt: i + 1,
        signalAborted: input.signal.aborted,
        sinceClassifyStartMs: now() - classifyStartedAt,
      });
      const parsed = await attemptClassify(model, userPrompt, input);
      input.logger.info('externalAgent.adapter.inlineAgent.router.attempt.ok', {
        attempt: i + 1,
        durationMs: now() - attemptStart,
        route: parsed.route,
      });
      return parsed;
    } catch (err) {
      lastError = err;
      input.logger.warn('externalAgent.adapter.inlineAgent.router.attempt.fail', {
        attempt: i + 1,
        durationMs: now() - attemptStart,
        signalAborted: input.signal.aborted,
        errName: err instanceof Error ? err.constructor.name : typeof err,
        errMsg: err instanceof Error ? err.message : String(err),
      });
      if (input.signal.aborted) break;
    }
  }
  input.logger.warn('externalAgent.adapter.inlineAgent.router.classify-fallback', {
    reason: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return null;
}

async function attemptClassify(
  model: BaseChatModel,
  userPrompt: string,
  input: ClassifyTaskInput,
): Promise<ClassifyTaskOutput> {
  const binder = (model as unknown as { bindTools?: (defs: unknown[]) => BaseChatModel }).bindTools;
  if (typeof binder !== 'function') {
    throw new Error('chat model does not support bindTools');
  }
  const bound = binder.call(model, [
    {
      name: 'classify_task',
      description:
        "Decide whether the task is 'simple' (one tool round-trip) or 'multistep' (plan + multiple sources + synthesis). Optionally include initialPlan with 1..planMaxSteps short sub-questions.",
      schema: classifyTaskOutputSchema,
    },
  ]);
  const result = (await bound.invoke(
    [new SystemMessage(CLASSIFIER_SYSTEM_PROMPT), new HumanMessage(userPrompt)],
    mergeInvokeConfig({ signal: input.signal }, input.traceConfig) as Record<string, unknown>,
  )) as AIMessage;
  const calls =
    (result as unknown as { tool_calls?: ReadonlyArray<{ name?: string; args?: unknown }> })
      .tool_calls ?? [];
  const classifyCall = calls.find((c) => c.name === 'classify_task') ?? calls[0];
  if (classifyCall?.args === undefined) throw new Error('classifier emitted no tool call');
  return classifyTaskOutputSchema.parse(classifyCall.args);
}

function emitFallback(
  input: ClassifyTaskInput,
  start: number,
  now: () => number,
): ClassifyTaskNodeResult {
  setRoute(input.runState, 'simple');
  input.emit?.({
    kind: 'node_complete',
    node: 'classify_task',
    durationMs: now() - start,
    route: 'simple',
  });
  return { route: 'simple', reasoning: 'classifier_fallback', fallback: true };
}

function emitClassified(
  input: ClassifyTaskInput,
  parsed: ClassifyTaskOutput,
  planMaxSteps: number,
  start: number,
  now: () => number,
): ClassifyTaskNodeResult {
  const clampedPlan = parsed.initialPlan?.slice(0, planMaxSteps);
  setRoute(input.runState, parsed.route);
  input.emit?.({
    kind: 'node_complete',
    node: 'classify_task',
    durationMs: now() - start,
    route: parsed.route,
    ...(clampedPlan !== undefined ? { planLength: clampedPlan.length } : {}),
  });
  return {
    route: parsed.route,
    reasoning: parsed.reasoning,
    ...(clampedPlan !== undefined && clampedPlan.length > 0 ? { initialPlan: clampedPlan } : {}),
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function mergeInvokeConfig(
  base: { signal: AbortSignal },
  trace: InvokeTraceConfig | undefined,
): {
  signal: AbortSignal;
  callbacks?: readonly unknown[];
  metadata?: Readonly<Record<string, unknown>>;
  tags?: readonly string[];
} {
  if (trace === undefined) return base;
  return {
    ...base,
    ...(trace.callbacks !== undefined ? { callbacks: trace.callbacks } : {}),
    ...(trace.metadata !== undefined ? { metadata: trace.metadata } : {}),
    ...(trace.tags !== undefined ? { tags: trace.tags } : {}),
  };
}
