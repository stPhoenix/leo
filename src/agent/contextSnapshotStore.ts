import type { ContextData } from './contextAnalyzer';

export interface ContextSnapshotStore {
  getSnapshot(): ContextData | null;
  subscribe(cb: () => void): () => void;
  refresh(): void;
  refreshNow(signal?: AbortSignal): Promise<ContextData | null>;
}

export interface ContextSnapshotStoreDeps {
  readonly analyze: (signal?: AbortSignal) => Promise<ContextData>;
  readonly debounceMs?: number;
  readonly onError?: (err: unknown) => void;
}

export function createContextSnapshotStore(deps: ContextSnapshotStoreDeps): ContextSnapshotStore {
  let cached: ContextData | null = null;
  const listeners = new Set<() => void>();
  let inflight: AbortController | null = null;
  let pending = false;

  const notify = (): void => {
    for (const l of listeners) l();
  };

  const run = async (signal?: AbortSignal): Promise<ContextData | null> => {
    const ctrl = new AbortController();
    inflight = ctrl;
    const onAbort = (): void => ctrl.abort();
    if (signal !== undefined) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const data = await deps.analyze(ctrl.signal);
      if (ctrl.signal.aborted) return null;
      cached = data;
      notify();
      return data;
    } catch (err) {
      if (ctrl.signal.aborted) return null;
      deps.onError?.(err);
      return null;
    } finally {
      if (inflight === ctrl) inflight = null;
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
    }
  };

  const tick = (): void => {
    if (inflight !== null) {
      pending = true;
      return;
    }
    pending = false;
    void run().finally(() => {
      if (pending && inflight === null && listeners.size > 0) tick();
    });
  };

  return {
    getSnapshot: () => cached,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) {
          pending = false;
          if (inflight !== null) inflight.abort();
        }
      };
    },
    refresh() {
      tick();
    },
    refreshNow(signal) {
      if (inflight !== null) inflight.abort();
      pending = false;
      return run(signal);
    },
  };
}
