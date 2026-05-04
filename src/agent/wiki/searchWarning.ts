import type { WikiMutexState } from '@/agent/wiki/mutexTypes';

export function formatWikiBusyWarning(state: WikiMutexState): string {
  if (state.kind !== 'busy') return '';
  return `warning: wiki ${state.op} in progress (runId=${state.runId}) — results may be partial`;
}

export interface WikiBusyNotifier {
  (threadId: string, message: string): void;
}

export interface NotifierOptions {
  readonly notify: (message: string) => void;
  readonly intervalMs?: number;
  readonly now?: () => number;
}

export const WIKI_BUSY_NOTICE_INTERVAL_MS = 60_000;

/**
 * Build a per-thread rate-limited notifier. The same thread fires `notify`
 * at most once per `intervalMs` window. Distinct threadIds are independent.
 */
export function createWikiBusyNotifier(opts: NotifierOptions): WikiBusyNotifier {
  const intervalMs = opts.intervalMs ?? WIKI_BUSY_NOTICE_INTERVAL_MS;
  const now = opts.now ?? ((): number => Date.now());
  const lastByThread = new Map<string, number>();
  return (threadId, message): void => {
    const t = now();
    const last = lastByThread.get(threadId);
    if (last !== undefined && t - last < intervalMs) return;
    lastByThread.set(threadId, t);
    opts.notify(message);
  };
}
