import type { ChatMessageStore } from '@/chat/messageStore';
import type { ContextUsageSnapshot, ContextUsageSource } from './HeaderStatsLive';

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
