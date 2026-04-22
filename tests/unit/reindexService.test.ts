import { describe, expect, it, vi } from 'vitest';
import { ReindexService } from '@/indexer/reindexService';
import type { VaultIndexer } from '@/indexer/vaultIndexer';
import type { VectorStore } from '@/storage/vectorStore';

function fakeIndexer(entries: string[]): VaultIndexer {
  const queueSet = new Set<string>();
  const queryCalls = { count: 0 };
  return {
    reindexAll: vi.fn(async () => {
      for (const p of entries) queueSet.add(p);
      return entries.length;
    }),
    queryOnDemand: vi.fn(async () => {
      queryCalls.count += 1;
    }),
    enqueueDirty: vi.fn(() => true),
  } as unknown as VaultIndexer;
}

function fakeVectorStore(): VectorStore {
  const calls = { rebuild: 0 };
  return {
    rebuild: vi.fn(async () => {
      calls.rebuild += 1;
      return { ok: true, value: undefined };
    }),
  } as unknown as VectorStore;
}

describe('ReindexService', () => {
  it('cancel on confirmReindex returns null and does not invoke the indexer', async () => {
    const indexer = fakeIndexer([]);
    const svc = new ReindexService({
      indexer,
      confirmReindex: async () => 'cancel',
      confirmModelSwitch: async () => 'later',
    });
    const result = await svc.reindexVault();
    expect(result).toBeNull();
    expect(indexer.reindexAll).not.toHaveBeenCalled();
  });

  it('reindex confirmation runs reindexAll and returns the count', async () => {
    const indexer = fakeIndexer(['a.md', 'b.md', 'c.md']);
    const svc = new ReindexService({
      indexer,
      confirmReindex: async () => 'reindex',
      confirmModelSwitch: async () => 'later',
    });
    const result = await svc.reindexVault();
    expect(result).toBe(3);
    expect(indexer.reindexAll).toHaveBeenCalled();
  });

  it('rebuilds the vector store before re-enqueueing', async () => {
    const indexer = fakeIndexer(['a.md']);
    const store = fakeVectorStore();
    const svc = new ReindexService({
      indexer,
      vectorStore: store,
      confirmReindex: async () => 'reindex',
      confirmModelSwitch: async () => 'later',
    });
    await svc.reindexVault();
    expect(store.rebuild).toHaveBeenCalled();
  });

  it('is debounced — a second reindex while one is in-flight returns null', async () => {
    const indexer = fakeIndexer(['a.md']);
    let resolveReindexAll!: () => void;
    (indexer as { reindexAll: typeof indexer.reindexAll }).reindexAll = vi.fn(
      () =>
        new Promise<number>((r) => {
          resolveReindexAll = () => r(1);
        }),
    );
    const svc = new ReindexService({
      indexer,
      confirmReindex: async () => 'reindex',
      confirmModelSwitch: async () => 'later',
    });
    const first = svc.reindexVault();
    // Allow the first reindexAll promise to register before firing the second
    await Promise.resolve();
    await Promise.resolve();
    const second = await svc.reindexVault();
    expect(second).toBeNull();
    resolveReindexAll();
    expect(await first).toBe(1);
  });

  it('handleModelSwitch "now" routes through reindexVault', async () => {
    const indexer = fakeIndexer(['a.md']);
    const svc = new ReindexService({
      indexer,
      confirmReindex: async () => 'reindex',
      confirmModelSwitch: async () => 'now',
    });
    const outcome = await svc.handleModelSwitch({ model: 'old', dim: 512 });
    expect(outcome).toBe('now');
    expect(indexer.reindexAll).toHaveBeenCalled();
  });

  it('handleModelSwitch "revert" invokes revertModelSetting without reindexing', async () => {
    const indexer = fakeIndexer(['a.md']);
    const revertCalls: Array<{ model: string; dim: number }> = [];
    const svc = new ReindexService({
      indexer,
      confirmReindex: async () => 'cancel',
      confirmModelSwitch: async () => 'revert',
      revertModelSetting: async (prev) => {
        revertCalls.push(prev);
      },
    });
    const outcome = await svc.handleModelSwitch({ model: 'old', dim: 512 });
    expect(outcome).toBe('revert');
    expect(revertCalls).toEqual([{ model: 'old', dim: 512 }]);
    expect(indexer.reindexAll).not.toHaveBeenCalled();
  });

  it('handleModelSwitch "later" leaves state untouched', async () => {
    const indexer = fakeIndexer([]);
    const svc = new ReindexService({
      indexer,
      confirmReindex: async () => 'cancel',
      confirmModelSwitch: async () => 'later',
    });
    const outcome = await svc.handleModelSwitch({ model: 'old', dim: 512 });
    expect(outcome).toBe('later');
    expect(indexer.reindexAll).not.toHaveBeenCalled();
  });
});
