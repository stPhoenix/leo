# Impl iteration 1 — F31 rag-cosine-search

## Summary

Landed the end-to-end v1 RAG retrieval path. `src/rag/scorer.ts` exposes the pure `cosine(a, b): number` with zero-vector + length-mismatch guards (returns `0`, never `NaN`). `src/rag/ragEngine.ts` owns the `RAGEngine.query(text, {k?, signal?})` surface — embeds the query through F29's `EmbeddingClient.embed([text])`, unwraps `vectors[0]`, guards against dim mismatch vs `listHeader()` (returns `[]` + `rag.query.unavailable{reason:'header-mismatch'}` log), scans the F29 `VectorStore.getAll()` rows in a single pass, and uses an insertion-sort-based `selectTopK` to maintain at most `K` entries (default `DEFAULT_TOP_K=10`). After top-K selection, `mergeSameFileHits` groups by `path`, sorts each group by `line_start`, and merges adjacent-or-overlapping ranges (`next.line_start <= cur.line_end + 1`) with `score = max(a, b)` to honor FR-RAG-07 (no averaging, strongest chunk wins). `AbortSignal` is threaded into both the embedding fetch and the scan loop; pre-abort throws the signal's reason. All result payloads are strictly `{path, line_start, line_end, score}` — no `text` / `chunkId` / `heading_path` leaks.

## Files touched

- `src/rag/scorer.ts` — new pure `cosine` with zero-vector guard.
- `src/rag/ragEngine.ts` — new `RAGEngine` class + `DEFAULT_TOP_K=10` + `RAGUnavailableError` + `selectTopK` + `mergeSameFileHits` + `RAGHit` type.
- `tests/unit/scorer.test.ts` — 6 cases (colinear, orthogonal, anti-parallel, zero-vector guard, length mismatch, monotonic).
- `tests/unit/ragEngine.test.ts` — 10 cases: unavailable store returns [], empty store returns [], top-K sort order, DEFAULT_TOP_K fallback, strict result shape, overlap+abut merge, gap > 1 no-merge, header-mismatch returns [], AbortSignal propagation on pre-abort, 1000-row correctness vs reference `Array.sort`.

## Tests added or updated

- 16 new cases. Full suite: 63 files, 531/531 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Top-K data structure is insertion-sort over a length-capped array**, not a formal min-heap. At K=10 this is `O(N * K)` which is indistinguishable from `O(N log K)` in practice and keeps the code readable. The 1000-row correctness test validates output equivalence with a reference `Array.sort` implementation. A min-heap swap is a drop-in future optimisation behind the same function boundary.
- **10 k-row perf bench is not in the unit suite this iteration.** The feature's Open questions explicitly flagged CI flake risk for `performance.now()`-based asserts on shared runners. The correctness at scale is exercised by the 1000-row reference-sort test (fast, deterministic, no wall-clock gate). A dedicated `pnpm bench` target with the 10 k fixture can land when the indexer UI lines up with real-vault latency measurement.
- **Mid-scan abort** — current implementation checks `signal?.aborted` at the top of `query` and inside `selectTopK`'s hot loop (per-row check). Feature AC7 allows "within one `requestIdleCallback` tick"; since scans are synchronous over in-memory rows, mid-scan abort throws immediately on the next iteration.

## Assumptions

- `EmbeddingClient.embed(['query'])` returns a single-element array; `vectors[0]` is the query embedding. If the provider returns `[]`, `query` returns `[]`.
- `VectorStore.listHeader()` may return `null` if no header is written; in that case the dim-mismatch guard is bypassed (can't compare).
- Caller checks `store.isAvailable()` via the RAG engine's `unavailable` path; no retry or rebuild-nudge logic — that belongs to the F30 / UI tier.

## Open questions

- **10 k-row perf bench** — deferred; feature Open questions flagged flake risk.
- **Score aggregation on merge** — current `max()` matches feature's default reading; SRS verifier may flip to `sum` or `avg` pending F35 (graph boosts) composition experiments.
