import { describe, expect, it } from 'vitest';
import type { CorruptIndexError } from '@/storage/vectorStore';
import {
  VECTOR_STORE_DEFAULT_BASE_PATH,
  VECTOR_STORE_SCHEMA_VERSION,
  VectorStore,
  chunkRowId,
} from '@/storage/vectorStore';
import type { Chunk } from '@/indexer/chunker';
import { InMemoryVaultAdapter } from '../helpers/inMemoryVaultAdapter';

const INDEX_PATH = `${VECTOR_STORE_DEFAULT_BASE_PATH}/index.json`;

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

function makeStore(): { store: VectorStore; vault: InMemoryVaultAdapter } {
  const vault = new InMemoryVaultAdapter();
  const store = new VectorStore({ vault });
  return { store, vault };
}

describe('VectorStore — vault-file persistence', () => {
  it('upserts chunks with composite-key id and round-trips through getAll', async () => {
    const { store } = makeStore();
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

  it('persists across close + reopen via the same vault adapter', async () => {
    const vault = new InMemoryVaultAdapter();
    const store1 = new VectorStore({ vault });
    await store1.upsert('a.md', [mkChunk('a.md', 0, 5, 'first')], [mkVector(1)]);
    store1.close();
    const store2 = new VectorStore({ vault });
    const rows = await store2.getAll();
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toBe('first');
  });

  it('deleteByPath drops every row with the matching path', async () => {
    const { store } = makeStore();
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
    const { store } = makeStore();
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
    const { store } = makeStore();
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

  it('verify() passes on a fresh + populated store with matching header dim', async () => {
    const { store } = makeStore();
    await store.writeHeader({ model: 'text-emb', dim: 4 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 5, 'x')], [mkVector(1, 4)]);
    const res = await store.verify();
    expect(res.ok).toBe(true);
    store.close();
  });

  it('verify() returns dim-mismatch when header.dim does not match sampled row', async () => {
    const { store } = makeStore();
    await store.writeHeader({ model: 'text-emb', dim: 8 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 5, 'x')], [mkVector(1, 4)]);
    const res = await store.verify();
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.error as CorruptIndexError).reason).toBe('dim-mismatch');
    expect(store.isAvailable()).toBe(false);
    store.close();
  });

  it('verify() returns version-mismatch when on-disk header.version drifts', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write(
      INDEX_PATH,
      JSON.stringify({
        schemaVersion: VECTOR_STORE_SCHEMA_VERSION,
        header: { key: 'header', model: 'x', dim: 4, version: 99 },
        items: [],
      }),
    );
    const store = new VectorStore({ vault });
    const res = await store.verify();
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.error as CorruptIndexError).reason).toBe('version-mismatch');
    store.close();
  });

  it('verify() returns shape-invalid when a sampled row fails validation', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write(
      INDEX_PATH,
      JSON.stringify({
        schemaVersion: VECTOR_STORE_SCHEMA_VERSION,
        header: { key: 'header', model: 'x', dim: 4, version: VECTOR_STORE_SCHEMA_VERSION },
        items: [{ id: 'bad#0-0', path: 'bad.md' }],
      }),
    );
    const store = new VectorStore({ vault });
    const res = await store.verify();
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.error as CorruptIndexError).reason).toBe('shape-invalid');
    store.close();
  });

  it('open() reports open-failed when on-disk JSON is unparseable', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write(INDEX_PATH, '{ this is not json');
    const store = new VectorStore({ vault });
    await expect(store.open()).rejects.toMatchObject({
      name: 'CorruptIndexError',
      reason: 'open-failed',
    });
  });

  it('open() detects orphan tmp file (crash mid-write) as corruption', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write(`${VECTOR_STORE_DEFAULT_BASE_PATH}/index.json.tmp`, '{}');
    const store = new VectorStore({ vault });
    await expect(store.open()).rejects.toMatchObject({
      name: 'CorruptIndexError',
      reason: 'open-failed',
    });
    expect(await vault.exists(`${VECTOR_STORE_DEFAULT_BASE_PATH}/index.json.tmp`)).toBe(false);
  });

  it('verify() fires a corruption event via subscribe on failure', async () => {
    const { store } = makeStore();
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

  it('rebuild() deletes the index file and restores availability', async () => {
    const { store, vault } = makeStore();
    await store.writeHeader({ model: 'm', dim: 8 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 5, 'x')], [mkVector(1, 4)]);
    await store.verify();
    expect(store.isAvailable()).toBe(false);
    const res = await store.rebuild();
    expect(res.ok).toBe(true);
    expect(store.isAvailable()).toBe(true);
    expect(await store.getAll()).toEqual([]);
    expect(await store.listHeader()).toBeNull();
    expect(await vault.exists(INDEX_PATH)).toBe(false);
    store.close();
  });

  it('upsert mismatch between chunks and vectors arrays returns an error', async () => {
    const { store } = makeStore();
    const res = await store.upsert(
      'a.md',
      [mkChunk('a.md', 0, 5, 'x')],
      [mkVector(1), mkVector(2)],
    );
    expect(res.ok).toBe(false);
    store.close();
  });

  it('writes a single index.json under the basePath on flush (no IDB usage)', async () => {
    const { store, vault } = makeStore();
    await store.upsert('a.md', [mkChunk('a.md', 0, 5, 'x')], [mkVector(1)]);
    expect(await vault.exists(INDEX_PATH)).toBe(true);
    expect(await vault.exists(`${VECTOR_STORE_DEFAULT_BASE_PATH}/index.json.tmp`)).toBe(false);
    const raw = JSON.parse(await vault.read(INDEX_PATH));
    expect(raw.schemaVersion).toBe(VECTOR_STORE_SCHEMA_VERSION);
    expect(raw.items.length).toBe(1);
    store.close();
  });
});
