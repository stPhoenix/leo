export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000;
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000;
export const MAX_OUTPUT_TOKENS_DEFAULT = 32_000;
export const MAX_OUTPUT_TOKENS_UPPER_LIMIT = 64_000;

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000;
export const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000;
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000;
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5;
export const POST_COMPACT_TOKEN_BUDGET = 50_000;
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000;
export const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000;
export const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000;

export const MAX_COMPACT_STREAMING_RETRIES = 2;
export const MAX_PTL_RETRIES = 3;

export const ONE_MILLION_CONTEXT_WINDOW = 1_000_000;

export function effectiveContextWindow(
  contextWindow: number,
  maxOutputTokensForModel: number,
): number {
  return contextWindow - Math.min(maxOutputTokensForModel, COMPACT_MAX_OUTPUT_TOKENS);
}

export function autoCompactThresholdFor(
  contextWindow: number,
  maxOutputTokensForModel: number,
): number {
  return effectiveContextWindow(contextWindow, maxOutputTokensForModel) - AUTOCOMPACT_BUFFER_TOKENS;
}

export interface ContextWindowResolveOpts {
  readonly model: string;
  readonly providerMaxInputTokens?: number;
  readonly userOverride?: number;
}

export function resolveContextWindow(opts: ContextWindowResolveOpts): number {
  if (
    opts.userOverride !== undefined &&
    Number.isFinite(opts.userOverride) &&
    opts.userOverride > 0
  ) {
    return opts.userOverride;
  }
  if (opts.model.endsWith('[1m]')) return ONE_MILLION_CONTEXT_WINDOW;
  if (
    opts.providerMaxInputTokens !== undefined &&
    Number.isFinite(opts.providerMaxInputTokens) &&
    opts.providerMaxInputTokens > 0
  ) {
    return opts.providerMaxInputTokens;
  }
  return MODEL_CONTEXT_WINDOW_DEFAULT;
}
