import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from './vaultAdapter';
import { ConversationStore } from './conversationStore';
import { emptyThread, parseThread, serializeThread, type StoredThread } from './conversationSchema';

export const THREADS_DIR = '.leo/conversations';
export const TRASH_SUBDIR = '.trash';
export const DEFAULT_UNDO_WINDOW_MS = 10_000;
export const DEFAULT_THREAD_TITLE = 'New thread';
// Skills no longer bind to threads (doc §1 model). Kept as a deprecated export
// while downstream consumers migrate off the constant.
export const DEFAULT_SKILL_ID = null;

export interface ThreadSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly messageCount: number;
}

export interface ThreadsSnapshot {
  readonly activeId: string | null;
  readonly summaries: readonly ThreadSummary[];
}

export interface ActiveIdPersistence {
  load(): Promise<string | null>;
  save(id: string): Promise<void>;
}

export interface ThreadsStoreOptions {
  readonly adapter: VaultAdapter;
  readonly logger: Logger;
  readonly clock?: () => Date;
  readonly baseDir?: string;
  readonly createStore?: (
    id: string,
    deps: { adapter: VaultAdapter; logger: Logger; clock: () => Date; baseDir: string },
  ) => ConversationStore;
  readonly persistActiveId?: ActiveIdPersistence;
  readonly undoWindowMs?: number;
  readonly idGenerator?: () => string;
  readonly onNotify?: (msg: string, action?: { label: string; run: () => void }) => void;
  readonly scheduleUndo?: (run: () => void, ms: number) => { cancel: () => void };
}

interface PendingDeletion {
  readonly id: string;
  readonly finalize: { cancel: () => void };
}

export class ThreadsStore {
  private readonly adapter: VaultAdapter;
  private readonly logger: Logger;
  private readonly clock: () => Date;
  private readonly baseDir: string;
  private readonly trashDir: string;
  private readonly createStore: (
    id: string,
    deps: { adapter: VaultAdapter; logger: Logger; clock: () => Date; baseDir: string },
  ) => ConversationStore;
  private readonly persist: ActiveIdPersistence | null;
  private readonly undoWindowMs: number;
  private readonly idGenerator: () => string;
  private readonly onNotify: ThreadsStoreOptions['onNotify'];
  private readonly scheduleUndo: NonNullable<ThreadsStoreOptions['scheduleUndo']>;
  private readonly storeCache = new Map<string, ConversationStore>();
  private readonly pendingDeletions = new Map<string, PendingDeletion>();
  private activeId: string | null = null;
  private cachedSnapshot: ThreadsSnapshot = { activeId: null, summaries: [] };
  private readonly subscribers = new Set<() => void>();
  private refreshing: Promise<void> | null = null;

  constructor(opts: ThreadsStoreOptions) {
    this.adapter = opts.adapter;
    this.logger = opts.logger;
    this.clock = opts.clock ?? ((): Date => new Date());
    this.baseDir = opts.baseDir ?? THREADS_DIR;
    this.trashDir = `${this.baseDir}/${TRASH_SUBDIR}`;
    this.createStore =
      opts.createStore ??
      ((id, deps) =>
        new ConversationStore({
          adapter: deps.adapter,
          logger: deps.logger,
          clock: deps.clock,
          baseDir: deps.baseDir,
          threadId: id,
        }));
    this.persist = opts.persistActiveId ?? null;
    this.undoWindowMs = opts.undoWindowMs ?? DEFAULT_UNDO_WINDOW_MS;
    this.idGenerator = opts.idGenerator ?? defaultIdGenerator;
    this.onNotify = opts.onNotify;
    this.scheduleUndo =
      opts.scheduleUndo ??
      ((run, ms): { cancel: () => void } => {
        const handle = setTimeout(run, ms);
        return {
          cancel: (): void => {
            clearTimeout(handle);
          },
        };
      });
  }

  async init(): Promise<string> {
    await this.adapter.mkdir(this.baseDir);
    const stored = this.persist !== null ? await this.persist.load() : null;
    const summaries = await this.list();
    if (stored !== null && summaries.some((s) => s.id === stored)) {
      await this.setActive(stored);
      await this.refreshSnapshot();
      return stored;
    }
    if (summaries.length > 0) {
      const freshest = summaries[0]!;
      await this.setActive(freshest.id);
      this.logger.info('thread.fallback', { id: freshest.id, reason: 'stored-missing' });
      await this.refreshSnapshot();
      return freshest.id;
    }
    const created = await this.create();
    return created;
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  getSnapshot = (): ThreadsSnapshot => this.cachedSnapshot;

  async refreshSnapshot(): Promise<void> {
    if (this.refreshing !== null) {
      await this.refreshing;
      return;
    }
    const run = (async (): Promise<void> => {
      try {
        const summaries = await this.list();
        this.cachedSnapshot = { activeId: this.activeId, summaries };
        this.notify();
      } finally {
        this.refreshing = null;
      }
    })();
    this.refreshing = run;
    await run;
  }

  private notify(): void {
    for (const l of this.subscribers) l();
  }

  async list(): Promise<readonly ThreadSummary[]> {
    await this.adapter.mkdir(this.baseDir);
    const listing = await this.adapter.list(this.baseDir);
    const summaries: ThreadSummary[] = [];
    for (const entry of listing.files) {
      const name = baseName(entry);
      if (!name.endsWith('.json')) continue;
      if (entry.includes(`/${TRASH_SUBDIR}/`)) continue;
      const id = name.slice(0, -'.json'.length);
      if (id.startsWith('.')) continue;
      try {
        const raw = await this.adapter.read(entry);
        const thread = parseThread(JSON.parse(raw), { logger: this.logger, path: entry });
        summaries.push({
          id: thread.id,
          title: thread.metadata.title ?? DEFAULT_THREAD_TITLE,
          updatedAt: thread.updatedAt,
          messageCount: thread.messages.length,
        });
      } catch (err) {
        this.logger.warn('thread.list.parse-failed', {
          path: entry,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    summaries.sort((a, b) => {
      if (b.updatedAt < a.updatedAt) return -1;
      if (b.updatedAt > a.updatedAt) return 1;
      return 0;
    });
    return summaries;
  }

  async create(): Promise<string> {
    const id = this.idGenerator();
    const nowIso = this.clock().toISOString();
    const fresh: StoredThread = {
      ...emptyThread(id, nowIso),
      metadata: {
        allowedTools: [],
        title: id,
      },
    };
    await this.adapter.mkdir(this.baseDir);
    await this.adapter.write(this.pathFor(id), serializeThread(fresh));
    await this.setActive(id);
    this.logger.info('thread.create', { id });
    await this.refreshSnapshot();
    return id;
  }

  async switch(id: string): Promise<void> {
    if (this.activeId === id) return;
    const current = this.activeId;
    if (current !== null) {
      const store = this.storeCache.get(current);
      if (store !== undefined) await store.flush();
    }
    await this.setActive(id);
    this.logger.info('thread.switch', { id });
    await this.refreshSnapshot();
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const store = await this.storeFor(id);
    store.mutate((t) => ({
      ...t,
      metadata: { ...t.metadata, title: trimmed },
    }));
    await store.flush();
    this.logger.info('thread.rename', { id });
    await this.refreshSnapshot();
  }

  async delete(id: string): Promise<void> {
    if (this.pendingDeletions.has(id)) return;
    const sourcePath = this.pathFor(id);
    if (!(await this.adapter.exists(sourcePath))) return;
    await this.adapter.mkdir(this.trashDir);
    const trashPath = this.trashPathFor(id);
    if (await this.adapter.exists(trashPath)) await this.adapter.remove(trashPath);
    await this.adapter.rename(sourcePath, trashPath);
    const cached = this.storeCache.get(id);
    if (cached !== undefined) {
      cached.dispose();
      this.storeCache.delete(id);
    }
    this.logger.info('thread.delete', { id });
    const finalize = this.scheduleUndo(async () => {
      try {
        if (await this.adapter.exists(trashPath)) await this.adapter.remove(trashPath);
      } catch (err) {
        this.logger.warn('thread.delete.finalize-failed', {
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.pendingDeletions.delete(id);
    }, this.undoWindowMs);
    this.pendingDeletions.set(id, { id, finalize });
    if (this.onNotify !== undefined) {
      this.onNotify(`Thread deleted`, {
        label: 'Undo',
        run: () => {
          void this.restore(id);
        },
      });
    }
    if (this.activeId === id) {
      const remaining = (await this.list()).filter((s) => s.id !== id);
      if (remaining.length > 0) {
        await this.setActive(remaining[0]!.id);
      } else {
        await this.create();
        return;
      }
    }
    await this.refreshSnapshot();
  }

  async restore(id: string): Promise<void> {
    const pending = this.pendingDeletions.get(id);
    if (pending === undefined) return;
    pending.finalize.cancel();
    this.pendingDeletions.delete(id);
    const trashPath = this.trashPathFor(id);
    const target = this.pathFor(id);
    if (!(await this.adapter.exists(trashPath))) return;
    if (await this.adapter.exists(target)) await this.adapter.remove(target);
    await this.adapter.rename(trashPath, target);
    await this.setActive(id);
    this.logger.info('thread.delete.undo', { id });
    await this.refreshSnapshot();
  }

  activeIdOrNull(): string | null {
    return this.activeId;
  }

  async active(): Promise<ConversationStore> {
    if (this.activeId === null) throw new Error('ThreadsStore: no active thread');
    return this.storeFor(this.activeId);
  }

  async shutdown(): Promise<void> {
    for (const store of this.storeCache.values()) {
      try {
        await store.flush();
      } catch {
        /* best effort */
      }
      store.dispose();
    }
    this.storeCache.clear();
    for (const pending of this.pendingDeletions.values()) pending.finalize.cancel();
    this.pendingDeletions.clear();
  }

  private async storeFor(id: string): Promise<ConversationStore> {
    let store = this.storeCache.get(id);
    if (store === undefined) {
      store = this.createStore(id, {
        adapter: this.adapter,
        logger: this.logger,
        clock: this.clock,
        baseDir: this.baseDir,
      });
      this.storeCache.set(id, store);
      await store.load();
    }
    return store;
  }

  private async setActive(id: string): Promise<void> {
    this.activeId = id;
    await this.storeFor(id);
    if (this.persist !== null) await this.persist.save(id);
  }

  private pathFor(id: string): string {
    return `${this.baseDir}/${id}.json`;
  }

  private trashPathFor(id: string): string {
    return `${this.trashDir}/${id}.json`;
  }
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function defaultIdGenerator(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; // NOSONAR(typescript:S2245): non-cryptographic thread ID; crypto.randomUUID is the primary path.
}
