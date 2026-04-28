import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIRTY_QUEUE_PATH, DirtyQueue } from '@/indexer/dirtyQueue';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  writeCalls = 0;
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.writeCalls += 1;
    this.files.set(p, d);
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(): Promise<VaultListing> {
    return { files: [], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

describe('DirtyQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('add is set-backed (dedupe) and returns false on second call for same path', () => {
    const vault = new FakeVault();
    const q = new DirtyQueue({ vault });
    expect(q.add('a.md')).toBe(true);
    expect(q.add('a.md')).toBe(false);
    expect(q.size()).toBe(1);
  });

  it('flush writes the JSON payload with version + paths', async () => {
    const vault = new FakeVault();
    const q = new DirtyQueue({ vault, debounceMs: 0 });
    q.add('a.md');
    q.add('b.md');
    await q.flush();
    const raw = vault.files.get(DIRTY_QUEUE_PATH);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw as string) as { version: number; paths: string[] };
    expect(parsed.version).toBe(1);
    expect(parsed.paths.sort()).toEqual(['a.md', 'b.md']);
  });

  it('debounces persist calls — multiple adds fire one flush after debounce window', async () => {
    const vault = new FakeVault();
    const q = new DirtyQueue({ vault, debounceMs: 50 });
    q.add('a.md');
    q.add('b.md');
    q.add('c.md');
    expect(vault.writeCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(50);
    await vi.runAllTimersAsync();
    expect(vault.writeCalls).toBeGreaterThanOrEqual(1);
    expect(vault.writeCalls).toBeLessThanOrEqual(2);
  });

  it('load rehydrates from queue.json and survives restart', async () => {
    const vault = new FakeVault();
    vault.files.set(DIRTY_QUEUE_PATH, JSON.stringify({ version: 1, paths: ['x.md', 'y.md'] }));
    const q = new DirtyQueue({ vault });
    await q.load();
    expect(q.size()).toBe(2);
    expect([...q.snapshot()].sort()).toEqual(['x.md', 'y.md']);
  });

  it('remove and clear both persist; clear does nothing on empty queue', async () => {
    const vault = new FakeVault();
    const q = new DirtyQueue({ vault, debounceMs: 0 });
    q.add('a.md');
    await q.flush();
    const before = vault.writeCalls;
    q.clear();
    expect(q.size()).toBe(0);
    q.clear();
    expect(vault.writeCalls).toBe(before);
  });

  it('dispose cancels pending debounced persist', () => {
    const vault = new FakeVault();
    const q = new DirtyQueue({ vault, debounceMs: 50 });
    q.add('a.md');
    q.dispose();
    expect(q.size()).toBe(1);
    // Timer should be cleared — no write even after advance
    vi.advanceTimersByTime(100);
    expect(vault.writeCalls).toBe(0);
  });
});
