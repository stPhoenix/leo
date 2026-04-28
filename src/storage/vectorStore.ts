import type { DBSchema, IDBPDatabase } from 'idb';
import { openDB, deleteDB } from 'idb';
import type { Logger } from '@/platform/Logger';
import type { Chunk } from '@/indexer/chunker';

export const VECTOR_STORE_DB_NAME = 'leo-index';
export const VECTOR_STORE_SCHEMA_VERSION = 1 as const;

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

export interface Schema extends DBSchema {
  header: {
    key: string;
    value: IndexHeaderRow;
  };
  vectors: {
    key: string;
    value: VectorRow;
    indexes: { 'by-path': string };
  };
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
  readonly dbName?: string;
  readonly logger?: Logger;
  readonly deleteDatabase?: (name: string) => Promise<void>;
}

export function chunkRowId(path: string, lineStart: number, lineEnd: number): string {
  return `${path}#${lineStart}-${lineEnd}`;
}

export class VectorStore {
  private readonly dbName: string;
  private readonly logger: Logger | undefined;
  private readonly deleteDatabaseImpl: (name: string) => Promise<void>;
  private db: IDBPDatabase<Schema> | null = null;
  private available = true;
  private readonly listeners = new Set<
    (e: { kind: 'corruption'; reason: CorruptionReason }) => void
  >();

  constructor(opts: VectorStoreOptions = {}) {
    this.dbName = opts.dbName ?? VECTOR_STORE_DB_NAME;
    this.logger = opts.logger;
    this.deleteDatabaseImpl = opts.deleteDatabase ?? (async (n) => deleteDB(n));
  }

  async open(): Promise<void> {
    try {
      this.db = await openDB<Schema>(this.dbName, VECTOR_STORE_SCHEMA_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('header')) {
            db.createObjectStore('header', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('vectors')) {
            const store = db.createObjectStore('vectors', { keyPath: 'id' });
            store.createIndex('by-path', 'path');
          }
        },
      });
    } catch (err) {
      this.logger?.error('index.store.open-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
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
      if (this.db === null) await this.open();
      if (this.db === null) throw new CorruptIndexError('open-failed');
      if (
        !this.db.objectStoreNames.contains('header') ||
        !this.db.objectStoreNames.contains('vectors')
      ) {
        throw new CorruptIndexError('missing-store');
      }
      const header = await this.listHeader();
      if (header !== null && header.version !== VECTOR_STORE_SCHEMA_VERSION) {
        throw new CorruptIndexError('version-mismatch');
      }
      const sample = await this.db.transaction('vectors').store.openCursor();
      if (sample !== null) {
        const row = sample.value;
        const shape = validateVectorRow(row);
        if (!shape.ok) throw new CorruptIndexError('shape-invalid');
        if (header !== null && row.vector.length !== header.dim) {
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
    if (this.db === null) await this.open();
    if (this.db === null) return { ok: false, error: new CorruptIndexError('open-failed') };
    try {
      const tx = this.db.transaction('vectors', 'readwrite');
      const store = tx.store;
      const byPath = store.index('by-path');
      let cursor = await byPath.openCursor(IDBKeyRange.only(path));
      while (cursor !== null) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
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
        await store.put(row);
      }
      await tx.done;
      this.logger?.info('index.store.upsert', { path, count: chunks.length });
      return { ok: true, value: undefined };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger?.warn('index.store.upsert-failed', { path, error: error.message });
      return { ok: false, error };
    }
  }

  async deleteByPath(path: string): Promise<Result<number>> {
    if (this.db === null) await this.open();
    if (this.db === null) return { ok: false, error: new CorruptIndexError('open-failed') };
    try {
      const tx = this.db.transaction('vectors', 'readwrite');
      const byPath = tx.store.index('by-path');
      let cursor = await byPath.openCursor(IDBKeyRange.only(path));
      let deleted = 0;
      while (cursor !== null) {
        await cursor.delete();
        deleted += 1;
        cursor = await cursor.continue();
      }
      await tx.done;
      return { ok: true, value: deleted };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  async listHeader(): Promise<IndexHeaderRow | null> {
    if (this.db === null) await this.open();
    if (this.db === null) return null;
    try {
      const row = await this.db.get('header', 'header');
      return row ?? null;
    } catch {
      return null;
    }
  }

  async writeHeader(header: { model: string; dim: number }): Promise<Result<void>> {
    if (this.db === null) await this.open();
    if (this.db === null) return { ok: false, error: new CorruptIndexError('open-failed') };
    try {
      await this.db.put('header', {
        key: 'header',
        model: header.model,
        dim: header.dim,
        version: VECTOR_STORE_SCHEMA_VERSION,
      });
      this.logger?.info('index.store.header.write', { model: header.model, dim: header.dim });
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  async getAll(): Promise<readonly VectorRow[]> {
    if (this.db === null) await this.open();
    if (this.db === null) return [];
    try {
      return await this.db.getAll('vectors');
    } catch {
      return [];
    }
  }

  async rebuild(): Promise<Result<void>> {
    try {
      this.close();
      await this.deleteDatabaseImpl(this.dbName);
      await this.open();
      this.available = true;
      this.logger?.info('index.store.corruption.rebuild', { dbName: this.dbName });
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  close(): void {
    if (this.db === null) return;
    this.db.close();
    this.db = null;
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
