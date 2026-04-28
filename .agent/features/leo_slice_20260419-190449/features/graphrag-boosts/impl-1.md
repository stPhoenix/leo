# Impl iteration 1 — F35 graphrag-boosts

## Summary

Added `GraphTraversal` pure module at `src/rag/GraphTraversal.ts` (`neighbors1h` / `neighbors2h` over `GraphAdjacency`) and `Scorer.applyBoosts` alongside `cosine` in `src/rag/scorer.ts` with `GRAPH_BOOST_1H = 1.5` / `GRAPH_BOOST_2H = 1.2` / `TAG_SHARED_BOOST = 1.1` `as const` defaults plus an overridable `BoostWeights` record. `RAGEngine` gets new optional `graphCache?: GraphAdjacency` + `boostWeights?` constructor options and new `QueryOpts` fields `activeNotePath?: string` + `activeNoteTags?: readonly string[]`; the query path now builds a single scoring closure via `buildScoreFunction(queryVector, opts)` that computes `oneHop` / `twoHop` once per query (never per row), captures the current `activeTags` normalised set, and hands back both the closure and a counter record. The closure composes `applyBoosts({rawScore: cosine(q, row.vector), ...})` and is passed into the top-K min-heap selector, so boosted rows compete for top-K slots (not post-top-K). Absent `activeNotePath` + no `activeNoteTags` keeps the byte-identical F31 pure-cosine path; `GraphCache.size() === 0` logs `rag.boost.graph-unavailable` and falls through to cosine + tag-shared additive if tags are present. Same-file overlap merge (F31) runs unchanged over the already-boosted top-K scores.

## Files touched

- `src/rag/GraphTraversal.ts` — new pure module. `neighbors1h(path, graph)` direct read-through; `neighbors2h(path, graph)` computes `(⋃ neighbors1h(n) for n ∈ 1h) ∖ (1h ∪ {path})`. Short-circuits on `graph.size() === 0`.
- `src/rag/scorer.ts` — added `applyBoosts(ctx)` pure function + `GRAPH_BOOST_1H/2H` + `TAG_SHARED_BOOST` `as const` literals + `BoostWeights` + `DEFAULT_BOOST_WEIGHTS`. `final = rawScore · graphBoost + (1.1 − 1) · rawScore` when tag-shared (additive-with-graph per FR-RAG-04).
- `src/rag/ragEngine.ts` — new `graphCache?` + `boostWeights?` constructor options; new `activeNotePath?` + `activeNoteTags?` `QueryOpts`; new private `buildScoreFunction(queryVector, opts)` returning `{scoreFn, counters}`; refactored `selectTopK` to accept a `scoreFn: (row) => number` instead of hard-wiring `cosine`. Logs `rag.boost.start` (debug), `rag.boost.applied` (debug, counts only), `rag.boost.graph-unavailable` (info), `rag.boost.no-active-note` (debug).
- `tests/unit/ragEngine.test.ts` — 6 new integration cases cover the boost pipeline.

## Tests added or updated

- `tests/unit/graphTraversal.test.ts` — 8 cases: `neighbors1h` direct / empty-graph / missing-node; `neighbors2h` disjoint from 1h ∪ {self} (line-graph and triangle fixtures), empty-1h short-circuit, `size()===0` short-circuit with `neighbors` spy never called (AC1, AC2).
- `tests/unit/scorer.boost.test.ts` — 11 cases: pure math matrix (no-boost / 1h only / 2h only / 1h+2h → 1h wins / tag only / 1h+tag / 2h+tag / tag disjoint); default constants 1.5/1.2/1.1; custom weights override; rawScore=0 applies cleanly (AC2, AC3).
- `tests/unit/ragEngine.test.ts` — 6 new integration cases:
  - 1-hop low-score (rawScore 0.10) beats non-neighbour (rawScore 0.14) in top-K ordering (AC6).
  - Absent `activeNotePath` + no `activeNoteTags` is byte-identical to F31 pure-cosine (AC4 snapshot equality).
  - `GraphCache.size()===0` skips traversal; tag-shared additive still fires when `activeNoteTags` present (AC5).
  - Graph traversal invoked `≤ 4` times per query regardless of row count (20 rows → ≤ 4 `neighbors` calls, proving single-traversal-per-query) (AC1).
  - 1-hop + tag-shared stacks to `rawScore · 1.6` exactly (AC3).
  - Non-indexed 1-hop neighbors (`.canvas`, `.png`) silently boost nothing because they never match a scored row (feature Open question §2 contract).

Total new tests this feature: 25.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **`rag.boost.graph-unavailable` at `info` level, others at `debug`.** Feature text pins neither. Graph-unavailable is a degraded-mode signal worth surfacing in logs without debug flags; `start` / `applied` / `no-active-note` are per-query high-volume counters better kept at debug. Counts only — no path or tag strings — per NFR-LOG-04.
- **`BoostWeights` accepts `tagShared` as a multiplier (1.1) not an additive (0.1) constant.** Feature § "Default multipliers" defines `TAG_SHARED_BOOST = 1.1 as const` and notes "delta encoded as `TAG_SHARED_BOOST − 1 = 0.1`". Implementation stores the multiplier literal and computes the additive delta at apply time (`weights.tagShared - 1`), matching the feature's own note. Verifier to confirm this is the intended encoding vs storing `0.1` directly.

## Assumptions

- Chunk-tag normalisation for the boost pass reuses `normalizeTag` / `normalizeTags` from F33's `TagMatcher` (case-insensitive, `#`-strip, trim), matching the F33 tag-filter contract so "same tag" semantics agree between filter and boost.
- The active note's own path is excluded from `oneHop` / `twoHop` by construction of `neighbors2h` (subtracts `{activeNotePath}` from the 2-hop set); the active note's own chunks therefore receive no graph multiplier but can still receive the tag-shared additive because the active note's tags trivially overlap with its own chunks' tags. Feature Open question §3 parked for verifier review.
- `search_vault` (F33) does not pass `activeNotePath` (its call path is `ragEngine.query(text, {tags: args.tags, signal})`), so the boost pass stays tool-agnostic; only the chat turn path (F10 AgentRunner) will supply `activeNotePath`. This honours the feature's "non-chat callers remain unaffected" clause.
- Runtime wire-up (`new RAGEngine({embedder, store, graphCache: cache, ...})` in `Plugin.onload`, plus F10 `AgentRunner` passing `activeNotePath` + `activeNoteTags` from `Focused Context`) is part of the main.ts integration slice.

## Open questions

- Active note's own chunks boost semantics (feature Open question §3) — current behaviour: cosine + tag-shared additive only, no graph multiplier. Verifier to confirm.
- Non-indexed 1-hop neighbor debug log (feature Open question §2) — current behaviour is silent-drop via intersection-with-scored-rows. Deferred.
- Tag-shared multiplier vs additive encoding (feature Open question §1) — current encoding is `final = rawScore · graphBoost + (tagShared − 1) · rawScore`, so a standalone tag-shared row lands at `rawScore · 1.1` and a 1-hop tag-shared row lands at `rawScore · 1.6`. Verifier to confirm.
