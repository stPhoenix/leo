import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { plannerOutputSchema, type PlannerOutput } from '../tools/schemas';
import type { InlineAgentConfig } from '../configSchema';
import type { InlineAgentLogger, InvokeTraceConfig, ProviderFactory } from '../index';
import { mergeInvokeConfig } from '../router';
import { addTokens, incrementIterations, type InlineAgentRunState } from '../runState';
import type { BridgeChunk } from '../eventBridge';
import {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerPrompt,
} from '@/prompts/agent/externalAgent/adapters/inlineAgent/multistep/plannerPrompts';

export type PlannerResult =
  | { readonly ok: true; readonly plan: readonly string[] }
  | { readonly ok: false; readonly reason: 'empty' | 'unparsable' | 'llm_error' };

export interface PlannerInput {
  readonly providerFactory: ProviderFactory;
  readonly config: InlineAgentConfig;
  readonly refinedAsk: string;
  readonly initialPlan?: readonly string[];
  readonly signal: AbortSignal;
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
  readonly emit?: (chunk: BridgeChunk) => void;
  readonly chatModel?: BaseChatModel;
  readonly now?: () => number;
  readonly traceConfig?: InvokeTraceConfig;
}

export async function planSteps(input: PlannerInput): Promise<PlannerResult> {
  const planMaxSteps = clamp(input.config.planner.planMaxSteps, 1, 16);
  const now = input.now ?? ((): number => Date.now());
  const start = now();

  if (input.initialPlan !== undefined && input.initialPlan.length > 0) {
    return handleInitialPlan(input, planMaxSteps);
  }

  const baseModel = resolveBaseModel(input);
  if (baseModel === null) {
    input.logger.warn('externalAgent.adapter.inlineAgent.multistep.planner-fallback', {
      reason: 'invalid_provider',
    });
    return { ok: false, reason: 'llm_error' };
  }

  const parsed = await runPlannerWithRetry(input, baseModel, planMaxSteps);
  if (parsed === null) return { ok: false, reason: 'unparsable' };

  const clamped = clampPlan(parsed.plan, planMaxSteps);
  input.emit?.({
    kind: 'node_complete',
    node: 'planner',
    durationMs: now() - start,
    planLength: clamped.length,
  });
  return clamped.length === 0 ? { ok: false, reason: 'empty' } : { ok: true, plan: clamped };
}

function handleInitialPlan(input: PlannerInput, planMaxSteps: number): PlannerResult {
  const clamped = clampPlan(input.initialPlan!, planMaxSteps);
  input.emit?.({
    kind: 'node_complete',
    node: 'planner',
    durationMs: 0,
    planLength: clamped.length,
  });
  if (clamped.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, plan: clamped };
}

function resolveBaseModel(input: PlannerInput): BaseChatModel | null {
  if (input.chatModel !== undefined) return input.chatModel;
  try {
    return input.providerFactory(input.config.providerId, input.config.model, {
      temperature: input.config.temperature,
      signal: input.signal,
    });
  } catch {
    return null;
  }
}

async function runPlannerWithRetry(
  input: PlannerInput,
  baseModel: BaseChatModel,
  planMaxSteps: number,
): Promise<PlannerOutput | null> {
  const userPrompt = buildPlannerPrompt(input.refinedAsk, planMaxSteps);
  let lastError: unknown = null;
  for (let i = 0; i < 2; i += 1) {
    try {
      incrementIterations(input.runState, 1);
      addTokens(input.runState, estimateTokens(input.refinedAsk) + 200);
      const model = i === 0 ? baseModel : pickRetryModel(input);
      return await attemptStructuredPlan(model, userPrompt, input);
    } catch (err) {
      lastError = err;
      if (input.signal.aborted) break;
    }
  }
  input.logger.warn('externalAgent.adapter.inlineAgent.multistep.planner-fallback', {
    reason: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return null;
}

function pickRetryModel(input: PlannerInput): BaseChatModel {
  return (
    input.chatModel ??
    input.providerFactory(input.config.providerId, input.config.model, {
      temperature: 0,
      signal: input.signal,
    })
  );
}

async function attemptStructuredPlan(
  model: BaseChatModel,
  userPrompt: string,
  input: PlannerInput,
): Promise<PlannerOutput> {
  const structured = (
    model as BaseChatModel & {
      withStructuredOutput?: (
        schema: typeof plannerOutputSchema,
        opts?: { name?: string },
      ) => {
        invoke: (
          messages: unknown,
          opts?: {
            signal?: AbortSignal;
            callbacks?: readonly unknown[];
            metadata?: Readonly<Record<string, unknown>>;
            tags?: readonly string[];
          },
        ) => Promise<unknown>;
      };
    }
  ).withStructuredOutput;
  if (typeof structured !== 'function') {
    throw new Error('chat model does not support withStructuredOutput');
  }
  const bound = structured.call(model, plannerOutputSchema, { name: 'planner' });
  const result = await bound.invoke(
    [new SystemMessage(PLANNER_SYSTEM_PROMPT), new HumanMessage(userPrompt)],
    mergeInvokeConfig({ signal: input.signal }, input.traceConfig),
  );
  return plannerOutputSchema.parse(result);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clampPlan(plan: readonly string[], max: number): readonly string[] {
  const out: string[] = [];
  for (const step of plan) {
    if (typeof step !== 'string') continue;
    const trimmed = step.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
    if (out.length === max) break;
  }
  return out;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
