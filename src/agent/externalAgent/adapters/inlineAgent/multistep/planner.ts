import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { plannerOutputSchema, type PlannerOutput } from '../tools/schemas';
import type { InlineAgentConfig } from '../configSchema';
import type { InlineAgentLogger, ProviderFactory } from '../index';
import { addTokens, incrementIterations, type InlineAgentRunState } from '../runState';
import type { BridgeChunk } from '../eventBridge';

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
}

const PLANNER_SYSTEM_PROMPT = `You are the inline-agent planner. Decompose the user's refined ask into 1..planMaxSteps short, independent research sub-questions. Output ONLY via the planner tool with field 'plan: string[]'. No prose, no enumeration markers — just clean sub-questions.`;

export async function planSteps(input: PlannerInput): Promise<PlannerResult> {
  const planMaxSteps = clamp(input.config.planner.planMaxSteps, 1, 16);
  const now = input.now ?? ((): number => Date.now());
  const start = now();

  if (input.initialPlan !== undefined && input.initialPlan.length > 0) {
    const clamped = clampPlan(input.initialPlan, planMaxSteps);
    input.emit?.({
      kind: 'node_complete',
      node: 'planner',
      durationMs: 0,
      planLength: clamped.length,
    });
    if (clamped.length === 0) return { ok: false, reason: 'empty' };
    return { ok: true, plan: clamped };
  }

  const baseModel =
    input.chatModel ??
    (() => {
      try {
        return input.providerFactory(input.config.providerId, input.config.model, {
          temperature: input.config.temperature,
          signal: input.signal,
        });
      } catch {
        return null;
      }
    })();
  if (baseModel === null) {
    input.logger.warn('externalAgent.adapter.inlineAgent.multistep.planner-fallback', {
      reason: 'invalid_provider',
    });
    return { ok: false, reason: 'llm_error' };
  }

  const userPrompt = buildPlannerPrompt(input.refinedAsk, planMaxSteps);
  const attempt = async (model: BaseChatModel): Promise<PlannerOutput> => {
    const structured = (
      model as BaseChatModel & {
        withStructuredOutput?: (
          schema: typeof plannerOutputSchema,
          opts?: { name?: string },
        ) => { invoke: (messages: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown> };
      }
    ).withStructuredOutput;
    if (typeof structured !== 'function') {
      throw new Error('chat model does not support withStructuredOutput');
    }
    const bound = structured.call(model, plannerOutputSchema, { name: 'planner' });
    const result = await bound.invoke(
      [new SystemMessage(PLANNER_SYSTEM_PROMPT), new HumanMessage(userPrompt)],
      { signal: input.signal },
    );
    return plannerOutputSchema.parse(result);
  };

  let parsed: PlannerOutput | null = null;
  let lastError: unknown = null;
  for (let i = 0; i < 2; i += 1) {
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
      parsed = await attempt(model);
      break;
    } catch (err) {
      lastError = err;
      if (input.signal.aborted) break;
    }
  }

  if (parsed === null) {
    input.logger.warn('externalAgent.adapter.inlineAgent.multistep.planner-fallback', {
      reason: lastError instanceof Error ? lastError.message : String(lastError),
    });
    return { ok: false, reason: 'unparsable' };
  }

  const clamped = clampPlan(parsed.plan, planMaxSteps);
  if (clamped.length === 0) {
    input.emit?.({
      kind: 'node_complete',
      node: 'planner',
      durationMs: now() - start,
      planLength: 0,
    });
    return { ok: false, reason: 'empty' };
  }
  input.emit?.({
    kind: 'node_complete',
    node: 'planner',
    durationMs: now() - start,
    planLength: clamped.length,
  });
  return { ok: true, plan: clamped };
}

function buildPlannerPrompt(refinedAsk: string, planMaxSteps: number): string {
  return [
    'Refined ask:',
    refinedAsk,
    '',
    `planMaxSteps = ${planMaxSteps}. Output the plan via the planner tool — no other text.`,
  ].join('\n');
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
