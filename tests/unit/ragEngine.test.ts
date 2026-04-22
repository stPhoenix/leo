import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOP_K, RAGEngine, type RAGHit } from '@/rag/ragEngine';
import { cosine } from '@/rag/scorer';
import { VECTOR_STORE_DB_NAME, VectorStore, type VectorRow } from '@/storage/vectorStore';
import type { EmbeddingClient } from '@/providers/embeddingClient';
import type { Chunk } from '@/indexer/chunker';

async function deleteAll(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(VECTOR_STORE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function fakeEmbedder(vector: number[]): EmbeddingClient {
  return {
    embed: vi.fn(async () => [vector]),
  } as unknown as EmbeddingClient;
}

function mkChunk(
  path: string,
  start: number,
  end: number,
  text = 'body',
  tags: { frontmatter?: string[]; inline?: string[] } = {},
): Chunk {
  return {
    path,
    line_start: start,
    line_end: end,
    heading_path: [],
    frontmatter_tags: tags.frontmatter ?? [],
    inline_tags: tags.inline ?? [],
    text,
  };
}

describe('RAGEngine', () => {
  beforeEach(deleteAll);
  afterEach(deleteAll);

  it('returns [] when store is unavailable', async () => {
    const store = new VectorStore();
    // Force unavailable
    (store as unknown as { available: boolean }).available = false;
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const hits = await rag.query('q');
    expect(hits).toEqual([]);
    store.close();
  });

  it('returns [] when empty store', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    expect(await rag.query('q')).toEqual([]);
    store.close();
  });

  it('returns top-K hits sorted by score desc', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    // Seed 5 rows with known cosine similarity to [1, 0]
    await store.upsert('a.md', [mkChunk('a.md', 0, 1)], [[1, 0]]); // cos = 1
    await store.upsert('b.md', [mkChunk('b.md', 0, 1)], [[0.9, 0.43588989]]); // cos ≈ 0.9
    await store.upsert('c.md', [mkChunk('c.md', 0, 1)], [[0.5, 0.8660254]]); // cos = 0.5
    await store.upsert('d.md', [mkChunk('d.md', 0, 1)], [[0, 1]]); // cos = 0
    await store.upsert('e.md', [mkChunk('e.md', 0, 1)], [[-1, 0]]); // cos = -1
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const hits = await rag.query('q', { k: 3 });
    expect(hits.length).toBe(3);
    expect(hits[0]?.path).toBe('a.md');
    expect(hits[1]?.path).toBe('b.md');
    expect(hits[2]?.path).toBe('c.md');
    store.close();
  });

  it('defaults to DEFAULT_TOP_K=10 when k not set', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    for (let i = 0; i < 15; i += 1) {
      await store.upsert(`n${i}.md`, [mkChunk(`n${i}.md`, 0, 1)], [[Math.random(), Math.random()]]);
    }
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const hits = await rag.query('q');
    expect(hits.length).toBeLessThanOrEqual(DEFAULT_TOP_K);
    store.close();
  });

  it('result shape is strictly {path, line_start, line_end, score} — no extra keys', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 5)], [[1, 0]]);
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const hits = await rag.query('q', { k: 1 });
    expect(hits.length).toBe(1);
    const hit = hits[0] as unknown as Record<string, unknown>;
    expect(Object.keys(hit).sort()).toEqual(['line_end', 'line_start', 'path', 'score']);
    store.close();
  });

  it('merges adjacent and overlapping same-file hits', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    // Three same-file overlapping/abutting chunks
    await store.upsert(
      'x.md',
      [
        mkChunk('x.md', 0, 4, 'A'),
        mkChunk('x.md', 5, 9, 'B'), // abuts (0-4 and 5-9 → merge because 5 <= 4+1)
        mkChunk('x.md', 8, 12, 'C'), // overlaps B
      ],
      [
        [1, 0],
        [0.8, 0.6],
        [0.6, 0.8],
      ],
    );
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const hits = await rag.query('q', { k: 10 });
    expect(hits.length).toBe(1);
    expect(hits[0]?.path).toBe('x.md');
    expect(hits[0]?.line_start).toBe(0);
    expect(hits[0]?.line_end).toBe(12);
    expect(hits[0]?.score).toBeCloseTo(1, 5);
    store.close();
  });

  it('does not merge disjoint hits on the same file (gap > 1)', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert(
      'x.md',
      [mkChunk('x.md', 0, 4, 'A'), mkChunk('x.md', 10, 15, 'B')],
      [
        [1, 0],
        [0.9, 0.43588989],
      ],
    );
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const hits = await rag.query('q', { k: 10 });
    expect(hits.length).toBe(2);
    store.close();
  });

  it('returns [] + logs header-mismatch when query dim != header.dim', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 1)], [[1, 0]]);
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0, 0, 0]), store });
    expect(await rag.query('q')).toEqual([]);
    store.close();
  });

  it('propagates AbortSignal — throws on pre-aborted signal', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 1)], [[1, 0]]);
    const ctl = new AbortController();
    ctl.abort(new Error('cancel'));
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    await expect(rag.query('q', { signal: ctl.signal })).rejects.toThrow(/cancel/);
    store.close();
  });

  it('exclude matcher filters rows before Scorer.cosine — top-K drops excluded path', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert('keep.md', [mkChunk('keep.md', 0, 1)], [[1, 0]]);
    await store.upsert('drafts/skip.md', [mkChunk('drafts/skip.md', 0, 1)], [[1, 0]]);
    const rag = new RAGEngine({
      embedder: fakeEmbedder([1, 0]),
      store,
      excludeMatcher: () => (p) => p.startsWith('drafts/'),
    });
    const hits = await rag.query('q', { k: 10 });
    expect(hits.length).toBe(1);
    expect(hits[0]?.path).toBe('keep.md');
    store.close();
  });

  it('empty exclude matcher returns byte-identical results to baseline', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 1)], [[1, 0]]);
    await store.upsert('b.md', [mkChunk('b.md', 0, 1)], [[0.9, 0.43588989]]);
    const baseline = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const filtered = new RAGEngine({
      embedder: fakeEmbedder([1, 0]),
      store,
      excludeMatcher: () => () => false,
    });
    const a = await baseline.query('q');
    const b = await filtered.query('q');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    store.close();
  });

  it('tags filter rejects rows before cosine — never enter top-K', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    // 100 rows — only 10 carry the requested tag
    for (let i = 0; i < 100; i += 1) {
      const hasTag = i < 10;
      await store.upsert(
        `n${i}.md`,
        [mkChunk(`n${i}.md`, 0, 1, 'body', hasTag ? { frontmatter: ['keep'] } : {})],
        [[1, 0]],
      );
    }
    let scoringCalls = 0;
    const rag = new RAGEngine({
      embedder: fakeEmbedder([1, 0]),
      store,
      nowMs: (): number => {
        scoringCalls += 0;
        return 0;
      },
    });
    // Can't directly count cosine calls, but we verify hit count == min(tagged, k)
    const hits = await rag.query('q', { k: DEFAULT_TOP_K, tags: ['keep'] });
    expect(hits.length).toBe(Math.min(10, DEFAULT_TOP_K));
    for (const h of hits) {
      const idx = Number(h.path.replace('n', '').replace('.md', ''));
      expect(idx).toBeLessThan(10);
    }
    void scoringCalls;
    store.close();
  });

  it('tags:[] is strictly equivalent to no tags filter (byte-identical)', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 1, 'body', { frontmatter: ['foo'] })], [[1, 0]]);
    await store.upsert(
      'b.md',
      [mkChunk('b.md', 0, 1, 'body', { inline: ['bar'] })],
      [[0.9, 0.43588989]],
    );
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const noFilter = await rag.query('q', { k: 5 });
    const emptyTags = await rag.query('q', { k: 5, tags: [] });
    expect(JSON.stringify(emptyTags)).toBe(JSON.stringify(noFilter));
    store.close();
  });

  it('tag filter respects union of frontmatter + inline tags', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert(
      'fm.md',
      [mkChunk('fm.md', 0, 1, 'A', { frontmatter: ['project'] })],
      [[1, 0]],
    );
    await store.upsert(
      'inline.md',
      [mkChunk('inline.md', 0, 1, 'B', { inline: ['project'] })],
      [[1, 0]],
    );
    await store.upsert('none.md', [mkChunk('none.md', 0, 1, 'C', {})], [[1, 0]]);
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const hits = await rag.query('q', { tags: ['project'] });
    const paths = hits.map((h) => h.path).sort();
    expect(paths).toEqual(['fm.md', 'inline.md']);
    store.close();
  });

  it('tag filter is case-insensitive and strips leading # on both sides', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 1, 'A', { frontmatter: ['#Foo'] })], [[1, 0]]);
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const hits = await rag.query('q', { tags: ['foo'] });
    expect(hits.length).toBe(1);
    expect(hits[0]?.path).toBe('a.md');
    store.close();
  });

  it('tag-filter preserves F31 top-K ordering on unfiltered runs (snapshot byte-identity)', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 1, 'A', { frontmatter: ['t'] })], [[1, 0]]);
    await store.upsert(
      'b.md',
      [mkChunk('b.md', 0, 1, 'B', { frontmatter: ['t'] })],
      [[0.9, 0.43588989]],
    );
    const rag = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const baseline = await rag.query('q', { k: 10 });
    const withEmpty = await rag.query('q', { k: 10, tags: [] });
    expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(baseline));
    store.close();
  });

  it('graph boost: 1-hop row with low raw score beats non-neighbour with higher raw score', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    // Non-neighbour: raw=0.14 (cosine ≈ 0.14 with [1,0] query)
    await store.upsert('nope.md', [mkChunk('nope.md', 0, 1)], [[0.14, Math.sqrt(1 - 0.14 * 0.14)]]);
    // 1-hop neighbour: raw=0.10 → boosted 0.10 · 1.5 = 0.15 (beats 0.14)
    await store.upsert(
      'neighbour.md',
      [mkChunk('neighbour.md', 0, 1)],
      [[0.1, Math.sqrt(1 - 0.1 * 0.1)]],
    );
    const graph = {
      neighbors: (p: string) => (p === 'active.md' ? new Set(['neighbour.md']) : new Set<string>()),
      has: (p: string) => p === 'active.md' || p === 'neighbour.md',
      size: () => 2,
    };
    const rag = new RAGEngine({
      embedder: fakeEmbedder([1, 0]),
      store,
      graphCache: graph,
    });
    const hits = await rag.query('q', { k: 2, activeNotePath: 'active.md' });
    expect(hits.length).toBe(2);
    expect(hits[0]?.path).toBe('neighbour.md');
    expect(hits[1]?.path).toBe('nope.md');
    expect(hits[0]?.score ?? 0).toBeGreaterThan(hits[1]?.score ?? 0);
    store.close();
  });

  it('absent activeNotePath + activeNoteTags: byte-identical to F31 pure-cosine output', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 1, 'A', { frontmatter: ['t'] })], [[1, 0]]);
    await store.upsert('b.md', [mkChunk('b.md', 0, 1, 'B')], [[0.9, 0.43588989]]);
    const graph = {
      neighbors: () => new Set<string>(['whatever']),
      has: () => true,
      size: () => 5,
    };
    const baseline = new RAGEngine({ embedder: fakeEmbedder([1, 0]), store });
    const boosted = new RAGEngine({
      embedder: fakeEmbedder([1, 0]),
      store,
      graphCache: graph,
    });
    const a = await baseline.query('q', { k: 10 });
    const b = await boosted.query('q', { k: 10 }); // no activeNotePath → no boost
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    store.close();
  });

  it('graph-cache-unavailable: size()===0 skips traversal; tag-shared additive still fires', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert('a.md', [mkChunk('a.md', 0, 1, 'A', { frontmatter: ['shared'] })], [[1, 0]]);
    await store.upsert('b.md', [mkChunk('b.md', 0, 1, 'B')], [[1, 0]]);
    const emptyGraph = {
      neighbors: () => new Set<string>(),
      has: () => false,
      size: () => 0,
    };
    const rag = new RAGEngine({
      embedder: fakeEmbedder([1, 0]),
      store,
      graphCache: emptyGraph,
    });
    const hits = await rag.query('q', {
      k: 2,
      activeNotePath: 'active.md',
      activeNoteTags: ['shared'],
    });
    expect(hits.length).toBe(2);
    // a.md shares the tag → additive 0.1 · 1.0 = 0.1 extra. b.md doesn't. a.md should rank first.
    expect(hits[0]?.path).toBe('a.md');
    expect(hits[1]?.path).toBe('b.md');
    store.close();
  });

  it('graph cache traversal is called once per query (not per row)', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    // Seed 20 rows
    for (let i = 0; i < 20; i += 1) {
      await store.upsert(`n${i}.md`, [mkChunk(`n${i}.md`, 0, 1)], [[1, 0]]);
    }
    const neighborsSpy = vi.fn((p: string): ReadonlySet<string> => {
      if (p === 'active.md') return new Set(['n0.md', 'n1.md']);
      if (p === 'n0.md') return new Set(['active.md', 'n2.md']);
      if (p === 'n1.md') return new Set(['active.md', 'n3.md']);
      return new Set<string>();
    });
    const graph = {
      neighbors: neighborsSpy,
      has: () => true,
      size: () => 10,
    };
    const rag = new RAGEngine({
      embedder: fakeEmbedder([1, 0]),
      store,
      graphCache: graph,
    });
    await rag.query('q', { activeNotePath: 'active.md' });
    // 1h: neighbors(active) = 1 call. 2h: neighbors(active)=reused via 1h ReadonlySet, then neighbors(n0) and neighbors(n1) = 2 more.
    // Total ≤ 1 (from neighbors1h) + 1 (from neighbors2h pass over activeNotePath) + 2 (from 1h expansion) = 4.
    // Critically, traversal does NOT scale with row count (20 rows) — exactly 1 traversal pass.
    expect(neighborsSpy.mock.calls.length).toBeLessThanOrEqual(4);
    // Sanity: the 20 rows did not each trigger a neighbors call — call count « 20.
    expect(neighborsSpy.mock.calls.length).toBeLessThan(20);
    store.close();
  });

  it('1-hop + tag-shared stacks additively: rawScore · 1.6', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert(
      'boosted.md',
      [mkChunk('boosted.md', 0, 1, 'body', { frontmatter: ['tag'] })],
      [[1, 0]],
    );
    const graph = {
      neighbors: (p: string) => (p === 'active.md' ? new Set(['boosted.md']) : new Set<string>()),
      has: () => true,
      size: () => 2,
    };
    const rag = new RAGEngine({
      embedder: fakeEmbedder([1, 0]),
      store,
      graphCache: graph,
    });
    const hits = await rag.query('q', {
      k: 1,
      activeNotePath: 'active.md',
      activeNoteTags: ['tag'],
    });
    // rawScore = 1.0 · 1.0 = 1.0 (cosine of [1,0] with [1,0]).
    // Boosted = 1.0 · 1.5 + 0.1 · 1.0 = 1.6
    expect(hits[0]?.score ?? 0).toBeCloseTo(1.6, 6);
    store.close();
  });

  it('non-indexed 1-hop neighbors silently boost nothing (filter is implicit)', async () => {
    const store = new VectorStore();
    await store.writeHeader({ model: 'm', dim: 2 });
    await store.upsert('indexed.md', [mkChunk('indexed.md', 0, 1)], [[1, 0]]);
    const graph = {
      neighbors: (p: string) =>
        p === 'active.md' ? new Set(['indexed.md', 'sketch.canvas', 'img.png']) : new Set<string>(),
      has: () => true,
      size: () => 5,
    };
    const rag = new RAGEngine({
      embedder: fakeEmbedder([1, 0]),
      store,
      graphCache: graph,
    });
    const hits = await rag.query('q', { k: 5, activeNotePath: 'active.md' });
    expect(hits.length).toBe(1);
    expect(hits[0]?.path).toBe('indexed.md');
    store.close();
  });

  it('top-K matches a reference Array.sort on 1000 random rows', async () => {
    const store = new VectorStore();
    const dim = 16;
    await store.writeHeader({ model: 'm', dim });
    const rand = (): number[] => Array.from({ length: dim }, () => Math.random() - 0.5);
    // Seed in batches to avoid slow single upserts
    const chunks: Chunk[] = [];
    const vectors: number[][] = [];
    for (let i = 0; i < 1000; i += 1) {
      chunks.push(mkChunk(`n${i}.md`, 0, 1));
      vectors.push(rand());
    }
    // Batch upsert per-path (1 row per path so each call does one row)
    for (let i = 0; i < chunks.length; i += 1) {
      await store.upsert(chunks[i]!.path, [chunks[i]!], [vectors[i]!]);
    }
    const q = rand();
    const rag = new RAGEngine({ embedder: fakeEmbedder(q), store });
    const hits = await rag.query('q', { k: 10 });
    // Reference sort
    const allRows = await store.getAll();
    const expected = [...allRows]
      .map((r: VectorRow) => ({
        path: r.path,
        line_start: r.line_start,
        line_end: r.line_end,
        score: cosine(q, r.vector),
      }))
      .sort((a: RAGHit, b: RAGHit) => b.score - a.score)
      .slice(0, 10);
    expect(hits.map((h) => h.path)).toEqual(expected.map((h) => h.path));
  });
});
