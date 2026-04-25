import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { chunkIteration, createBrowserIdleScheduler, type IdleScheduler } from './chunkIteration';
import { DirtyQueue } from './dirtyQueue';
import {
  diffManifest,
  headerMatches,
  readIndexHeader,
  writeIndexHeader,
  type IndexHeader,
  type IndexHeaderSpec,
  type IndexManifestEntry,
} from './indexHeader';

export type HeaderMismatchChoice = 'now' | 'later' | 'revert-model';

export type DrainEvent =
  | { readonly kind: 'start'; readonly size: number }
  | { readonly kind: 'tick'; readonly path: string; readonly remaining: number }
  | { readonly kind: 'complete'; readonly remaining: number }
  | { readonly kind: 'error'; readonly path?: string; readonly message: string }
  | { readonly kind: 'dirty'; readonly count: number };

export type DrainListener = (event: DrainEvent) => void;

export interface VaultFileEntry {
  readonly path: string;
  readonly extension: string;
  readonly mtime: number;
  readonly size: number;
}

export interface VaultFileSource {
  listMarkdown(): readonly VaultFileEntry[];
}

export interface VaultEventKind {
  readonly kind: 'create' | 'modify' | 'delete' | 'rename';
  readonly path: string;
  readonly oldPath?: string;
}

export interface VaultEventSource {
  on(handler: (event: VaultEventKind) => void): () => void;
}

export interface HeaderMismatchPromptFn {
  (): Promise<HeaderMismatchChoice>;
}

export interface RevertModelFn {
  (previous: IndexHeaderSpec): Promise<void> | void;
}

export interface VaultIndexerOptions {
  readonly vault: VaultAdapter;
  readonly files: VaultFileSource;
  readonly events: VaultEventSource;
  readonly spec: () => IndexHeaderSpec;
  readonly processPath: (path: string, signal: AbortSignal) => Promise<void>;
  readonly promptHeaderMismatch: HeaderMismatchPromptFn;
  readonly revertModel?: RevertModelFn;
  readonly idleScheduler?: IdleScheduler;
  readonly logger?: Logger;
  readonly idleMs?: () => number;
  readonly minChunkBudgetMs?: number;
  readonly queueDebounceMs?: number;
  readonly isProviderReady?: () => boolean;
  readonly isExcluded?: (path: string) => boolean;
}

const MARKDOWN_EXTENSION = 'md';
const CANVAS_EXTENSION = 'canvas';
const INDEXABLE_EXTENSIONS: ReadonlySet<string> = new Set([MARKDOWN_EXTENSION, CANVAS_EXTENSION]);
const DEFAULT_IDLE_MS = 30_000;
const WAITING_ON_USER_MESSAGE =
  'Indexer paused — embedding model changed; choose Re-index now or revert in settings.';

export class VaultIndexer {
  private readonly vault: VaultAdapter;
  private readonly files: VaultFileSource;
  private readonly events: VaultEventSource;
  private readonly spec: () => IndexHeaderSpec;
  private readonly processPath: (path: string, signal: AbortSignal) => Promise<void>;
  private readonly promptHeaderMismatch: HeaderMismatchPromptFn;
  private readonly revertModel: RevertModelFn | null;
  private readonly idleScheduler: IdleScheduler;
  private readonly logger: Logger | undefined;
  private readonly idleMs: () => number;
  private readonly minChunkBudget: number;
  private readonly isProviderReady: () => boolean;
  private readonly isExcluded: (path: string) => boolean;

  private readonly queue: DirtyQueue;
  private readonly drainListeners = new Set<DrainListener>();
  private readonly abortControllers = new Set<AbortController>();
  private lastDirtyEmitted = -1;
  private unsubscribeEvents: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private draining = false;
  private disposed = false;
  private waitingOnUser = false;
  private lastHeader: IndexHeader | null = null;

  constructor(opts: VaultIndexerOptions) {
    this.vault = opts.vault;
    this.files = opts.files;
    this.events = opts.events;
    this.spec = opts.spec;
    this.processPath = opts.processPath;
    this.promptHeaderMismatch = opts.promptHeaderMismatch;
    this.revertModel = opts.revertModel ?? null;
    this.idleScheduler = opts.idleScheduler ?? createBrowserIdleScheduler();
    this.logger = opts.logger;
    this.idleMs = opts.idleMs ?? ((): number => DEFAULT_IDLE_MS);
    this.minChunkBudget = opts.minChunkBudgetMs ?? 5;
    this.isProviderReady = opts.isProviderReady ?? ((): boolean => true);
    this.isExcluded = opts.isExcluded ?? ((): boolean => false);
    this.queue = new DirtyQueue({
      vault: this.vault,
      ...(this.logger !== undefined ? { logger: this.logger } : {}),
      ...(opts.queueDebounceMs !== undefined ? { debounceMs: opts.queueDebounceMs } : {}),
    });
  }

  async init(): Promise<void> {
    await this.queue.load();
    this.emitDirtyIfChanged();
    this.lastHeader = await readIndexHeader(this.vault, this.logger);
    const expected = this.spec();
    const headerOk = headerMatches(this.lastHeader, expected);
    if (!headerOk) {
      this.logger?.info('indexer.header.mismatch', {
        storedModel: this.lastHeader?.model ?? null,
        storedVersion: this.lastHeader?.version ?? null,
        expectedModel: expected.model,
      });
      const choice = await this.promptHeaderMismatch();
      this.logger?.info('indexer.header.user-choice', { choice });
      if (choice === 'now') {
        for (const entry of this.files.listMarkdown()) {
          if (INDEXABLE_EXTENSIONS.has(entry.extension)) this.queue.add(entry.path);
        }
        await writeIndexHeader(this.vault, {
          model: expected.model,
          version: this.lastHeader?.version ?? 1,
          manifest: [],
        });
      } else if (choice === 'revert-model') {
        if (this.lastHeader !== null && this.revertModel !== null) {
          await this.revertModel({ model: this.lastHeader.model });
        }
        this.waitingOnUser = false;
        this.registerListeners();
        return;
      } else {
        this.waitingOnUser = true;
        this.emitDrain({ kind: 'error', message: WAITING_ON_USER_MESSAGE });
        this.registerListeners();
        return;
      }
    } else {
      this.logger?.info('indexer.header.match', { model: expected.model });
    }
    this.runDiffSweep();
    this.registerListeners();
    this.scheduleIdleDrain();
  }

  enqueueDirty(entry: { path: string; extension?: string }): boolean {
    if (this.disposed) return false;
    const ext = entry.extension ?? inferExtension(entry.path);
    if (!INDEXABLE_EXTENSIONS.has(ext)) {
      this.logger?.debug('indexer.skip.non-indexable', { path: entry.path, extension: ext });
      return false;
    }
    if (this.isExcluded(entry.path)) {
      this.logger?.info('exclude.indexer.skip', { patternCount: 0 });
      this.logger?.debug('indexer.skip.excluded', { path: entry.path });
      return false;
    }
    if (this.queue.add(entry.path)) {
      this.logger?.info('indexer.enqueue', { path: entry.path });
      this.emitDirtyIfChanged();
      if (!this.draining) this.scheduleIdleDrain();
      return true;
    }
    return false;
  }

  private emitDirtyIfChanged(): void {
    const count = this.queue.size();
    if (count === this.lastDirtyEmitted) return;
    this.lastDirtyEmitted = count;
    this.emitDrain({ kind: 'dirty', count });
  }

  getDirtyCount(): number {
    return this.queue.size();
  }

  private bailDrain(reason: string): void {
    this.logger?.warn('indexer.drain.bailed', { reason });
    this.emitDrain({ kind: 'error', message: reason });
  }

  private checkDrainPreconditions(): string | null {
    if (this.waitingOnUser) {
      return WAITING_ON_USER_MESSAGE;
    }
    if (!this.isProviderReady()) {
      return 'Embedding provider unavailable — check provider connection and try again.';
    }
    return null;
  }

  async processDueWork(signal: AbortSignal): Promise<void> {
    if (this.draining) return;
    if (this.queue.size() === 0) return;
    const bail = this.checkDrainPreconditions();
    if (bail !== null) {
      this.bailDrain(bail);
      return;
    }
    this.draining = true;
    const controller = linkController(signal);
    this.abortControllers.add(controller);
    const startSize = this.queue.size();
    this.logger?.info('indexer.drain.start', { size: startSize });
    this.emitDrain({ kind: 'start', size: startSize });
    try {
      while (this.queue.size() > 0 && !controller.signal.aborted) {
        const deadline = await this.awaitIdleTick();
        if (controller.signal.aborted) break;
        const batch = this.queue.snapshot();
        const { now } = chunkIteration(batch, deadline, this.minChunkBudget);
        if (now.length === 0) break;
        for (const path of now) {
          if (controller.signal.aborted) break;
          this.queue.remove(path);
          try {
            await this.processPath(path, controller.signal);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger?.warn('indexer.process.failed', { path, error: message });
            this.emitDrain({ kind: 'error', path, message });
          }
          this.logger?.debug('indexer.drain.tick', { path });
          this.emitDrain({ kind: 'tick', path, remaining: this.queue.size() });
        }
      }
    } finally {
      this.draining = false;
      this.abortControllers.delete(controller);
      const remaining = this.queue.size();
      if (remaining === 0 && !controller.signal.aborted) {
        await this.persistManifestSnapshot();
      }
      this.logger?.info('indexer.drain.complete', { remaining });
      this.emitDrain({ kind: 'complete', remaining });
      this.emitDirtyIfChanged();
      if (remaining > 0) this.scheduleIdleDrain();
    }
  }

  private emitDrain(event: DrainEvent): void {
    for (const l of this.drainListeners) {
      try {
        l(event);
      } catch (err) {
        this.logger?.warn('indexer.drain.listener-failed', {
          kind: event.kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  queueSize(): number {
    return this.queue.size();
  }

  queueSnapshot(): readonly string[] {
    return this.queue.snapshot();
  }

  async flushQueue(): Promise<void> {
    await this.queue.flush();
  }

  private async persistManifestSnapshot(): Promise<void> {
    if (this.disposed) return;
    const expected = this.spec();
    const entries = this.files.listMarkdown().filter((e) => INDEXABLE_EXTENSIONS.has(e.extension));
    const manifest: IndexManifestEntry[] = entries.map((e) => ({
      path: e.path,
      mtime: e.mtime,
      size: e.size,
    }));
    const next: IndexHeader = {
      model: expected.model,
      version: this.lastHeader?.version ?? 1,
      manifest,
    };
    try {
      await writeIndexHeader(this.vault, next);
      this.lastHeader = next;
      this.logger?.debug('indexer.manifest.persisted', { count: manifest.length });
    } catch (err) {
      this.logger?.warn('indexer.manifest.persist-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  purgeExcluded(predicate: (path: string) => boolean): number {
    const removed: string[] = [];
    for (const p of this.queue.snapshot()) {
      if (predicate(p)) removed.push(p);
    }
    for (const p of removed) this.queue.remove(p);
    if (removed.length > 0) {
      this.logger?.info('indexer.queue.purged-excluded', { count: removed.length });
    }
    return removed.length;
  }

  /**
   * Drain the entire dirty queue immediately, bypassing the idle scheduler.
   * Used for user-triggered "reindex changed" so we never get stuck under a
   * tight `requestIdleCallback` deadline that returns zero work per tick.
   */
  async drainPending(signal?: AbortSignal): Promise<number> {
    if (this.disposed) return 0;
    if (this.draining) return 0;
    if (this.queue.size() === 0) return 0;
    const bail = this.checkDrainPreconditions();
    if (bail !== null) {
      this.bailDrain(bail);
      return 0;
    }
    this.clearIdleTimer();
    this.draining = true;
    const controller = linkController(signal ?? new AbortController().signal);
    this.abortControllers.add(controller);
    const startSize = this.queue.size();
    let processed = 0;
    this.logger?.info('indexer.drain.start', { size: startSize, mode: 'immediate' });
    this.emitDrain({ kind: 'start', size: startSize });
    try {
      while (this.queue.size() > 0 && !controller.signal.aborted) {
        const batch = this.queue.snapshot();
        for (const path of batch) {
          if (controller.signal.aborted) break;
          this.queue.remove(path);
          try {
            await this.processPath(path, controller.signal);
            processed += 1;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger?.warn('indexer.process.failed', { path, error: message });
            this.emitDrain({ kind: 'error', path, message });
          }
          this.emitDrain({ kind: 'tick', path, remaining: this.queue.size() });
        }
      }
      return processed;
    } finally {
      this.draining = false;
      this.abortControllers.delete(controller);
      const remaining = this.queue.size();
      if (remaining === 0 && !controller.signal.aborted) {
        await this.persistManifestSnapshot();
      }
      this.logger?.info('indexer.drain.complete', { remaining, mode: 'immediate' });
      this.emitDrain({ kind: 'complete', remaining });
      this.emitDirtyIfChanged();
    }
  }

  async reindexAll(signal?: AbortSignal): Promise<number> {
    if (this.disposed) return 0;
    if (this.waitingOnUser) {
      const expected = this.spec();
      await writeIndexHeader(this.vault, {
        model: expected.model,
        version: this.lastHeader?.version ?? 1,
        manifest: [],
      });
      this.lastHeader = await readIndexHeader(this.vault, this.logger);
      this.waitingOnUser = false;
      this.logger?.info('indexer.reindex.resume-from-wait', { model: expected.model });
    }
    const entries = this.files.listMarkdown().filter((e) => INDEXABLE_EXTENSIONS.has(e.extension));
    for (const entry of entries) this.queue.add(entry.path);
    this.emitDirtyIfChanged();
    this.logger?.info('indexer.reindex.enqueued', { count: entries.length });
    await this.drainPending(signal);
    return entries.length;
  }

  isWaitingOnUser(): boolean {
    return this.waitingOnUser;
  }

  resumeFromWait(): void {
    if (!this.waitingOnUser) return;
    this.waitingOnUser = false;
    this.scheduleIdleDrain();
  }

  subscribe(listener: DrainListener): () => void {
    this.drainListeners.add(listener);
    // Replay current dirty count so a freshly-mounted UI immediately reflects
    // pending work that was emitted before subscription.
    try {
      listener({ kind: 'dirty', count: this.queue.size() });
      if (this.waitingOnUser) {
        listener({ kind: 'error', message: WAITING_ON_USER_MESSAGE });
      }
    } catch (err) {
      this.logger?.warn('indexer.drain.listener-failed', {
        kind: 'dirty',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return (): void => {
      this.drainListeners.delete(listener);
    };
  }

  shutdown(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearIdleTimer();
    for (const c of this.abortControllers) c.abort();
    this.abortControllers.clear();
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.queue.dispose();
  }

  private registerListeners(): void {
    if (this.unsubscribeEvents !== null) return;
    this.unsubscribeEvents = this.events.on((event) => {
      if (this.disposed) return;
      if (event.kind === 'rename') {
        if (event.oldPath !== undefined) {
          this.enqueueDirty({ path: event.oldPath });
        }
        this.enqueueDirty({ path: event.path });
        return;
      }
      this.enqueueDirty({ path: event.path });
    });
  }

  private runDiffSweep(): void {
    const storedManifest = this.lastHeader?.manifest ?? [];
    const currentEntries = this.files
      .listMarkdown()
      .filter((e) => INDEXABLE_EXTENSIONS.has(e.extension));
    const current: IndexManifestEntry[] = currentEntries.map((e) => ({
      path: e.path,
      mtime: e.mtime,
      size: e.size,
    }));
    const { added, modified, removed } = diffManifest(storedManifest, current);
    for (const p of [...added, ...modified, ...removed]) this.queue.add(p);
    this.emitDirtyIfChanged();
    this.logger?.info('indexer.diff.complete', {
      added: added.length,
      modified: modified.length,
      removed: removed.length,
    });
  }

  private scheduleIdleDrain(): void {
    if (this.disposed) return;
    if (this.waitingOnUser) return;
    if (this.queue.size() === 0) return;
    if (this.idleTimer !== null) return;
    const ms = this.idleMs();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.processDueWork(new AbortController().signal);
    }, ms);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private awaitIdleTick(): Promise<{ timeRemaining: () => number; didTimeout: boolean }> {
    return new Promise((resolve) => {
      this.idleScheduler.schedule((deadline) => {
        resolve({
          timeRemaining: (): number => deadline.timeRemaining(),
          didTimeout: deadline.didTimeout ?? false,
        });
      });
    });
  }
}

function inferExtension(path: string): string {
  const i = path.lastIndexOf('.');
  if (i < 0) return '';
  return path.slice(i + 1).toLowerCase();
}

function linkController(signal: AbortSignal): AbortController {
  const c = new AbortController();
  if (signal.aborted) {
    c.abort();
    return c;
  }
  signal.addEventListener('abort', () => c.abort(), { once: true });
  return c;
}
