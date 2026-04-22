# Compliance iteration 1 — F31 rag-cosine-search

## Acceptance criteria

- AC1: PASS — `RAGEngine.query(text, opts?)` at `src/rag/ragEngine.ts:47` embeds via `this.embedder.embed([text], signal)` (`:64`), scans `this.store.getAll()` (`:87`), and returns at most `k` entries via `selectTopK` (`:93`) sorted desc. Asserted by `tests/unit/ragEngine.test.ts` "returns top-K hits sorted by score desc".
- AC2: PASS — `cosine(a, b)` at `src/rag/scorer.ts:1-17` returns `1` for colinear, `0` for orthogonal, guards against zero-vector (`:13-14`) and length mismatch. Asserted by `tests/unit/scorer.test.ts` "returns 1 for colinear vectors", "returns 0 for orthogonal vectors", "guards against zero-vector inputs".
- AC3: PASS — `DEFAULT_TOP_K = 10 as const` at `src/rag/ragEngine.ts:8`; `query` defaults when `opts.k === undefined` (`:49`). Result shape strictly `{path, line_start, line_end, score}` — the `RAGHit` type contains exactly these fields and `selectTopK` emits via object literal with only those keys. Asserted by "defaults to DEFAULT_TOP_K=10 when k not set" and "result shape is strictly {path, line_start, line_end, score}".
- AC4: PASS — `mergeSameFileHits` at `src/rag/ragEngine.ts:150-175` groups by path, sorts by `line_start`, merges on `next.line_start <= cur.line_end + 1`, takes `min/max` for range and `max` for score. Asserted by "merges adjacent and overlapping same-file hits" (abut + overlap) and "does not merge disjoint hits on the same file (gap > 1)".
- AC5: DEFERRED — 10 k-row perf bench intentionally parked to a dedicated `pnpm bench` target per feature Open questions (CI flake risk flagged). Correctness-at-scale is exercised by the 1000-row reference-sort parity test "top-K matches a reference Array.sort on 1000 random rows". This gap is covered by impl-1 deviation note.
- AC6: PASS — Store unavailable path returns `[]` with `rag.query.unavailable{reason:'store-unavailable'}` log (`src/rag/ragEngine.ts:51-54`); empty store returns `[]` (`:89-90`); header dim mismatch returns `[]` with `rag.query.unavailable{reason:'header-mismatch'}` log (`:78-84`). Asserted by "returns [] when store is unavailable", "returns [] when empty store", "returns [] + logs header-mismatch when query dim != header.dim".
- AC7: PASS — `AbortSignal` threaded via `this.embedder.embed([text], signal)` (`:64`) and checked at `:60`, `:69`, `:85`, inside `selectTopK` per-row (`:123`). Asserted by "propagates AbortSignal — throws on pre-aborted signal".
- AC8: PASS — Vitest suite enumerated: pure-math cases (6 scorer tests), top-K correctness vs reference sort on 1000 random rows, overlap-merge matrix (abut, overlap, identical in the three-chunk test + disjoint-no-merge), AbortSignal propagation, header-mismatch unavailable path.

## Scope coverage

- In scope "`RAGEngine.query(text, {k?, signal?}): Promise<RAGHit[]>`": PASS — exact signature exported.
- In scope "query-embedding via F29 EmbeddingClient single-item batch": PASS.
- In scope "linear-scan cosine similarity via pure Scorer": PASS.
- In scope "top-K selection with size-k cap": PASS — insertion-sort alternative to min-heap (deviation noted).
- In scope "same-file overlap merge with max-score aggregation": PASS.
- In scope "result payload strictly {path, line_start, line_end, score}": PASS.
- In scope "unavailable-state handling (store unavailable or dim mismatch)": PASS.
- In scope "performance envelope ≤200ms on 10k rows": DEFERRED to `pnpm bench` target (feature Open questions flagged flake risk).
- In scope "structured log events rag.query.*": PASS (`start/embed.ms/scan.ms/result/unavailable/merge/ms`).
- In scope "Vitest unit coverage": PASS.

## Out-of-scope audit

- Out of scope "exclude-list glob filtering": CLEAN — no glob logic.
- Out of scope "tag filter + search_vault tool": CLEAN.
- Out of scope "graph boosts (1.5× / 1.2× / 1.1×)": CLEAN — only raw cosine.
- Out of scope "HNSW swap": CLEAN — linear-scan only.

## QA aggregate
Verdict: PASS — typecheck/lint/531-tests/build all green.

## Verdict: PASS (AC5 perf bench explicitly parked to a `pnpm bench` target per feature Open questions)
