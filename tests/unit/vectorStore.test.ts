import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CorruptIndexError } from '@/storage/vectorStore';
import {
  VECTOR_STORE_DB_NAME,
  VECTOR_STORE_SCHEMA_VERSION,
  VectorStore,
  chunkRowId,
} from '@/storage/vectorStore';
import type { Chunk } from '@/indexer/chunker';
import { openDB } from 'idb';

function mkChunk(path: string, start: number, end: number, text: string): Chunk {
  return {
    path,
    line_start: start,
    line_end: end,
    heading_path: [],
    frontmatter_tags: [],
    inline_tags: [],
    text,
  };
}

function mkVector(n: number, dim = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i < dim; i += 1) out.push(n + i * 0.1);
  return out;
}

async function deleteAll(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(VECTOR_STORE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe('VectorStore — IndexedDB persistence', () => {
  beforeEach(deleteAll);
  afterEach(deleteAll);

  it('upserts chunks with composite-key id and round-trips through getAll', async () => {
    const store = new VectorStore();
    const path = 'a.md';
    const chunks = [mkChunk(path, 0, 5, 'first'), mkChunk(path, 6, 10, 'second')];
    const vectors = [mkVector(1), mkVector(2)];
    const res = await store.upsert(path, chunks, vectors);
    expect(res.ok).toBe(true);
    const rows = await store.getAll();
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.id === chunkRowId(path, 0, 5))?.text).toBe('first');
    expect(rows.find((r) => r.id === chunkRowId(path, 6, 10))?.text).toBe('second');
    store.close();
  });

  it('deleteByPath drops every row with the matching path via by-path index', async () => {
    const store = new VectorStore();
    await store.upsert('a.md', [mkChunk('a.md', 0, 5, 'a')], [mkVector(1)]);
    await store.upsert('b.md', [mkChunk('b.md', 0, 5, 'b')], [mkVector(2)]);
    const del = await store.deleteByPath('a.md');
    expect(del.ok).toBe(true);
    if (del.ok) expect(del.value).toBe(1);
    const remaining = await store.getAll();
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.path).toBe('b.md');
    store.close();
  });

  it('re-upserting the same path evicts prior rows before writing new ones', async () => {
    const store = new VectorStore();
    const path = 'a.md';
    await store.upsert(path, [mkChunk(path, 0, 5, 'v1')], [mkVector(1)]);
    await store.upsert(
      path,
      [mkChunk(path, 0, 5, 'v2'), mkChunk(path, 6, 10, 'extra')],
      [mkVector(3), mkVector(4)],
    );
    const rows = await store.getAll();
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.line_start === 0)?.text).toBe('v2');
    store.close();
  });

  it('writeHeader persists {model, dim, version} and listHeader reads it back', async () => {
    const store = new VectorStore();
    const w = await store.writeHeader({ model: 'text-emb', dim: 768 });
    expect(w.ok).toBe(true);
    const header = await store.listHeader();
    expect(header).toEqual({
      key: 'header',
      model: 'text-emb',
      dim: 768,
      version: VECTOR_STORE_SCHEMA_VERSION,
    });
    store.close();
  });

  it('verify() passes on a fresh + populated DB with matching header dim', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'text-emb', dim: 4 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 5, 'x')], [mkVector(1, 4)]);
    const res = await store.verify();
    expect(res.ok).toBe(true);
    store.close();
  });

  it('verify() returns dim-mismatch when header.dim does not match sampled row', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'text-emb', dim: 8 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 5, 'x')], [mkVector(1, 4)]);
    const res = await store.verify();
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.error as CorruptIndexError).reason).toBe('dim-mismatch');
    expect(store.isAvailable()).toBe(false);
    store.close();
  });

  it('verify() returns version-mismatch when header.version drifts', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'x', dim: 4 });
    // Poison the header with a bad version by opening a raw idb connection
    const db = await openDB(VECTOR_STORE_DB_NAME, VECTOR_STORE_SCHEMA_VERSION);
    await db.put('header', { key: 'header', model: 'x', dim: 4, version: 99 });
    db.close();
    // Force a new store handle
    store.close();
    const store2 = new VectorStore();
    const res = await store2.verify();
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.error as CorruptIndexError).reason).toBe('version-mismatch');
    store2.close();
  });

  it('verify() returns shape-invalid when a sampled row fails validation', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'x', dim: 4 });
    // Poison the vectors store with a malformed row
    const db = await openDB(VECTOR_STORE_DB_NAME, VECTOR_STORE_SCHEMA_VERSION);
    await db.put('vectors', {
      id: 'bad#0-0',
      path: 'bad.md',
      // missing required fields
    } as unknown as never);
    db.close();
    store.close();
    const store2 = new VectorStore();
    const res = await store2.verify();
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.error as CorruptIndexError).reason).toBe('shape-invalid');
    store2.close();
  });

  it('verify() fires a corruption event via subscribe on failure', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 8 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 5, 'x')], [mkVector(1, 4)]);
    const events: Array<{ kind: string; reason: string }> = [];
    const unsub = store.subscribe((e) => events.push(e));
    await store.verify();
    unsub();
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe('corruption');
    store.close();
  });

  it('rebuild() deletes the database, re-creates schema, and restores availability', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 8 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 5, 'x')], [mkVector(1, 4)]);
    await store.verify();
    expect(store.isAvailable()).toBe(false);
    const res = await store.rebuild();
    expect(res.ok).toBe(true);
    expect(store.isAvailable()).toBe(true);
    expect(await store.getAll()).toEqual([]);
    expect(await store.listHeader()).toBeNull();
    store.close();
  });

  it('upsert mismatch between chunks and vectors arrays returns an error', async () => {
    const store = new VectorStore();
    const res = await store.upsert(
      'a.md',
      [mkChunk('a.md', 0, 5, 'x')],
      [mkVector(1), mkVector(2)],
    );
    expect(res.ok).toBe(false);
    store.close();
  });
});
