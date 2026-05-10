import type { A2aStatus, A2aStatusKind, A2aTask, OpenfangHttp } from './httpClient';
import { OpenfangHttpError } from './httpClient';

export function extractStatusKind(status: A2aStatus): A2aStatusKind {
  if (status && typeof status === 'object' && 'state' in status) {
    return (status as { state: A2aStatusKind }).state;
  }
  return status as A2aStatusKind;
}

export function isTerminalState(s: A2aStatusKind): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled';
}

export interface PollDeps {
  readonly http: Pick<OpenfangHttp, 'pollTask'>;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly now: () => number;
}

export interface PollOpts {
  readonly taskId: string;
  readonly signal: AbortSignal;
  readonly initialIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly timeoutMs: number;
  readonly transientRetryBudget?: number;
  readonly transientRetryBaseMs?: number;
}

export type PollResult =
  | { readonly kind: 'terminal'; readonly task: A2aTask }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'transient_exhausted'; readonly lastStatus: number };

export async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR';
}

export async function pollUntilTerminal(deps: PollDeps, opts: PollOpts): Promise<PollResult> {
  const budget = opts.transientRetryBudget ?? 3;
  const baseMs = opts.transientRetryBaseMs ?? 1_000;
  const deadline = deps.now() + opts.timeoutMs;
  let interval = opts.initialIntervalMs;
  let transientRemaining = budget;
  let lastTransientStatus = 500;

  for (;;) {
    if (opts.signal.aborted) return { kind: 'aborted' };
    if (deps.now() >= deadline) return { kind: 'timeout' };

    let task: A2aTask;
    try {
      task = await deps.http.pollTask(opts.taskId, opts.signal);
    } catch (err) {
      if (opts.signal.aborted || isAbortError(err)) return { kind: 'aborted' };
      if (err instanceof OpenfangHttpError) {
        if (err.status >= 500) {
          lastTransientStatus = err.status;
          transientRemaining -= 1;
          if (transientRemaining <= 0) {
            return { kind: 'transient_exhausted', lastStatus: lastTransientStatus };
          }
          const attempt = budget - transientRemaining;
          const backoff = baseMs * 2 ** (attempt - 1);
          await deps.sleep(backoff, opts.signal);
          continue;
        }
        throw err;
      }
      throw err;
    }

    transientRemaining = budget;
    const kind = extractStatusKind(task.status);
    if (isTerminalState(kind)) {
      return { kind: 'terminal', task };
    }

    await deps.sleep(interval, opts.signal);
    interval = Math.min(Math.ceil(interval * 1.5), opts.maxIntervalMs);
  }
}
