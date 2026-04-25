import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THREAD_TITLE,
  ThreadsStore,
  type ThreadsStoreOptions,
} from '@/storage/threadsStore';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';

class FakeAdapter implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }
  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }
  async read(path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async rename(from: string, to: string): Promise<void> {
    const src = this.files.get(from);
    if (src === undefined) throw new Error(`rename source missing: ${from}`);
    this.files.delete(from);
    this.files.set(to, src);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const files: string[] = [];
    const folders: string[] = [];
    const prefix = path.endsWith('/') ? path : `${path}/`;
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest.includes('/')) {
        const sub = rest.split('/')[0]!;
        folders.push(`${prefix}${sub}`);
      } else {
        files.push(key);
      }
    }
    return { files, folders: [...new Set(folders)] };
  }
}

function mkLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    async write(r) {
      records.push(r);
    },
    async flush() {
      /* no-op */
    },
  };
  const consoleImpl = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return { logger: new Logger({ level: 'debug', sink, consoleImpl }), records };
}

function buildStore(override: Partial<ThreadsStoreOptions> = {}): {
  store: ThreadsStore;
  adapter: FakeAdapter;
  records: LogRecord[];
  ids: string[];
  scheduled: Array<{ run: () => void }>;
} {
  const adapter = new FakeAdapter();
  const { logger, records } = mkLogger();
  let seq = 0;
  const ids: string[] = [];
  const idGenerator = (): string => {
    seq += 1;
    const id = `thread-${seq.toString().padStart(4, '0')}`;
    ids.push(id);
    return id;
  };
  const scheduled: Array<{ run: () => void }> = [];
  const scheduleUndo = (run: () => void): { cancel: () => void } => {
    const slot = { run };
    scheduled.push(slot);
    return {
      cancel: (): void => {
        slot.run = (): void => undefined;
      },
    };
  };
  const store = new ThreadsStore({
    adapter,
    logger,
    idGenerator,
    scheduleUndo,
    undoWindowMs: 1_000,
    ...override,
  });
  return { store, adapter, records, ids, scheduled };
}

describe('ThreadsStore', () => {
  it('init with no existing threads auto-creates a fresh one and sets it active', async () => {
    const { store, records, ids } = buildStore();
    await store.init();
    expect(store.activeIdOrNull()).toBe(ids[0]);
    expect(records.some((r) => r.event === 'thread.create' && r.fields?.id === ids[0])).toBe(true);
  });

  it('list enumerates JSON files, excludes .trash, sorts by updatedAt desc', async () => {
    const { store, adapter } = buildStore();
    adapter.files.set(
      '.leo/conversations/a.json',
      JSON.stringify({
        id: 'a',
        schemaVersion: 1,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        metadata: { allowedTools: [], title: 'First' },
        messages: [],
      }),
    );
    adapter.files.set(
      '.leo/conversations/b.json',
      JSON.stringify({
        id: 'b',
        schemaVersion: 1,
        createdAt: '2026-04-02T00:00:00.000Z',
        updatedAt: '2026-04-05T00:00:00.000Z',
        metadata: { allowedTools: [], title: 'Second' },
        messages: [
          { id: 'm1', role: 'user', content: 'hi', createdAt: '2026-04-05T00:00:00.000Z' },
        ],
      }),
    );
    adapter.files.set(
      '.leo/conversations/.trash/old.json',
      JSON.stringify({
        id: 'old',
        schemaVersion: 1,
        createdAt: 'x',
        updatedAt: 'x',
        metadata: { allowedTools: [] },
        messages: [],
      }),
    );
    const summaries = await store.list();
    expect(summaries.map((s) => s.id)).toEqual(['b', 'a']);
    expect(summaries[0]?.title).toBe('Second');
    expect(summaries[0]?.messageCount).toBe(1);
  });

  it('create writes a new thread.json with defaults and switches active', async () => {
    const { store, adapter, records, ids } = buildStore();
    const id = await store.create();
    expect(id).toBe(ids[0]);
    const written = adapter.files.get(`.leo/conversations/${id}.json`);
    expect(written).toBeDefined();
    const parsed: Record<string, unknown> = JSON.parse(written!);
    expect(parsed.id).toBe(id);
    const meta = parsed.metadata as Record<string, unknown>;
    expect(meta.title).toBe(id);
    expect(meta.allowedTools).toEqual([]);
    expect(parsed.messages).toEqual([]);
    expect(store.activeIdOrNull()).toBe(id);
    expect(records.some((r) => r.event === 'thread.create' && r.fields?.id === id)).toBe(true);
  });

  it('switch flushes the current store and sets the new active id', async () => {
    const { store, records } = buildStore();
    const a = await store.create();
    const b = await store.create();
    expect(store.activeIdOrNull()).toBe(b);
    await store.switch(a);
    expect(store.activeIdOrNull()).toBe(a);
    expect(records.some((r) => r.event === 'thread.switch' && r.fields?.id === a)).toBe(true);
  });

  it('rename mutates metadata.title and persists through ConversationStore.flush', async () => {
    const { store, adapter, records } = buildStore();
    const id = await store.create();
    await store.rename(id, '  My shiny title  ');
    const raw = adapter.files.get(`.leo/conversations/${id}.json`);
    const parsed = JSON.parse(raw!) as { metadata: { title: string } };
    expect(parsed.metadata.title).toBe('My shiny title');
    expect(records.some((r) => r.event === 'thread.rename' && r.fields?.id === id)).toBe(true);
  });

  it('rename with whitespace-only input is a no-op', async () => {
    const { store, adapter } = buildStore();
    const id = await store.create();
    const before = adapter.files.get(`.leo/conversations/${id}.json`);
    await store.rename(id, '   ');
    const after = adapter.files.get(`.leo/conversations/${id}.json`);
    expect(after).toBe(before);
  });

  it('delete moves file to .trash and schedules finalize; restore moves it back', async () => {
    const { store, adapter, scheduled, records } = buildStore();
    const id = await store.create();
    expect(adapter.files.has(`.leo/conversations/${id}.json`)).toBe(true);
    await store.delete(id);
    expect(adapter.files.has(`.leo/conversations/${id}.json`)).toBe(false);
    expect(adapter.files.has(`.leo/conversations/.trash/${id}.json`)).toBe(true);
    expect(records.some((r) => r.event === 'thread.delete' && r.fields?.id === id)).toBe(true);
    expect(scheduled.length).toBe(1);
    // Restore before window expires
    await store.restore(id);
    expect(adapter.files.has(`.leo/conversations/${id}.json`)).toBe(true);
    expect(adapter.files.has(`.leo/conversations/.trash/${id}.json`)).toBe(false);
    expect(records.some((r) => r.event === 'thread.delete.undo' && r.fields?.id === id)).toBe(true);
  });

  it('delete finalize (after undo window) removes trashed file permanently', async () => {
    const { store, adapter, scheduled } = buildStore();
    const id = await store.create();
    await store.create(); // second thread so delete doesn't auto-create a replacement
    await store.delete(id);
    expect(adapter.files.has(`.leo/conversations/.trash/${id}.json`)).toBe(true);
    // Fire the scheduled finalize
    scheduled[0]!.run();
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.files.has(`.leo/conversations/.trash/${id}.json`)).toBe(false);
  });

  it('delete of the only remaining thread auto-creates a fresh one', async () => {
    const { store, ids } = buildStore();
    const a = await store.create();
    await store.delete(a);
    // Active was `a`; deleted; a new thread was auto-created
    const active = store.activeIdOrNull();
    expect(active).not.toBe(a);
    expect(active).toBe(ids[1]);
  });

  it('delete of active thread with siblings falls back to the most-recent sibling', async () => {
    const { store } = buildStore();
    const a = await store.create();
    await delayMs(10);
    const b = await store.create();
    expect(store.activeIdOrNull()).toBe(b);
    await store.switch(a);
    await store.delete(a);
    expect(store.activeIdOrNull()).toBe(b);
  });

  it('init restores stored active id when file still exists', async () => {
    const { store: first, ids } = buildStore({
      persistActiveId: {
        load: async () => null,
        save: async () => {
          /* no-op for first run */
        },
      },
    });
    await first.create();
    const persistedRef = { value: ids[0] };
    const { adapter } = buildStore();
    // Simulate restart with stored id a and both threads on disk
    adapter.files.set(
      `.leo/conversations/${ids[0]}.json`,
      JSON.stringify({
        id: ids[0],
        schemaVersion: 1,
        createdAt: 't',
        updatedAt: 't',
        metadata: { allowedTools: [], title: DEFAULT_THREAD_TITLE },
        messages: [],
      }),
    );
    const { logger } = mkLogger();
    const store = new ThreadsStore({
      adapter,
      logger,
      persistActiveId: {
        load: async () => persistedRef.value ?? null,
        save: async () => undefined,
      },
    });
    const activeId = await store.init();
    expect(activeId).toBe(ids[0]);
  });

  it('init with a stale stored id falls back to the most-recently-updated thread', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(
      '.leo/conversations/newer.json',
      JSON.stringify({
        id: 'newer',
        schemaVersion: 1,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
        metadata: { allowedTools: [], title: 'Newer' },
        messages: [],
      }),
    );
    adapter.files.set(
      '.leo/conversations/older.json',
      JSON.stringify({
        id: 'older',
        schemaVersion: 1,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        metadata: { allowedTools: [], title: 'Older' },
        messages: [],
      }),
    );
    const { logger, records } = mkLogger();
    const store = new ThreadsStore({
      adapter,
      logger,
      persistActiveId: {
        load: async () => 'ghost-thread-id',
        save: async () => undefined,
      },
    });
    const activeId = await store.init();
    expect(activeId).toBe('newer');
    expect(
      records.some((r) => r.event === 'thread.fallback' && r.fields?.reason === 'stored-missing'),
    ).toBe(true);
  });

  it('per-thread metadata (allowedTools) is isolated across switch', async () => {
    const { store } = buildStore();
    const a = await store.create();
    const storeA = await store.active();
    storeA.mutate((t) => ({
      ...t,
      metadata: { ...t.metadata, allowedTools: ['read_note'] },
    }));
    await storeA.flush();
    const b = await store.create();
    const storeB = await store.active();
    storeB.mutate((t) => ({
      ...t,
      metadata: { ...t.metadata, allowedTools: ['search_vault'] },
    }));
    await storeB.flush();
    await store.switch(a);
    const restored = (await store.active()).getThread();
    expect(restored.metadata.allowedTools).toEqual(['read_note']);
    expect(b).not.toBe(a);
  });

  it('structured log events carry {id} only — no title/content payload', async () => {
    const { store, records } = buildStore();
    const id = await store.create();
    const other = await store.create();
    await store.switch(id);
    await store.rename(id, 'Secret Plans');
    await store.delete(id);
    const createEvent = records.find((r) => r.event === 'thread.create' && r.fields?.id === id);
    const renameEvent = records.find((r) => r.event === 'thread.rename' && r.fields?.id === id);
    const switchEvent = records.find((r) => r.event === 'thread.switch' && r.fields?.id === id);
    const deleteEvent = records.find((r) => r.event === 'thread.delete' && r.fields?.id === id);
    for (const ev of [createEvent, renameEvent, switchEvent, deleteEvent]) {
      expect(ev).toBeDefined();
      expect(ev?.fields?.title).toBeUndefined();
      expect(JSON.stringify(ev?.fields)).not.toContain('Secret Plans');
    }
    expect(other).not.toBe(id);
  });

  it('subscribe fires on create/switch/rename/delete with fresh snapshot', async () => {
    const { store } = buildStore();
    const a = await store.create();
    let calls = 0;
    const snapshots: Array<{ activeId: string | null; ids: string[] }> = [];
    const unsub = store.subscribe(() => {
      calls += 1;
      const snap = store.getSnapshot();
      snapshots.push({
        activeId: snap.activeId,
        ids: snap.summaries.map((s) => s.id),
      });
    });
    const b = await store.create();
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(store.getSnapshot().activeId).toBe(b);
    expect(
      store
        .getSnapshot()
        .summaries.map((s) => s.id)
        .sort(),
    ).toEqual([a, b].sort());

    await store.switch(a);
    expect(store.getSnapshot().activeId).toBe(a);

    await store.rename(a, 'Renamed');
    const renamed = store.getSnapshot().summaries.find((s) => s.id === a);
    expect(renamed?.title).toBe('Renamed');

    await store.delete(a);
    expect(store.getSnapshot().summaries.some((s) => s.id === a)).toBe(false);

    unsub();
    const before = calls;
    await store.create();
    expect(calls).toBe(before);
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it('getSnapshot after init returns the active id and current summaries', async () => {
    const { store } = buildStore();
    await store.init();
    const snap = store.getSnapshot();
    expect(snap.activeId).toBe(store.activeIdOrNull());
    expect(snap.summaries.length).toBe(1);
  });
});

async function delayMs(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
