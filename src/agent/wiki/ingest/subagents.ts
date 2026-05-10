import type { ZodType } from 'zod';
import type { Logger } from '@/platform/Logger';
import { roughTokenCountEstimation } from '@/agent/tokenEstimator';
import { WIKI_BUDGETS, type WikiBudgets } from '@/agent/wiki/budgets';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import {
  ExtractorOutputSchema,
  PlannerOutputSchema,
  ReducerOutputSchema,
  type ExtractorOutput,
  type PlannerOutput,
  type ReducerOutput,
} from './schemas';
import {
  EXTRACTOR_SYSTEM,
  PLANNER_SYSTEM,
  REDUCER_SYSTEM,
  buildExtractorUserPrompt,
  buildPlannerUserPrompt,
  buildReducerUserPrompt,
} from '@/prompts/agent/wiki/ingest/subagentPrompts';

export interface LlmJsonInvoker {
  invoke<T>(
    input: { readonly system: string; readonly user: string },
    schema: ZodType<T>,
    name: string,
    signal: AbortSignal,
  ): Promise<T>;
}

export interface PlannerInput {
  readonly ingestId: string;
  readonly schemaMd: string;
  readonly indexExcerpt: string;
  readonly perSource: readonly {
    readonly rawPath: string;
    readonly frontmatterText: string;
    readonly bodyHead: string;
  }[];
}

export interface PlannerDeps {
  readonly invoke: LlmJsonInvoker;
  readonly logger?: Logger;
  readonly budgets?: WikiBudgets;
}

export type SubagentResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

export async function runPlanner(
  input: PlannerInput,
  deps: PlannerDeps,
  signal: AbortSignal,
): Promise<SubagentResult<PlannerOutput>> {
  const budgets = deps.budgets ?? WIKI_BUDGETS;
  const userPrompt = buildPlannerUserPrompt(input, budgets);
  const result = await invokeStructured({
    invoke: deps.invoke,
    schema: PlannerOutputSchema,
    name: 'wiki_planner',
    system: PLANNER_SYSTEM,
    user: userPrompt,
    inputCap: budgets.plannerInputCap,
    signal,
    logger: deps.logger,
  });
  if (!result.ok) {
    deps.logger?.debug(WIKI_LOG.ingest.plan.invalid, { error: result.error });
  }
  return result;
}

export interface ExtractorInput {
  readonly rawPath: string;
  readonly rawBody: string;
  readonly schemaMd: string;
  readonly candidatePages: readonly string[];
  readonly indexExcerpt: string;
}

export interface ExtractorDeps {
  readonly invoke: LlmJsonInvoker;
  readonly logger?: Logger;
  readonly budgets?: WikiBudgets;
}

export async function runExtractor(
  input: ExtractorInput,
  deps: ExtractorDeps,
  signal: AbortSignal,
): Promise<SubagentResult<ExtractorOutput>> {
  const budgets = deps.budgets ?? WIKI_BUDGETS;
  const userPrompt = buildExtractorUserPrompt(input, budgets);
  const result = await invokeStructured({
    invoke: deps.invoke,
    schema: ExtractorOutputSchema,
    name: 'wiki_extractor',
    system: EXTRACTOR_SYSTEM,
    user: userPrompt,
    inputCap: budgets.extractorInputCap,
    signal,
    logger: deps.logger,
    errorCode: 'extract_invalid',
  });
  if (!result.ok) {
    deps.logger?.debug(WIKI_LOG.ingest.extract.invalid, { rawPath: input.rawPath });
  } else {
    deps.logger?.debug(WIKI_LOG.ingest.extract.ok, {
      rawPath: input.rawPath,
      pageOps: result.data.pageOps.length,
    });
  }
  return result;
}

export interface ReducerInput {
  readonly pageSlug: string;
  readonly currentBody: string | null;
  readonly schemaMd: string;
  readonly pageOps: readonly unknown[];
}

export interface ReducerDeps {
  readonly invoke: LlmJsonInvoker;
  readonly logger?: Logger;
  readonly budgets?: WikiBudgets;
}

export async function runReducer(
  input: ReducerInput,
  deps: ReducerDeps,
  signal: AbortSignal,
): Promise<SubagentResult<ReducerOutput>> {
  const budgets = deps.budgets ?? WIKI_BUDGETS;
  const userPrompt = buildReducerUserPrompt(input, budgets);
  const result = await invokeStructured({
    invoke: deps.invoke,
    schema: ReducerOutputSchema,
    name: 'wiki_reducer',
    system: REDUCER_SYSTEM,
    user: userPrompt,
    inputCap: budgets.reducerInputCap,
    signal,
    logger: deps.logger,
    errorCode: 'reduce_invalid',
  });
  if (!result.ok) {
    deps.logger?.debug(WIKI_LOG.ingest.reduce.invalid, { pageSlug: input.pageSlug });
  } else {
    deps.logger?.debug(WIKI_LOG.ingest.reduce.ok, {
      pageSlug: input.pageSlug,
      action: result.data.action,
    });
  }
  return result;
}

interface InvokeStructuredArgs<T> {
  readonly invoke: LlmJsonInvoker;
  readonly schema: ZodType<T>;
  readonly name: string;
  readonly system: string;
  readonly user: string;
  readonly inputCap: number;
  readonly signal: AbortSignal;
  readonly logger?: Logger;
  readonly errorCode?: string;
}

async function invokeStructured<T>(args: InvokeStructuredArgs<T>): Promise<SubagentResult<T>> {
  if (args.signal.aborted) return { ok: false, error: 'aborted' };
  const inputTokens = roughTokenCountEstimation(args.user) + roughTokenCountEstimation(args.system);
  const userPrompt =
    inputTokens > args.inputCap ? truncateForCap(args.user, args.inputCap * 4) : args.user;
  try {
    const data = await args.invoke.invoke(
      { system: args.system, user: userPrompt },
      args.schema,
      args.name,
      args.signal,
    );
    return { ok: true, data };
  } catch (err) {
    if (args.signal.aborted) return { ok: false, error: 'aborted' };
    const message = err instanceof Error ? err.message : String(err);
    args.logger?.debug(WIKI_LOG.ingest.extract.retry, { error: message });
    return { ok: false, error: args.errorCode ?? message };
  }
}

function truncateForCap(text: string, charCap: number): string {
  if (text.length <= charCap) return text;
  return `${text.slice(0, charCap)}…`;
}
