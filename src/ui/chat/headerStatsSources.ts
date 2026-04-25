import type { ChatMessageStore } from '@/chat/messageStore';
import type { DrainEvent, DrainListener } from '@/indexer/vaultIndexer';
import type {
  ContextUsageSnapshot,
  ContextUsageSource,
  IndexProgressSnapshot,
  IndexProgressSource,
} from './HeaderStatsLive';

export function makeContextUsageSource(
  store: ChatMessageStore,
  getWindow: () => number,
): ContextUsageSource {
  let cached: ContextUsageSnapshot = compute();

  function compute(): ContextUsageSnapshot {
    const window = Math.max(0, getWindow());
    const records = store.getSnapshot();
    let tokens = 0;
    for (let i = records.length - 1; i >= 0; i -= 1) {
      const r = records[i];
      if (r?.role === 'assistant' && r.tokens !== undefined && r.tokens.total > 0) {
        tokens = r.tokens.total;
        break;
      }
    }
    return { tokens, window };
  }

  function getSnapshot(): ContextUsageSnapshot {
    const next = compute();
    if (next.tokens === cached.tokens && next.window === cached.window) return cached;
    cached = next;
    return cached;
  }

  return {
    getSnapshot,
    subscribe: store.subscribe,
  };
}

export function makeIndexProgressSource(
  subscribeDrain: (listener: DrainListener) => () => void,
): IndexProgressSource & { dispose: () => void } {
  let snapshot: IndexProgressSnapshot = { indexed: 0, total: 0, busy: false };
  const listeners = new Set<() => void>();

  const onEvent = (ev: DrainEvent): void => {
    let next: IndexProgressSnapshot;
    if (ev.kind === 'start') {
      next = { indexed: 0, total: ev.size, busy: ev.size > 0 };
    } else if (ev.kind === 'tick') {
      const total = snapshot.total > 0 ? snapshot.total : ev.remaining;
      const indexed = Math.max(0, total - ev.remaining);
      next = { indexed, total, busy: ev.remaining > 0 };
    } else {
      const total = snapshot.total;
      next = { indexed: total, total, busy: false };
    }
    if (
      next.indexed === snapshot.indexed &&
      next.total === snapshot.total &&
      next.busy === snapshot.busy
    ) {
      return;
    }
    snapshot = next;
    for (const l of listeners) l();
  };

  const unsubscribeDrain = subscribeDrain(onEvent);

  return {
    getSnapshot: () => snapshot,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    dispose: () => {
      unsubscribeDrain();
      listeners.clear();
    },
  };
}
