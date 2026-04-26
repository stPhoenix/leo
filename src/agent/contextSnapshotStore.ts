import { debounce } from '@/util/debounce';
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
  const debounceMs = deps.debounceMs ?? 200;
  let cached: ContextData | null = null;
  const listeners = new Set<() => void>();
  let inflight: AbortController | null = null;

  const notify = (): void => {
    for (const l of listeners) l();
  };

  const run = async (signal?: AbortSignal): Promise<ContextData | null> => {
    if (inflight !== null) inflight.abort();
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

  const debouncedRefresh = debounce(() => {
    void run();
  }, debounceMs);

  return {
    getSnapshot: () => cached,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) {
          debouncedRefresh.cancel();
          if (inflight !== null) inflight.abort();
        }
      };
    },
    refresh() {
      debouncedRefresh();
    },
    refreshNow(signal) {
      debouncedRefresh.cancel();
      return run(signal);
    },
  };
}
