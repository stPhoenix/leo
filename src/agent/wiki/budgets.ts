import {
  AUTOCOMPACT_BUFFER_TOKENS,
  COMPACT_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_DEFAULT,
} from '@/agent/compactConstants';

export interface WikiBudgets {
  readonly plannerInputCap: number;
  readonly plannerOutputCap: number;
  readonly extractorInputCap: number;
  readonly extractorOutputCap: number;
  readonly reducerInputCap: number;
  readonly reducerOutputCap: number;
  readonly checkerInputCap: number;
  readonly checkerOutputCap: number;
  readonly proposerInputCap: number;
  readonly proposerOutputCap: number;
}

export const WIKI_BUDGETS: WikiBudgets = {
  extractorInputCap: 8000,
  extractorOutputCap: 1500,
  reducerInputCap: 6000,
  reducerOutputCap: 2000,
  plannerInputCap: 4000,
  plannerOutputCap: 1500,
  checkerInputCap: 6000,
  checkerOutputCap: 1500,
  proposerInputCap: 3000,
  proposerOutputCap: 1500,
};

export type WikiBudgetKey = keyof WikiBudgets;

export interface ResolveWikiBudgetsOpts {
  readonly contextWindow: number;
  readonly maxOutputTokens?: number;
}

const WIKI_BUDGETS_BASE_CONTEXT = 32_000;
const WIKI_BUDGETS_INPUT_THRESHOLD_PCT = 0.7;
const WIKI_BUDGETS_OUTPUT_SCALE_MAX = 1.5;
const WIKI_BUDGETS_INPUT_FLOOR = 1500;
const WIKI_BUDGETS_OUTPUT_FLOOR = 512;

export function resolveWikiBudgets(opts: ResolveWikiBudgetsOpts): WikiBudgets {
  const ctx = Math.max(8_000, opts.contextWindow);
  const maxOut = Math.max(
    WIKI_BUDGETS_OUTPUT_FLOOR,
    opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS_DEFAULT,
  );
  const responseHeadroom = Math.min(maxOut, COMPACT_MAX_OUTPUT_TOKENS);
  const threshold = ctx - responseHeadroom - AUTOCOMPACT_BUFFER_TOKENS;
  const inputCeiling = Math.max(
    WIKI_BUDGETS_INPUT_FLOOR,
    Math.floor(threshold * WIKI_BUDGETS_INPUT_THRESHOLD_PCT),
  );
  const scale = ctx / WIKI_BUDGETS_BASE_CONTEXT;
  const outputScale = Math.min(scale, WIKI_BUDGETS_OUTPUT_SCALE_MAX);
  const inputCap = (base: number): number =>
    Math.max(WIKI_BUDGETS_INPUT_FLOOR, Math.min(Math.floor(base * scale), inputCeiling));
  const outputCap = (base: number): number =>
    Math.max(WIKI_BUDGETS_OUTPUT_FLOOR, Math.min(maxOut, Math.floor(base * outputScale)));
  return {
    plannerInputCap: inputCap(WIKI_BUDGETS.plannerInputCap),
    plannerOutputCap: outputCap(WIKI_BUDGETS.plannerOutputCap),
    extractorInputCap: inputCap(WIKI_BUDGETS.extractorInputCap),
    extractorOutputCap: outputCap(WIKI_BUDGETS.extractorOutputCap),
    reducerInputCap: inputCap(WIKI_BUDGETS.reducerInputCap),
    reducerOutputCap: outputCap(WIKI_BUDGETS.reducerOutputCap),
    checkerInputCap: inputCap(WIKI_BUDGETS.checkerInputCap),
    checkerOutputCap: outputCap(WIKI_BUDGETS.checkerOutputCap),
    proposerInputCap: inputCap(WIKI_BUDGETS.proposerInputCap),
    proposerOutputCap: outputCap(WIKI_BUDGETS.proposerOutputCap),
  };
}

export const WIKI_RUN_DEFAULTS = {
  extractorConcurrency: 1,
  extractorConcurrencyMax: 2,
  reducerConcurrency: 1,
  reingestPromptTimeoutMs: 60_000,
  refineMaxClarifications: 3,
  cancelDeadlineMs: 2_000,
} as const;
