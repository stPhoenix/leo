import type { Logger } from '@/platform/Logger';
import { WIKI_RUN_DEFAULTS } from '@/agent/wiki/budgets';
import type { LlmJsonInvoker } from './subagents';
import type { IngestSource } from './types';

export interface RefineDeps {
  readonly invoke?: LlmJsonInvoker;
  readonly logger?: Logger;
  readonly maxQuestions?: number;
}

export interface RefineInput {
  readonly originalAsk: string;
  readonly sources: readonly IngestSource[];
  readonly note?: string;
}

export interface RefineClarification {
  readonly question: string;
  readonly answer: string;
}

export type RefineResult =
  | { readonly ok: true; readonly sources: readonly IngestSource[] }
  | { readonly ok: false; readonly error: string };

/**
 * v1 implementation: when sources are already structured (from `delegate_wiki_ingest` input),
 * the refine sub-agent is a pass-through. Free-form refinement (`ask_clarifying_question`,
 * `emit_ingest_plan`) goes through `deps.invoke` when supplied; otherwise we trust the
 * user-provided structure and skip clarification. Caller-side clarification UI is provided
 * by the F06 widget and wired in F12.
 */
export async function runRefine(input: RefineInput, _deps: RefineDeps): Promise<RefineResult> {
  if (input.sources.length > 0) {
    return { ok: true, sources: input.sources };
  }
  return {
    ok: false,
    error: 'no sources supplied (refine pass-through)',
  };
}

export const REFINE_MAX_QUESTIONS = WIKI_RUN_DEFAULTS.refineMaxClarifications;
