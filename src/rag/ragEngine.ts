import type { Logger } from '@/platform/Logger';
import type { EmbeddingClient } from '@/providers/embeddingClient';
import type { VectorRow, VectorStore } from '@/storage/vectorStore';
import { applyBoosts, cosine, DEFAULT_BOOST_WEIGHTS, type BoostWeights } from './scorer';
import { neighbors1h, neighbors2h, type GraphAdjacency } from './GraphTraversal';
import { compileTagPredicate, normalizeTag, normalizeTags } from './tagMatcher';

export const DEFAULT_TOP_K = 10 as const;

export interface RAGHit {
  readonly path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly score: number;
}

export class RAGUnavailableError extends Error {
  override readonly name = 'RAGUnavailableError';
  constructor(public readonly reason: 'header-mismatch' | 'unavailable') {
    super(`rag unavailable: ${reason}`);
  }
}

export interface RAGEngineOptions {
  readonly embedder: EmbeddingClient;
  readonly store: VectorStore;
  readonly logger?: Logger;
  readonly nowMs?: () => number;
  readonly excludeMatcher?: () => (path: string) => boolean;
  readonly graphCache?: GraphAdjacency;
  readonly boostWeights?: BoostWeights;
}

export interface QueryOpts {
  readonly k?: number;
  readonly tags?: readonly string[];
  readonly signal?: AbortSignal;
  readonly activeNotePath?: string;
  readonly activeNoteTags?: readonly string[];
}

export class RAGEngine {
  private readonly embedder: EmbeddingClient;
  private readonly store: VectorStore;
  private readonly logger: Logger | undefined;
  private readonly nowMs: () => number;
  private readonly excludeMatcher: () => (path: string) => boolean;
  private readonly graphCache: GraphAdjacency | null;
  private readonly boostWeights: BoostWeights;

  constructor(opts: RAGEngineOptions) {
    this.embedder = opts.embedder;
    this.store = opts.store;
    this.logger = opts.logger;
    this.nowMs =
      opts.nowMs ??
      ((): number =>
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now());
    this.excludeMatcher = opts.excludeMatcher ?? ((): ((p: string) => boolean) => () => false);
    this.graphCache = opts.graphCache ?? null;
    this.boostWeights = opts.boostWeights ?? DEFAULT_BOOST_WEIGHTS;
  }

  async query(text: string, opts: QueryOpts = {}): Promise<readonly RAGHit[]> {
    const k = opts.k ?? DEFAULT_TOP_K;
    const signal = opts.signal;
    this.logger?.info('rag.query.start', { qLen: text.length, k });
    if (!this.store.isAvailable()) {
      this.logger?.warn('rag.query.unavailable', { reason: 'store-unavailable' });
      return [];
    }
    if (signal?.aborted) throw signalReason(signal);

    const embedStart = this.nowMs();
    let queryVector: readonly number[];
    try {
      const vectors = await this.embedder.embed([text], signal);
      if (vectors.length === 0 || vectors[0] === undefined) return [];
      queryVector = vectors[0];
    } catch (err) {
      if (signal?.aborted) throw signalReason(signal);
      throw err;
    }
    this.logger?.debug('rag.query.embed.ms', { ms: Math.round(this.nowMs() - embedStart) });
    if (queryVector.length === 0) return [];

    const header = await this.store.listHeader();
    if (header !== null && header.dim !== queryVector.length) {
      this.logger?.warn('rag.query.unavailable', {
        reason: 'header-mismatch',
        queryDim: queryVector.length,
        headerDim: header.dim,
      });
      return [];
    }

    if (signal?.aborted) throw signalReason(signal);
    const scanStart = this.nowMs();
    const allRows = await this.store.getAll();
    if (allRows.length === 0) {
      this.logger?.info('rag.query.result', { hits: 0, topScore: 0 });
      return [];
    }
    const excluded = this.excludeMatcher();
    const afterExclude = allRows.filter((r) => !excluded(r.path));
    if (afterExclude.length !== allRows.length) {
      this.logger?.debug('exclude.rag.filter', {
        rowsIn: allRows.length,
        rowsOut: afterExclude.length,
      });
    }
    const requestedTags = opts.tags ?? [];
    const normalisedTags = normalizeTags(requestedTags);
    let rows: readonly VectorRow[] = afterExclude;
    if (normalisedTags.length > 0) {
      const tagPredicate = compileTagPredicate(normalisedTags);
      rows = afterExclude.filter((r) =>
        tagPredicate({ frontmatter: r.frontmatter_tags, inline: r.inline_tags }),
      );
      this.logger?.debug('rag.query.tag-filter', {
        requested: normalisedTags.length,
        kept: rows.length,
        dropped: afterExclude.length - rows.length,
      });
    }
    if (rows.length === 0) {
      this.logger?.info('rag.query.result', { hits: 0, topScore: 0 });
      return [];
    }

    const { scoreFn, counters } = this.buildScoreFunction(queryVector, opts);
    const topK = selectTopK(rows, scoreFn, k, signal);
    this.logger?.info('rag.query.scan.ms', {
      ms: Math.round(this.nowMs() - scanStart),
      rows: rows.length,
    });
    if (counters !== null) {
      this.logger?.debug('rag.boost.applied', {
        rowsBoostedOneHop: counters.oneHop,
        rowsBoostedTwoHop: counters.twoHop,
        rowsBoostedTag: counters.tag,
      });
    }

    const beforeMerge = topK.length;
    const merged = mergeSameFileHits(topK);
    if (merged.length !== beforeMerge) {
      this.logger?.info('rag.query.merge', { before: beforeMerge, after: merged.length });
    }

    this.logger?.info('rag.query.result', {
      hits: merged.length,
      topScore: merged[0]?.score ?? 0,
    });
    this.logger?.debug('rag.query.ms', {
      ms: Math.round(this.nowMs() - embedStart),
      rows: rows.length,
    });
    return merged;
  }

  private buildScoreFunction(
    queryVector: readonly number[],
    opts: QueryOpts,
  ): { scoreFn: (row: VectorRow) => number; counters: BoostCounters | null } {
    const activeNotePath = opts.activeNotePath;
    const activeTagsNormalised = new Set(normalizeTags(opts.activeNoteTags ?? []));
    const weights = this.boostWeights;

    if (activeNotePath === undefined && activeTagsNormalised.size === 0) {
      this.logger?.debug('rag.boost.no-active-note', {});
      return {
        scoreFn: (row): number => cosine(queryVector, row.vector),
        counters: null,
      };
    }

    let oneHop: ReadonlySet<string> = EMPTY_SET;
    let twoHop: ReadonlySet<string> = EMPTY_SET;
    if (activeNotePath !== undefined) {
      if (this.graphCache === null || this.graphCache.size() === 0) {
        this.logger?.info('rag.boost.graph-unavailable', {
          activeTagsSize: activeTagsNormalised.size,
        });
      } else {
        oneHop = neighbors1h(activeNotePath, this.graphCache);
        twoHop = neighbors2h(activeNotePath, this.graphCache);
      }
    }
    this.logger?.debug('rag.boost.start', {
      oneHopSize: oneHop.size,
      twoHopSize: twoHop.size,
      activeTagsSize: activeTagsNormalised.size,
    });

    const counters: BoostCounters = { oneHop: 0, twoHop: 0, tag: 0 };

    const scoreFn = (row: VectorRow): number => {
      const rawScore = cosine(queryVector, row.vector);
      const chunkTags = this.computeChunkTags(row);
      const boosted = applyBoosts({
        rawScore,
        chunkPath: row.path,
        chunkTags,
        oneHop,
        twoHop,
        activeTags: activeTagsNormalised,
        weights,
      });
      if (oneHop.has(row.path)) counters.oneHop += 1;
      else if (twoHop.has(row.path)) counters.twoHop += 1;
      if (activeTagsNormalised.size > 0 && chunkTags.size > 0) {
        for (const tag of chunkTags) {
          if (activeTagsNormalised.has(tag)) {
            counters.tag += 1;
            break;
          }
        }
      }
      return boosted;
    };

    return { scoreFn, counters };
  }

  private computeChunkTags(row: VectorRow): ReadonlySet<string> {
    const out = new Set<string>();
    for (const raw of row.frontmatter_tags ?? []) {
      if (typeof raw !== 'string') continue;
      const norm = normalizeTag(raw);
      if (norm.length > 0) out.add(norm);
    }
    for (const raw of row.inline_tags ?? []) {
      if (typeof raw !== 'string') continue;
      const norm = normalizeTag(raw);
      if (norm.length > 0) out.add(norm);
    }
    return out;
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

interface BoostCounters {
  oneHop: number;
  twoHop: number;
  tag: number;
}

function selectTopK(
  rows: readonly VectorRow[],
  scoreFn: (row: VectorRow) => number,
  k: number,
  signal: AbortSignal | undefined,
): RAGHit[] {
  if (k <= 0) return [];
  const scored: RAGHit[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (signal?.aborted) throw signalReason(signal);
    const row = rows[i]!;
    const score = scoreFn(row);
    const hit: RAGHit = {
      path: row.path,
      line_start: row.line_start,
      line_end: row.line_end,
      score,
    };
    if (scored.length < k) {
      scored.push(hit);
      if (scored.length === k) scored.sort((a, b) => compareHits(b, a));
    } else {
      const weakest = scored[scored.length - 1]!;
      if (score > weakest.score || (score === weakest.score && comparePath(hit, weakest) < 0)) {
        scored[scored.length - 1] = hit;
        scored.sort((a, b) => compareHits(b, a));
      }
    }
  }
  if (scored.length < k) scored.sort((a, b) => compareHits(b, a));
  return scored;
}

function compareHits(a: RAGHit, b: RAGHit): number {
  if (a.score !== b.score) return a.score - b.score;
  return -comparePath(a, b);
}

function comparePath(a: RAGHit, b: RAGHit): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.line_start !== b.line_start) return a.line_start - b.line_start;
  return a.line_end - b.line_end;
}

function mergeSameFileHits(hits: readonly RAGHit[]): RAGHit[] {
  if (hits.length <= 1) return [...hits];
  const byPath = new Map<string, RAGHit[]>();
  for (const h of hits) {
    const arr = byPath.get(h.path);
    if (arr === undefined) byPath.set(h.path, [h]);
    else arr.push(h);
  }
  const merged: RAGHit[] = [];
  for (const [, group] of byPath) {
    if (group.length === 1) {
      merged.push(group[0]!);
      continue;
    }
    const sorted = [...group].sort((a, b) => a.line_start - b.line_start);
    let cur = sorted[0]!;
    for (let i = 1; i < sorted.length; i += 1) {
      const next = sorted[i]!;
      if (next.line_start <= cur.line_end + 1) {
        cur = {
          path: cur.path,
          line_start: Math.min(cur.line_start, next.line_start),
          line_end: Math.max(cur.line_end, next.line_end),
          score: Math.max(cur.score, next.score),
        };
      } else {
        merged.push(cur);
        cur = next;
      }
    }
    merged.push(cur);
  }
  merged.sort((a, b) => b.score - a.score);
  return merged;
}

function signalReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('aborted');
}
