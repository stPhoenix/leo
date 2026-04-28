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
    const store = createContextSnapshotStore({ analyze, debounceMs: 50 });
    expect(store.getSnapshot()).toBeNull();
  });

  it('debounces multiple refresh() calls into one analyze invocation', async () => {
    const analyze = vi.fn(async () => makeData(42));
    const store = createContextSnapshotStore({ analyze, debounceMs: 50 });
    store.refresh();
    store.refresh();
    store.refresh();
    expect(analyze).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()?.totalTokens).toBe(42);
  });

  it('notifies subscribers after the cache swaps', async () => {
    const analyze = vi.fn(async () => makeData(7));
    const store = createContextSnapshotStore({ analyze, debounceMs: 0 });
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
