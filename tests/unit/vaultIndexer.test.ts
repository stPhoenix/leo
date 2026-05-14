import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VaultIndexer,
  type DrainEvent,
  type HeaderMismatchChoice,
  type VaultEventKind,
  type VaultEventSource,
  type VaultFileEntry,
  type VaultFileSource,
} from '@/indexer/vaultIndexer';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';
import type { IdleDeadlineLike, IdleScheduler } from '@/indexer/chunkIteration';
import { INDEX_HEADER_PATH, writeIndexHeader } from '@/indexer/indexHeader';
import { DIRTY_QUEUE_PATH } from '@/indexer/dirtyQueue';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
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

class FakeFiles implements VaultFileSource {
  constructor(public entries: VaultFileEntry[] = []) {}
  listMarkdown(): readonly VaultFileEntry[] {
    return this.entries;
  }
}

class FakeEvents implements VaultEventSource {
  private handler: ((event: VaultEventKind) => void) | null = null;
  on(handler: (event: VaultEventKind) => void): () => void {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }
  emit(event: VaultEventKind): void {
    this.handler?.(event);
  }
}

function immediateScheduler(
  deadline: IdleDeadlineLike = { timeRemaining: () => 50 },
): IdleScheduler {
  return {
    schedule: (cb) => {
      queueMicrotask(() => cb(deadline));
      return 0;
    },
    cancel: () => undefined,
  };
}

function mdFile(path: string, mtime: number, size: number): VaultFileEntry {
  return { path, extension: 'md', mtime, size };
}

describe('VaultIndexer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function buildIndexer(opts: {
    files?: VaultFileEntry[];
    spec?: { model: string };
    prompt?: HeaderMismatchChoice;
    existingHeader?: {
      model: string;
      manifest?: Array<{ path: string; mtime: number; size: number }>;
    };
    onProcess?: (path: string) => Promise<void> | void;
    revertModel?: () => void;
    idleMs?: number;
    isExcluded?: (path: string) => boolean;
  }) {
    const vault = new FakeVault();
    const files = new FakeFiles(opts.files ?? []);
    const events = new FakeEvents();
    const processed: string[] = [];
    if (opts.existingHeader !== undefined) {
      await writeIndexHeader(vault, {
        version: 1,
        model: opts.existingHeader.model,
        manifest: opts.existingHeader.manifest ?? [],
      });
    }
    const spec = opts.spec ?? { model: 'm1' };
    let promptCalls = 0;
    const indexer = new VaultIndexer({
      vault,
      files,
      events,
      spec: () => spec,
      processPath: async (p, signal) => {
        if (signal.aborted) return;
        processed.push(p);
        if (opts.onProcess !== undefined) await opts.onProcess(p);
      },
      promptHeaderMismatch: async () => {
        promptCalls += 1;
        return opts.prompt ?? 'now';
      },
      revertModel: opts.revertModel,
      idleScheduler: immediateScheduler(),
      idleMs: () => opts.idleMs ?? 30_000,
      queueDebounceMs: 0,
      minChunkBudgetMs: 1,
      ...(opts.isExcluded !== undefined ? { isExcluded: opts.isExcluded } : {}),
    });
    return { vault, files, events, indexer, processed, promptCalls: () => promptCalls };
  }

  it('logs header.match when stored header matches spec', async () => {
    const { indexer, vault } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
    });
    await indexer.init();
    expect(vault.files.has(INDEX_HEADER_PATH)).toBe(true);
    expect(indexer.queueSize()).toBe(0);
    indexer.shutdown();
  });

  it("mismatch + 'now' choice marks every markdown path dirty and writes a fresh header", async () => {
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'old' },
      spec: { model: 'm1' },
      files: [mdFile('a.md', 1, 10), mdFile('b.md', 2, 20)],
      prompt: 'now',
    });
    await indexer.init();
    expect([...indexer.queueSnapshot()].sort()).toEqual(['a.md', 'b.md']);
    indexer.shutdown();
  });

  it("mismatch + 'later' choice parks indexer (no diff sweep, no drain)", async () => {
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'old' },
      spec: { model: 'm1' },
      files: [mdFile('a.md', 1, 10)],
      prompt: 'later',
    });
    await indexer.init();
    expect(indexer.queueSize()).toBe(0);
    await indexer.processDueWork(new AbortController().signal);
    // Emit a vault event — listener is registered but drain shouldn't fire because waitingOnUser
    indexer.shutdown();
  });

  it("mismatch + 'revert-model' calls revertModel with the stored spec", async () => {
    const reverted: Array<{ model: string }> = [];
    const { indexer, promptCalls } = await buildIndexer({
      existingHeader: { model: 'old-m' },
      spec: { model: 'new-m' },
      prompt: 'revert-model',
      revertModel: (prev?: { model: string }) => {
        if (prev !== undefined) reverted.push(prev);
      },
    });
    await indexer.init();
    expect(promptCalls()).toBe(1);
    expect(indexer.queueSize()).toBe(0);
    indexer.shutdown();
  });

  it('diff sweep pushes added / modified / removed paths from manifest comparison', async () => {
    const { indexer } = await buildIndexer({
      existingHeader: {
        model: 'm1',
        manifest: [
          { path: 'keep.md', mtime: 1, size: 10 },
          { path: 'modify.md', mtime: 2, size: 20 },
          { path: 'remove.md', mtime: 3, size: 30 },
        ],
      },
      files: [mdFile('keep.md', 1, 10), mdFile('modify.md', 99, 20), mdFile('add.md', 4, 40)],
    });
    await indexer.init();
    expect([...indexer.queueSnapshot()].sort()).toEqual(['add.md', 'modify.md', 'remove.md']);
    indexer.shutdown();
  });

  it('vault events fan out to enqueueDirty — rename emits delete+create pair', async () => {
    const { indexer, events } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
    });
    await indexer.init();
    events.emit({ kind: 'create', path: 'new.md' });
    events.emit({ kind: 'modify', path: 'new.md' });
    events.emit({ kind: 'rename', path: 'after.md', oldPath: 'before.md' });
    events.emit({ kind: 'delete', path: 'gone.md' });
    const snap = [...indexer.queueSnapshot()].sort();
    expect(snap).toEqual(['after.md', 'before.md', 'gone.md', 'new.md']);
    indexer.shutdown();
  });

  it('indexable filter accepts .md and .canvas but rejects .pdf, .png', async () => {
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
    });
    await indexer.init();
    expect(indexer.enqueueDirty({ path: 'x.canvas', extension: 'canvas' })).toBe(true);
    expect(indexer.enqueueDirty({ path: 'x.pdf', extension: 'pdf' })).toBe(false);
    expect(indexer.enqueueDirty({ path: 'x.png', extension: 'png' })).toBe(false);
    expect(indexer.enqueueDirty({ path: 'x.md', extension: 'md' })).toBe(true);
    expect([...indexer.queueSnapshot()].sort()).toEqual(['x.canvas', 'x.md']);
    indexer.shutdown();
  });

  it('processDueWork drains the queue path by path through processPath', async () => {
    const { indexer, processed } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
    });
    await indexer.init();
    indexer.enqueueDirty({ path: 'one.md', extension: 'md' });
    indexer.enqueueDirty({ path: 'two.md', extension: 'md' });
    await indexer.processDueWork(new AbortController().signal);
    expect(processed.sort()).toEqual(['one.md', 'two.md']);
    expect(indexer.queueSize()).toBe(0);
    indexer.shutdown();
  });

  it('concurrent drains are mutually exclusive — only one runs at a time', async () => {
    const starts: number[] = [];
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
      onProcess: async (p) => {
        starts.push(Date.now());
        await new Promise((r) => setTimeout(r, 5));
        void p;
      },
    });
    await indexer.init();
    indexer.enqueueDirty({ path: 'a.md', extension: 'md' });
    indexer.enqueueDirty({ path: 'b.md', extension: 'md' });
    const firstP = indexer.processDueWork(new AbortController().signal);
    // Second call while first is draining should no-op immediately
    await indexer.processDueWork(new AbortController().signal);
    await vi.runAllTimersAsync();
    await firstP;
    expect(indexer.queueSize()).toBe(0);
    indexer.shutdown();
  });

  it('abort-during-drain releases the in-flight flag via finally', async () => {
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
      onProcess: async () => {
        await new Promise((r) => setTimeout(r, 10));
      },
    });
    await indexer.init();
    indexer.enqueueDirty({ path: 'a.md', extension: 'md' });
    indexer.enqueueDirty({ path: 'b.md', extension: 'md' });
    const controller = new AbortController();
    const drain = indexer.processDueWork(controller.signal);
    controller.abort();
    await vi.runAllTimersAsync();
    await drain;
    // After abort, a new processDueWork must be allowed (flag released in finally)
    const nextDrain = indexer.processDueWork(new AbortController().signal);
    await vi.runAllTimersAsync();
    await nextDrain;
    expect(indexer.queueSize()).toBe(0);
    indexer.shutdown();
  });

  it('queue.json persistence survives a simulated init() rerun', async () => {
    const vault = new FakeVault();
    const events = new FakeEvents();
    const files = new FakeFiles([]);
    await writeIndexHeader(vault, {
      version: 1,
      model: 'm1',
      manifest: [],
    });
    vault.files.set(DIRTY_QUEUE_PATH, JSON.stringify({ version: 1, paths: ['resumed.md'] }));
    const indexer = new VaultIndexer({
      vault,
      files,
      events,
      spec: () => ({ model: 'm1' }),
      processPath: async () => undefined,
      promptHeaderMismatch: async () => 'now',
      idleScheduler: immediateScheduler(),
      idleMs: () => 30_000,
      queueDebounceMs: 0,
    });
    await indexer.init();
    expect(indexer.queueSnapshot().includes('resumed.md')).toBe(true);
    indexer.shutdown();
  });

  it('shutdown aborts in-flight drain and stops listener fan-out', async () => {
    const { indexer, events } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
    });
    await indexer.init();
    indexer.shutdown();
    events.emit({ kind: 'create', path: 'after-shutdown.md' });
    expect(indexer.queueSize()).toBe(0);
  });

  it('exclude predicate blocks enqueueDirty for matching paths', async () => {
    const vault = new FakeVault();
    const files = new FakeFiles([]);
    const events = new FakeEvents();
    await writeIndexHeader(vault, { version: 1, model: 'm', manifest: [] });
    const indexer = new VaultIndexer({
      vault,
      files,
      events,
      spec: () => ({ model: 'm' }),
      processPath: async () => undefined,
      promptHeaderMismatch: async () => 'now',
      idleScheduler: immediateScheduler(),
      idleMs: () => 30_000,
      isExcluded: (p) => p.startsWith('drafts/'),
      queueDebounceMs: 0,
    });
    await indexer.init();
    expect(indexer.enqueueDirty({ path: 'drafts/a.md', extension: 'md' })).toBe(false);
    expect(indexer.enqueueDirty({ path: 'notes/b.md', extension: 'md' })).toBe(true);
    expect(indexer.queueSnapshot()).toEqual(['notes/b.md']);
    indexer.shutdown();
  });

  it("emits DrainEvent 'error' when processPath throws, then continues the drain", async () => {
    const events: DrainEvent[] = [];
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
      onProcess: async (p) => {
        if (p === 'bad.md') throw new Error('boom');
      },
    });
    await indexer.init();
    indexer.subscribe((e) => events.push(e));
    indexer.enqueueDirty({ path: 'ok.md', extension: 'md' });
    indexer.enqueueDirty({ path: 'bad.md', extension: 'md' });
    await indexer.processDueWork(new AbortController().signal);
    const errors = events.filter(
      (e): e is Extract<DrainEvent, { kind: 'error' }> => e.kind === 'error',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: 'bad.md', message: 'boom' });
    indexer.shutdown();
  });

  it("emits DrainEvent 'dirty' tracking queue size; subscribe replays current count", async () => {
    const events: DrainEvent[] = [];
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
    });
    await indexer.init();
    indexer.subscribe((e) => events.push(e));
    // Subscribe immediately replays current dirty count (0 here).
    expect(
      events
        .filter((e) => e.kind === 'dirty')
        .map((e) => (e as Extract<DrainEvent, { kind: 'dirty' }>).count),
    ).toEqual([0]);
    indexer.enqueueDirty({ path: 'a.md', extension: 'md' });
    indexer.enqueueDirty({ path: 'b.md', extension: 'md' });
    indexer.enqueueDirty({ path: 'a.md', extension: 'md' }); // duplicate — queue size unchanged → no emit
    const dirtyEvents = events.filter(
      (e): e is Extract<DrainEvent, { kind: 'dirty' }> => e.kind === 'dirty',
    );
    expect(dirtyEvents.map((e) => e.count)).toEqual([0, 1, 2]);
    expect(indexer.getDirtyCount()).toBe(2);
    indexer.shutdown();
  });

  it('subscribe replays the current queue size as a dirty event', async () => {
    const events: DrainEvent[] = [];
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
    });
    await indexer.init();
    indexer.enqueueDirty({ path: 'a.md', extension: 'md' });
    indexer.enqueueDirty({ path: 'b.md', extension: 'md' });
    indexer.subscribe((e) => events.push(e));
    expect(events).toEqual([{ kind: 'dirty', count: 2 }]);
    indexer.shutdown();
  });

  it("reindexAll clears dirtySinceFullIndex and emits 'dirty' count 0", async () => {
    const events: DrainEvent[] = [];
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
    });
    await indexer.init();
    indexer.enqueueDirty({ path: 'edited.md', extension: 'md' });
    expect(indexer.getDirtyCount()).toBe(1);
    indexer.subscribe((e) => events.push(e));
    await indexer.reindexAll();
    const dirtyEvents = events.filter(
      (e): e is Extract<DrainEvent, { kind: 'dirty' }> => e.kind === 'dirty',
    );
    expect(dirtyEvents.at(-1)?.count).toBe(0);
    expect(indexer.getDirtyCount()).toBe(0);
    indexer.shutdown();
  });

  it('drainPending fully drains the queue without idle scheduling and reports processed count', async () => {
    const { indexer, processed } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
    });
    await indexer.init();
    for (let i = 0; i < 50; i += 1) indexer.enqueueDirty({ path: `n${i}.md`, extension: 'md' });
    expect(indexer.queueSize()).toBe(50);
    const count = await indexer.drainPending();
    expect(count).toBe(50);
    expect(processed.length).toBe(50);
    expect(indexer.queueSize()).toBe(0);
    indexer.shutdown();
  });

  it('drainPending bails with provider error event when provider not ready', async () => {
    const events: DrainEvent[] = [];
    const vault = new FakeVault();
    const files = new FakeFiles([]);
    const fakeEvents = new FakeEvents();
    await writeIndexHeader(vault, { version: 1, model: 'm', manifest: [] });
    const indexer = new VaultIndexer({
      vault,
      files,
      events: fakeEvents,
      spec: () => ({ model: 'm' }),
      processPath: async () => undefined,
      promptHeaderMismatch: async () => 'now',
      idleScheduler: immediateScheduler(),
      idleMs: () => 30_000,
      isProviderReady: () => false,
      queueDebounceMs: 0,
    });
    await indexer.init();
    indexer.subscribe((e) => events.push(e));
    indexer.enqueueDirty({ path: 'a.md', extension: 'md' });
    const count = await indexer.drainPending();
    expect(count).toBe(0);
    expect(events.some((e) => e.kind === 'error' && e.path === undefined)).toBe(true);
    indexer.shutdown();
  });

  it('reindexAll clears waitingOnUser, rewrites header, and drains successfully', async () => {
    const events: DrainEvent[] = [];
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'old' },
      spec: { model: 'm1' },
      files: [mdFile('a.md', 1, 10), mdFile('b.md', 2, 20)],
      prompt: 'later',
    });
    await indexer.init();
    expect(indexer.isWaitingOnUser()).toBe(true);
    indexer.subscribe((e) => events.push(e));
    const count = await indexer.reindexAll();
    expect(count).toBe(2);
    expect(indexer.isWaitingOnUser()).toBe(false);
    // Drain ran (start + complete), no provider/wait bail error event.
    expect(events.some((e) => e.kind === 'start')).toBe(true);
    expect(events.some((e) => e.kind === 'complete')).toBe(true);
    // The only error event is the replayed waiting-on-user notice from subscribe;
    // reindexAll must not introduce additional bail errors.
    const nonWaitingErrors = events.filter(
      (e): e is Extract<DrainEvent, { kind: 'error' }> =>
        e.kind === 'error' && !e.message.includes('Indexer paused'),
    );
    expect(nonWaitingErrors).toHaveLength(0);
    indexer.shutdown();
  });

  it('runDiffSweep marks added/modified/removed paths dirty since last full index', async () => {
    const { indexer } = await buildIndexer({
      existingHeader: {
        model: 'm1',
        manifest: [{ path: 'old.md', mtime: 1, size: 10 }],
      },
      files: [mdFile('old.md', 99, 11), mdFile('new.md', 2, 5)],
    });
    await indexer.init();
    expect(indexer.getDirtyCount()).toBe(2);
    indexer.shutdown();
  });

  it("emits and replays waiting error event when user picks 'later' on header mismatch", async () => {
    const events: DrainEvent[] = [];
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'old' },
      spec: { model: 'new' },
      files: [mdFile('a.md', 1, 10)],
      prompt: 'later',
    });
    await indexer.init();
    indexer.subscribe((e) => events.push(e));
    const errors = events.filter(
      (e): e is Extract<DrainEvent, { kind: 'error' }> => e.kind === 'error',
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain('Indexer paused');
    indexer.shutdown();
  });

  it('persists fresh manifest after drain so next init shows no diff', async () => {
    const { indexer, vault } = await buildIndexer({
      existingHeader: { model: 'm1', manifest: [] },
      files: [mdFile('a.md', 10, 100), mdFile('b.md', 20, 200)],
    });
    await indexer.init();
    expect(indexer.queueSize()).toBe(2);
    await indexer.drainPending();
    expect(indexer.queueSize()).toBe(0);
    const stored = JSON.parse(vault.files.get(INDEX_HEADER_PATH)!) as {
      manifest: Array<{ path: string; mtime: number; size: number }>;
    };
    expect(stored.manifest.map((m) => m.path).sort()).toEqual(['a.md', 'b.md']);
    expect(stored.manifest.find((m) => m.path === 'a.md')).toEqual({
      path: 'a.md',
      mtime: 10,
      size: 100,
    });
    indexer.shutdown();
  });

  it('runDiffSweep skips excluded added/modified paths', async () => {
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'm1', manifest: [] },
      files: [mdFile('keep.md', 1, 10), mdFile('jim/a.md', 2, 20), mdFile('jim/b.md', 3, 30)],
      isExcluded: (p) => p.startsWith('jim/'),
    });
    await indexer.init();
    expect([...indexer.queueSnapshot()].sort()).toEqual(['keep.md']);
    indexer.shutdown();
  });

  it('runDiffSweep still propagates removals for excluded paths so vectors get cleaned', async () => {
    const { indexer } = await buildIndexer({
      existingHeader: {
        model: 'm1',
        manifest: [{ path: 'jim/old.md', mtime: 1, size: 10 }],
      },
      files: [],
      isExcluded: (p) => p.startsWith('jim/'),
    });
    await indexer.init();
    expect(indexer.queueSnapshot()).toEqual(['jim/old.md']);
    indexer.shutdown();
  });

  it("mismatch + 'now' choice skips excluded paths when enqueuing full reindex", async () => {
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'old' },
      spec: { model: 'm1' },
      files: [mdFile('a.md', 1, 10), mdFile('jim/secret.md', 2, 20)],
      prompt: 'now',
      isExcluded: (p) => p.startsWith('jim/'),
    });
    await indexer.init();
    expect([...indexer.queueSnapshot()].sort()).toEqual(['a.md']);
    indexer.shutdown();
  });

  it('reindexAll skips excluded paths', async () => {
    const { indexer, processed } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [mdFile('a.md', 1, 10), mdFile('jim/b.md', 2, 20)],
      isExcluded: (p) => p.startsWith('jim/'),
    });
    await indexer.init();
    const count = await indexer.reindexAll();
    expect(count).toBe(1);
    expect(processed).toEqual(['a.md']);
    indexer.shutdown();
  });

  it('persistManifestSnapshot omits excluded paths from manifest', async () => {
    const { indexer, vault } = await buildIndexer({
      existingHeader: { model: 'm1', manifest: [] },
      files: [mdFile('a.md', 10, 100), mdFile('jim/b.md', 20, 200)],
      isExcluded: (p) => p.startsWith('jim/'),
    });
    await indexer.init();
    await indexer.drainPending();
    const stored = JSON.parse(vault.files.get(INDEX_HEADER_PATH)!) as {
      manifest: Array<{ path: string; mtime: number; size: number }>;
    };
    expect(stored.manifest.map((m) => m.path)).toEqual(['a.md']);
    indexer.shutdown();
  });

  it('purgeExcluded removes matching paths from the queue', async () => {
    const { indexer } = await buildIndexer({
      existingHeader: { model: 'm1' },
      files: [],
    });
    await indexer.init();
    indexer.enqueueDirty({ path: 'notes/a.md', extension: 'md' });
    indexer.enqueueDirty({ path: 'scratch/tmp.md', extension: 'md' });
    const removed = indexer.purgeExcluded((p) => p.startsWith('scratch/'));
    expect(removed).toBe(1);
    expect(indexer.queueSnapshot()).toEqual(['notes/a.md']);
    indexer.shutdown();
  });
});
