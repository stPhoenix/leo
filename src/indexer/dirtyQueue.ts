import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { debounce } from '@/util/debounce';
import { EXTERNAL_AGENT_RESULTS_PREFIX } from '@/agent/externalAgent/resultWriter';
import { WIKI_DIR_PREFIX } from '@/agent/wiki/paths';

export const DIRTY_QUEUE_PATH = '.leo/index/queue.json';
export const DIRTY_QUEUE_SCHEMA_VERSION = 1;
const PERSIST_DEBOUNCE_MS = 50;
const DROP_PREFIXES: readonly string[] = [EXTERNAL_AGENT_RESULTS_PREFIX, WIKI_DIR_PREFIX];

export interface DirtyQueueOptions {
  readonly vault: VaultAdapter;
  readonly logger?: Logger;
  readonly debounceMs?: number;
}

export class DirtyQueue {
  private readonly vault: VaultAdapter;
  private readonly logger: Logger | undefined;
  private readonly paths = new Set<string>();
  private readonly persist: ReturnType<typeof debounce<[]>>;

  constructor(opts: DirtyQueueOptions) {
    this.vault = opts.vault;
    this.logger = opts.logger;
    this.persist = debounce((): void => {
      void this.flush();
    }, opts.debounceMs ?? PERSIST_DEBOUNCE_MS);
  }

  async load(): Promise<void> {
    try {
      if (!(await this.vault.exists(DIRTY_QUEUE_PATH))) return;
      const raw = await this.vault.read(DIRTY_QUEUE_PATH);
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== 'object') return;
      const obj = parsed as Record<string, unknown>;
      if (!Array.isArray(obj.paths)) return;
      for (const p of obj.paths) {
        if (typeof p === 'string' && p.length > 0) this.paths.add(p);
      }
    } catch (err) {
      this.logger?.warn('indexer.queue.load-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  add(path: string): boolean {
    for (const prefix of DROP_PREFIXES) {
      if (path.startsWith(prefix)) return false;
    }
    if (this.paths.has(path)) return false;
    this.paths.add(path);
    this.persist();
    return true;
  }

  remove(path: string): boolean {
    if (!this.paths.delete(path)) return false;
    this.persist();
    return true;
  }

  has(path: string): boolean {
    return this.paths.has(path);
  }

  size(): number {
    return this.paths.size;
  }

  snapshot(): readonly string[] {
    return [...this.paths];
  }

  clear(): void {
    if (this.paths.size === 0) return;
    this.paths.clear();
    this.persist();
  }

  async flush(): Promise<void> {
    const payload = JSON.stringify(
      {
        version: DIRTY_QUEUE_SCHEMA_VERSION,
        paths: [...this.paths],
      },
      null,
      2,
    );
    try {
      await this.vault.mkdir('.leo/index');
      await this.vault.write(DIRTY_QUEUE_PATH, payload);
      this.logger?.info('indexer.queue.persisted', { size: this.paths.size });
    } catch (err) {
      this.logger?.warn('indexer.queue.persist-failed', {
        size: this.paths.size,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  dispose(): void {
    this.persist.cancel();
  }
}
