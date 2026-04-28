import type { ContextSnapshotStore } from '@/agent/contextSnapshotStore';
import type { ContextUsageSnapshot, ContextUsageSource } from './HeaderStatsLive';

export function makeContextUsageSource(
  snapshotStore: ContextSnapshotStore,
  getWindow: () => number,
): ContextUsageSource {
  function compute(): ContextUsageSnapshot {
    const window = Math.max(0, getWindow());
    const data = snapshotStore.getSnapshot();
    const tokens = data !== null && data.totalTokens > 0 ? data.totalTokens : 0;
    return { tokens, window };
  }

  let cached: ContextUsageSnapshot = compute();

  function getSnapshot(): ContextUsageSnapshot {
    const next = compute();
    if (next.tokens === cached.tokens && next.window === cached.window) return cached;
    cached = next;
    return cached;
  }

  return {
    getSnapshot,
    subscribe: snapshotStore.subscribe,
  };
}
