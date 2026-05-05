import type { Logger } from '@/platform/Logger';
import type { Chunk } from '@/indexer/chunker';
import type { VaultAdapter } from './vaultAdapter';

export const VECTOR_STORE_DB_NAME = 'leo-index';
export const VECTOR_STORE_SCHEMA_VERSION = 1 as const;
export const VECTOR_STORE_DEFAULT_BASE_PATH = '.leo/index/vectors';

export type CorruptionReason =
  | 'open-failed'
  | 'missing-store'
  | 'version-mismatch'
  | 'dim-mismatch'
  | 'shape-invalid';

export class CorruptIndexError extends Error {
  override readonly name = 'CorruptIndexError';
  constructor(
    public readonly reason: CorruptionReason,
    message = `index corrupted: ${reason}`,
  ) {
    super(message);
  }
}

export interface VectorRow {
  readonly id: string;
  readonly path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly heading_path: readonly string[];
  readonly frontmatter_tags: readonly string[];
  readonly inline_tags: readonly string[];
  readonly text: string;
  readonly vector: readonly number[];
}

export interface IndexHeaderRow {
  readonly key: 'header';
  readonly model: string;
  readonly dim: number;
  readonly version: number;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

export interface VectorStoreEvents {
  readonly on: (
    handler: (event: { kind: 'corruption'; reason: CorruptionReason }) => void,
  ) => () => void;
}

export interface VectorStoreOptions {
  readonly vault: VaultAdapter;
  readonly basePath?: string;
  readonly logger?: Logger;
}

interface OnDiskShape {
  readonly schemaVersion: number;
  readonly header: IndexHeaderRow | null;
  readonly items: readonly VectorRow[];
}

export function chunkRowId(path: string, lineStart: number, lineEnd: number): string {
  return `${path}#${lineStart}-${lineEnd}`;
}

export class VectorStore {
  private readonly vault: VaultAdapter;
  private readonly basePath: string;
  private readonly indexPath: string;
  private readonly tmpPath: string;
  private readonly logger: Logger | undefined;
  private readonly listeners = new Set<
    (e: { kind: 'corruption'; reason: CorruptionReason }) => void
  >();

  private rows = new Map<string, VectorRow>();
  private byPath = new Map<string, Set<string>>();
  private header: IndexHeaderRow | null = null;
  private loaded = false;
  private available = true;
  private writing: Promise<void> | null = null;

  constructor(opts: VectorStoreOptions) {
    this.vault = opts.vault;
    this.basePath = opts.basePath ?? VECTOR_STORE_DEFAULT_BASE_PATH;
    this.indexPath = `${this.basePath}/index.json`;
    this.tmpPath = `${this.basePath}/index.json.tmp`;
    this.logger = opts.logger;
  }

  async open(): Promise<void> {
    try {
      await this.vault.mkdir(this.basePath);
      const indexExists = await this.vault.exists(this.indexPath);
      const tmpExists = await this.vault.exists(this.tmpPath);
      if (!indexExists && tmpExists) {
        // crash mid-write: stale tmp with no committed index
        await this.vault.remove(this.tmpPath);
        throw new CorruptIndexError('open-failed');
      }
      if (tmpExists && indexExists) {
        // committed index present; clean up orphan tmp
        await this.vault.remove(this.tmpPath);
      }
      if (indexExists) {
        const raw = await this.vault.read(this.indexPath);
        const parsed = JSON.parse(raw) as OnDiskShape;
        this.header = parsed.header ?? null;
        this.rows.clear();
        this.byPath.clear();
        for (const row of parsed.items ?? []) {
          this.rows.set(row.id, row);
          let set = this.byPath.get(row.path);
          if (set === undefined) {
            set = new Set<string>();
            this.byPath.set(row.path, set);
          }
          set.add(row.id);
        }
      }
      this.loaded = true;
    } catch (err) {
      this.logger?.error('index.store.open-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof CorruptIndexError) throw err;
      throw new CorruptIndexError('open-failed');
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  subscribe(handler: (e: { kind: 'corruption'; reason: CorruptionReason }) => void): () => void {
    this.listeners.add(handler);
    return (): void => {
      this.listeners.delete(handler);
    };
  }

  async verify(): Promise<Result<void>> {
    try {
      if (!this.loaded) await this.open();
      if (this.header !== null && this.header.version !== VECTOR_STORE_SCHEMA_VERSION) {
        throw new CorruptIndexError('version-mismatch');
      }
      const first = this.rows.values().next();
      if (!first.done) {
        const row = first.value;
        const shape = validateVectorRow(row);
        if (!shape.ok) throw new CorruptIndexError('shape-invalid');
        if (this.header !== null && row.vector.length !== this.header.dim) {
          throw new CorruptIndexError('dim-mismatch');
        }
      }
      this.logger?.info('index.store.verify.pass', {});
      return { ok: true, value: undefined };
    } catch (err) {
      const error = err instanceof CorruptIndexError ? err : new CorruptIndexError('open-failed');
      this.available = false;
      this.logger?.warn('index.store.verify.fail', { reason: error.reason });
      for (const l of this.listeners) l({ kind: 'corruption', reason: error.reason });
      return { ok: false, error };
    }
  }

  async upsert(
    path: string,
    chunks: readonly Chunk[],
    vectors: readonly (readonly number[])[],
  ): Promise<Result<void>> {
    if (chunks.length !== vectors.length) {
      return {
        ok: false,
        error: new Error(`upsert mismatch: ${chunks.length} chunks vs ${vectors.length} vectors`),
      };
    }
    if (!this.loaded) {
      try {
        await this.open();
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err : new CorruptIndexError('open-failed'),
        };
      }
    }
    try {
      const existing = this.byPath.get(path);
      if (existing !== undefined) {
        for (const id of existing) this.rows.delete(id);
      }
      const newIds = new Set<string>();
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i]!;
        const vector = vectors[i]!;
        const row: VectorRow = {
          id: chunkRowId(chunk.path, chunk.line_start, chunk.line_end),
          path: chunk.path,
          line_start: chunk.line_start,
          line_end: chunk.line_end,
          heading_path: chunk.heading_path,
          frontmatter_tags: chunk.frontmatter_tags,
          inline_tags: chunk.inline_tags,
          text: chunk.text,
          vector: [...vector],
        };
        this.rows.set(row.id, row);
        newIds.add(row.id);
      }
      if (newIds.size > 0) {
        this.byPath.set(path, newIds);
      } else {
        this.byPath.delete(path);
      }
      await this.flush();
      this.logger?.info('index.store.upsert', { path, count: chunks.length });
      return { ok: true, value: undefined };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger?.warn('index.store.upsert-failed', { path, error: error.message });
      return { ok: false, error };
    }
  }

  async deleteByPath(path: string): Promise<Result<number>> {
    if (!this.loaded) {
      try {
        await this.open();
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err : new CorruptIndexError('open-failed'),
        };
      }
    }
    try {
      const ids = this.byPath.get(path);
      if (ids === undefined || ids.size === 0) return { ok: true, value: 0 };
      let deleted = 0;
      for (const id of ids) {
        if (this.rows.delete(id)) deleted += 1;
      }
      this.byPath.delete(path);
      await this.flush();
      return { ok: true, value: deleted };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  async listHeader(): Promise<IndexHeaderRow | null> {
    if (!this.loaded) {
      try {
        await this.open();
      } catch {
        return null;
      }
    }
    return this.header;
  }

  async writeHeader(header: { model: string; dim: number }): Promise<Result<void>> {
    if (!this.loaded) {
      try {
        await this.open();
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err : new CorruptIndexError('open-failed'),
        };
      }
    }
    try {
      this.header = {
        key: 'header',
        model: header.model,
        dim: header.dim,
        version: VECTOR_STORE_SCHEMA_VERSION,
      };
      await this.flush();
      this.logger?.info('index.store.header.write', { model: header.model, dim: header.dim });
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  async getAll(): Promise<readonly VectorRow[]> {
    if (!this.loaded) {
      try {
        await this.open();
      } catch {
        return [];
      }
    }
    return Array.from(this.rows.values());
  }

  async rebuild(): Promise<Result<void>> {
    try {
      this.close();
      for (const p of [this.indexPath, this.tmpPath]) {
        if (await this.vault.exists(p)) await this.vault.remove(p);
      }
      await this.open();
      this.available = true;
      this.logger?.info('index.store.corruption.rebuild', { basePath: this.basePath });
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  close(): void {
    this.rows.clear();
    this.byPath.clear();
    this.header = null;
    this.loaded = false;
  }

  private async flush(): Promise<void> {
    const previous = this.writing ?? Promise.resolve();
    const next = previous.then(async () => {
      const payload: OnDiskShape = {
        schemaVersion: VECTOR_STORE_SCHEMA_VERSION,
        header: this.header,
        items: Array.from(this.rows.values()),
      };
      const json = JSON.stringify(payload);
      await this.vault.write(this.tmpPath, json);
      await this.vault.rename(this.tmpPath, this.indexPath);
    });
    this.writing = next.catch(() => undefined).then(() => undefined);
    await next;
  }
}

export function validateVectorRow(
  raw: unknown,
): { ok: true; value: VectorRow } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object') return { ok: false, error: 'row not object' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string') return { ok: false, error: 'id not string' };
  if (typeof obj.path !== 'string') return { ok: false, error: 'path not string' };
  if (typeof obj.line_start !== 'number') return { ok: false, error: 'line_start not number' };
  if (typeof obj.line_end !== 'number') return { ok: false, error: 'line_end not number' };
  if (!Array.isArray(obj.heading_path)) return { ok: false, error: 'heading_path not array' };
  if (!Array.isArray(obj.frontmatter_tags))
    return { ok: false, error: 'frontmatter_tags not array' };
  if (!Array.isArray(obj.inline_tags)) return { ok: false, error: 'inline_tags not array' };
  if (typeof obj.text !== 'string') return { ok: false, error: 'text not string' };
  if (!Array.isArray(obj.vector)) return { ok: false, error: 'vector not array' };
  if (!obj.vector.every((v: unknown): v is number => typeof v === 'number'))
    return { ok: false, error: 'vector non-numeric' };
  return { ok: true, value: obj as unknown as VectorRow };
}
