import type { InlineRoute } from './runState';

export const HARD_MAX_ITERATIONS = 64;
export const SYNTHESIZE_RESERVE_DEFAULT = 4;

export interface InlineAgentBudgetsConfig {
  readonly maxIterationsSimple: number;
  readonly maxIterationsMultistep: number;
  readonly maxTokens: number;
  readonly wallClockMs: number;
}

export function selectMaxIterations(route: InlineRoute, config: InlineAgentBudgetsConfig): number {
  const raw = route === 'simple' ? config.maxIterationsSimple : config.maxIterationsMultistep;
  if (raw < 1) return 1;
  return Math.min(raw, HARD_MAX_ITERATIONS);
}

export interface PerStepBudgetInput {
  readonly remainingIterations: number;
  readonly remainingSteps: number;
  readonly synthesizeReserve?: number;
}

export function perStepBudget(input: PerStepBudgetInput): number {
  const reserve = Math.max(0, input.synthesizeReserve ?? SYNTHESIZE_RESERVE_DEFAULT);
  if (input.remainingSteps <= 0) return 0;
  const usable = Math.max(0, input.remainingIterations - reserve);
  if (usable <= 0) return 0;
  return Math.max(1, Math.floor(usable / input.remainingSteps));
}

export interface TokenTickInput {
  readonly cumulativeTokens: number;
  readonly addedInputEstimate: number;
  readonly observedUsage: number;
  readonly maxTokens: number;
}

export interface TokenTickResult {
  readonly total: number;
  readonly over: boolean;
}

export function tokenTick(input: TokenTickInput): TokenTickResult {
  if (input.addedInputEstimate < 0 || input.observedUsage < 0) {
    throw new Error('token tick deltas must be non-negative');
  }
  const total = input.cumulativeTokens + input.addedInputEstimate + input.observedUsage;
  return { total, over: total > input.maxTokens };
}

export interface ComposedAbort {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
  readonly reason: () => 'host' | 'timeout' | null;
}

export function composeAbortSignal(host: AbortSignal, wallClockMs: number): ComposedAbort {
  const controller = new AbortController();
  let firedReason: 'host' | 'timeout' | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = (reason: 'host' | 'timeout'): void => {
    if (firedReason !== null) return;
    firedReason = reason;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    controller.abort();
  };

  if (host.aborted) {
    fire('host');
  } else {
    host.addEventListener('abort', () => fire('host'), { once: true });
  }

  if (wallClockMs > 0 && firedReason === null) {
    timer = setTimeout(() => fire('timeout'), wallClockMs);
  }

  return {
    signal: controller.signal,
    cancel: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    reason: () => firedReason,
  };
}
