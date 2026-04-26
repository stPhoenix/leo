import { describe, expect, it, vi } from 'vitest';
import { makeContextUsageSource } from '@/ui/chat/headerStatsSources';
import type { ContextSnapshotStore } from '@/agent/contextSnapshotStore';
import type { ContextData } from '@/agent/contextAnalyzer';
import { EMPTY_BREAKDOWN } from '@/agent/messageBreakdown';

function makeData(total: number): ContextData {
  return {
    systemTokens: 0,
    memoryFileTokens: 0,
    builtInToolTokens: 0,
    mcpToolTokens: 0,
    customAgentTokens: 0,
    slashCommandTokens: 0,
    messageTokens: total,
    messageBreakdown: EMPTY_BREAKDOWN,
    skillTokens: 0,
    skillCountFailed: false,
    totalTokens: total,
    tokenTotalSource: 'estimated',
    pipelineMessageCount: 1,
    model: 'm',
  };
}

function fakeStore(initial: ContextData | null): {
  store: ContextSnapshotStore;
  set: (next: ContextData | null) => void;
} {
  let data = initial;
  const listeners = new Set<() => void>();
  const store: ContextSnapshotStore = {
    getSnapshot: () => data,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    refresh() {},
    refreshNow: async () => data,
  };
  const set = (next: ContextData | null): void => {
    data = next;
    for (const l of listeners) l();
  };
  return { store, set };
}

describe('makeContextUsageSource', () => {
  it('returns 0 tokens when snapshot is null', () => {
    const { store } = fakeStore(null);
    const src = makeContextUsageSource(store, () => 200_000);
    expect(src.getSnapshot()).toEqual({ tokens: 0, window: 200_000 });
  });

  it('returns totalTokens from snapshot', () => {
    const { store } = fakeStore(makeData(1234));
    const src = makeContextUsageSource(store, () => 200_000);
    expect(src.getSnapshot()).toEqual({ tokens: 1234, window: 200_000 });
  });

  it('caches identical snapshots (same object reference)', () => {
    const { store } = fakeStore(makeData(50));
    const src = makeContextUsageSource(store, () => 200_000);
    const a = src.getSnapshot();
    const b = src.getSnapshot();
    expect(a).toBe(b);
  });

  it('forwards subscribe to the snapshot store', () => {
    const { store, set } = fakeStore(makeData(1));
    const src = makeContextUsageSource(store, () => 200_000);
    const cb = vi.fn();
    const off = src.subscribe(cb);
    set(makeData(2));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    set(makeData(3));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('updates tokens after a snapshot change', () => {
    const { store, set } = fakeStore(makeData(1));
    const src = makeContextUsageSource(store, () => 200_000);
    expect(src.getSnapshot().tokens).toBe(1);
    set(makeData(99));
    expect(src.getSnapshot().tokens).toBe(99);
  });
});
