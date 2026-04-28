export interface IdleDeadlineLike {
  timeRemaining(): number;
  readonly didTimeout?: boolean;
}

export type IdleCallbackHandle = number;

export interface IdleScheduler {
  schedule(cb: (deadline: IdleDeadlineLike) => void): IdleCallbackHandle;
  cancel(handle: IdleCallbackHandle): void;
}

export function createBrowserIdleScheduler(): IdleScheduler {
  const hasIdle = typeof (globalThis as Record<string, unknown>).requestIdleCallback === 'function';
  if (hasIdle) {
    const rIc = (
      globalThis as unknown as {
        requestIdleCallback: (cb: (d: IdleDeadlineLike) => void) => number;
        cancelIdleCallback: (id: number) => void;
      }
    ).requestIdleCallback;
    const cIc = (
      globalThis as unknown as {
        cancelIdleCallback: (id: number) => void;
      }
    ).cancelIdleCallback;
    return {
      schedule: (cb) => rIc(cb),
      cancel: (h) => cIc(h),
    };
  }
  return {
    schedule: (cb) =>
      setTimeout(() => cb({ timeRemaining: () => 5, didTimeout: false }), 1) as unknown as number,
    cancel: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
  };
}

/**
 * Pure function: given a batch of paths and an idle deadline, return the paths
 * to process this tick and the remainder for the next tick. Stops when the
 * deadline's `timeRemaining()` drops below `minBudgetMs`. Always advances by
 * at least one path so a tight deadline can never produce a zero-work tick
 * (which would stall the drain forever).
 */
export function chunkIteration(
  paths: readonly string[],
  deadline: IdleDeadlineLike,
  minBudgetMs = 5,
): { now: readonly string[]; rest: readonly string[] } {
  const now: string[] = [];
  const rest: string[] = [];
  let i = 0;
  for (; i < paths.length; i += 1) {
    if (i > 0 && deadline.timeRemaining() < minBudgetMs) break;
    now.push(paths[i]!);
  }
  for (; i < paths.length; i += 1) rest.push(paths[i]!);
  return { now, rest };
}
