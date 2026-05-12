import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextSnapshotStore } from '@/agent/contextSnapshotStore';
import type { ContextData } from '@/agent/contextAnalyzer';
import { EMPTY_BREAKDOWN } from '@/agent/messageBreakdown';

function makeData(total = 100): ContextData {
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('contextSnapshotStore', () => {
  it('returns null before the first refresh completes', () => {
    const analyze = vi.fn(async () => makeData(1));
    const store = createContextSnapshotStore({ analyze });
    expect(store.getSnapshot()).toBeNull();
  });

  it('fires the first refresh immediately', async () => {
    const analyze = vi.fn(async () => makeData(42));
    const store = createContextSnapshotStore({ analyze });
    store.refresh();
    expect(analyze).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(store.getSnapshot()?.totalTokens).toBe(42);
  });

  it('coalesces a burst of refresh() calls into one in-flight + one trailing run', async () => {
    const resolvers: ((d: ContextData) => void)[] = [];
    const analyze = vi.fn(
      () =>
        new Promise<ContextData>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    // Keep a subscriber so cleanup doesn't cancel the pending tick.
    const store = createContextSnapshotStore({ analyze });
    const unsub = store.subscribe(() => {});

    store.refresh();
    expect(analyze).toHaveBeenCalledTimes(1);

    // Burst while first run is in flight — all should collapse into one trailing run.
    store.refresh();
    store.refresh();
    store.refresh();
    expect(analyze).toHaveBeenCalledTimes(1);

    // Resolve first run → trailing run kicks off automatically.
    resolvers[0]?.(makeData(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(analyze).toHaveBeenCalledTimes(2);

    // Resolve trailing run; no further runs should start.
    resolvers[1]?.(makeData(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()?.totalTokens).toBe(2);

    unsub();
  });

  it('notifies subscribers after the cache swaps', async () => {
    const analyze = vi.fn(async () => makeData(7));
    const store = createContextSnapshotStore({ analyze });
    const cb = vi.fn();
    store.subscribe(cb);
    store.refresh();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(cb).toHaveBeenCalled();
    expect(store.getSnapshot()?.totalTokens).toBe(7);
  });

  it('aborts an in-flight analyze when a new refreshNow fires', async () => {
    const seen: AbortSignal[] = [];
    const analyze = vi.fn(
      (signal?: AbortSignal) =>
        new Promise<ContextData>((resolve, reject) => {
          if (signal !== undefined) seen.push(signal);
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
          setTimeout(() => resolve(makeData(99)), 100);
        }),
    );
    const store = createContextSnapshotStore({ analyze, debounceMs: 0 });
    const first = store.refreshNow();
    const second = store.refreshNow();
    await vi.advanceTimersByTimeAsync(100);
    await Promise.allSettled([first, second]);
    expect(seen.length).toBe(2);
    expect(seen[0]?.aborted).toBe(true);
    expect(seen[1]?.aborted).toBe(false);
  });

  it('refreshNow resolves to the freshly analyzed data', async () => {
    const analyze = vi.fn(async () => makeData(123));
    const store = createContextSnapshotStore({ analyze, debounceMs: 50 });
    const p = store.refreshNow();
    const data = await p;
    expect(data?.totalTokens).toBe(123);
    expect(store.getSnapshot()?.totalTokens).toBe(123);
  });
});
