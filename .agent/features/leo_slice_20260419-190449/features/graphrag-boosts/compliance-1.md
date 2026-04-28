# Compliance iteration 1 — F35 graphrag-boosts

## Acceptance criteria

- AC1: PASS — `RAGEngine.buildScoreFunction` at `src/rag/ragEngine.ts:152-177` invokes `neighbors1h(activeNotePath, graphCache)` and `neighbors2h(activeNotePath, graphCache)` exactly once per query (not per row) and captures both sets in the scoring closure at `:179`. `selectTopK` receives this closure and applies `applyBoosts` on every scored row BEFORE the min-heap comparison (`:162-176`). Asserted by `tests/unit/ragEngine.test.ts` "graph cache traversal is called once per query (not per row)" — spy counts ≤ 4 neighbor calls on a 20-row fixture.
- AC2: PASS — `Scorer.applyBoosts` at `src/rag/scorer.ts:39-58` returns `rawScore · 1.5` when `chunkPath ∈ oneHop`, else `rawScore · 1.2` when `chunkPath ∈ twoHop`, else `rawScore · 1.0`; `neighbors2h` at `src/rag/GraphTraversal.ts:19-33` excludes both `activeNotePath` and every 1-hop member from the 2-hop set so no chunk receives the 1.2× multiplier when a 1.5× would also apply. Asserted by `scorer.boost.test.ts` "1-hop beats 2-hop when both present (no compound)" + `graphTraversal.test.ts` "neighbors2h excludes nodes reachable both 1h and 2h (1h wins)" + "neighbors2h excludes the active note itself (self-loop path)".
- AC3: PASS — `applyBoosts` additive delta at `scorer.ts:43-56`: `tagSharedDelta = weights.tagShared - 1` (=0.1 for default 1.1), applied additively on top of the graph multiplier so a 1-hop tag-shared row lands at `rawScore · 1.5 + 0.1 · rawScore = rawScore · 1.6`. Asserted by `scorer.boost.test.ts` "1-hop + tag-shared: rawScore · 1.5 + 0.1 · rawScore = rawScore · 1.6" + `ragEngine.test.ts` "1-hop + tag-shared stacks additively: rawScore · 1.6" (integration end-to-end score equality to 1.6 within 1e-6).
- AC4: PASS — When both `activeNotePath` and `activeNoteTags` are absent, `buildScoreFunction` (`ragEngine.ts:142-149`) returns the bare cosine closure — no boost, no traversal, no tag overlap — so the output is byte-identical to the F31 pure-cosine path. Asserted by `ragEngine.test.ts` "absent activeNotePath + activeNoteTags: byte-identical to F31 pure-cosine output" (JSON.stringify equality against baseline RAGEngine without graphCache).
- AC5: PASS — `buildScoreFunction` at `ragEngine.ts:163-168` detects `graphCache === null || graphCache.size() === 0` and logs `rag.boost.graph-unavailable` at `info` exactly once per query; `oneHop` / `twoHop` stay empty, so the closure collapses to cosine + tag-shared additive when `activeTagsNormalised.size > 0`, else cosine only. No throw. Asserted by `ragEngine.test.ts` "graph-cache-unavailable: size()===0 skips traversal; tag-shared additive still fires".
- AC6: PASS — Boost pass runs before top-K: the score function passed to `selectTopK` already applies `applyBoosts` per row, so the min-heap compares boosted scores. A rawScore = 0.10 1-hop row (boosted to 0.15) wins the top-K slot over a rawScore = 0.14 non-neighbour. Asserted by `ragEngine.test.ts` "graph boost: 1-hop row with low raw score beats non-neighbour with higher raw score" — `hits[0] === 'neighbour.md'`, `hits[1] === 'nope.md'`.
- AC7: PASS — Four structured log events emitted: `rag.boost.start {oneHopSize, twoHopSize, activeTagsSize}` at debug (`ragEngine.ts:173-177`); `rag.boost.applied {rowsBoostedOneHop, rowsBoostedTwoHop, rowsBoostedTag}` at debug (`ragEngine.ts:128-134`); `rag.boost.graph-unavailable {activeTagsSize}` at info (`:164-167`); `rag.boost.no-active-note {}` at debug (`:144`). All counts only — no `activeNotePath` or tag-string payload at any level.
- AC8: PASS — Vitest suite totals 25 new tests: `scorer.boost.test.ts` 11 cases (pure-math matrix + constants + custom weights); `graphTraversal.test.ts` 8 cases (1h / 2h + disjoint + empty + size-zero short-circuit with spy); `ragEngine.test.ts` 6 new cases (1-hop beats non-neighbour, absent-activeNotePath byte-identity, graph-unavailable degrade with tag additive, once-per-query traversal, 1h+tag = rawScore·1.6, non-indexed-neighbour silent-drop).

## Scope coverage

- In scope "Extend `RAGEngine.query(opts)` with `activeNotePath` + `activeNoteTags`": PASS — `ragEngine.ts:33-39`.
- In scope "`GraphTraversal` pure module at `src/rag/GraphTraversal.ts`": PASS — module shipped with `neighbors1h` / `neighbors2h`.
- In scope "`Scorer.applyBoosts` pure function alongside `Scorer.cosine`": PASS — `scorer.ts:39-58`.
- In scope "Default multipliers `GRAPH_BOOST_1H = 1.5` / `GRAPH_BOOST_2H = 1.2` / `TAG_SHARED_BOOST = 1.1` `as const`": PASS — exported from `scorer.ts:20-22`; overridable via `RAGEngineOptions.boostWeights`.
- In scope "Boost pass injected between cosine scoring and min-heap top-K": PASS — `selectTopK` scoreFn composes cosine + applyBoosts, then min-heap runs on boosted scores.
- In scope "Chunk-tag normalisation identical to F33 (`normalizeTag`)": PASS — `computeChunkTags` at `ragEngine.ts:196-213` reuses `normalizeTag`.
- In scope "Neighbor sets computed once per query (not per row)": PASS — closure capture; asserted by AC1 test.
- In scope "Disjoint-set invariant 1-hop vs 2-hop": PASS — `neighbors2h` subtracts 1-hop ∪ {self}.
- In scope "Absent-active-note degrade path (byte-identical to F31)": PASS — AC4.
- In scope "Graph-cache-unavailable degrade path": PASS — AC5.
- In scope "Non-indexed neighbor paths: silent drop via intersection with scored rows": PASS — `ragEngine.test.ts` "non-indexed 1-hop neighbors silently boost nothing".
- In scope "Same-file overlap merge runs after boost + top-K on boosted scores": PASS — `mergeSameFileHits` at `ragEngine.ts:201-229` unchanged; input topK is already boosted.
- In scope "Structured log events via Logger": PASS — counts only, 4 events.
- In scope "Vitest unit coverage": PASS — 25 new tests across 3 suites.

## Out-of-scope audit

- Out of scope "graph cache construction + `metadataCache.on('resolved')` hook": CLEAN — `GraphCache` ownership stays with F34; this feature imports `GraphAdjacency` interface only.
- Out of scope "cosine math + VectorStore scan + min-heap top-K + RAGHit shape + ≤200ms budget": CLEAN — `cosine` and top-K core unchanged; `selectTopK` was refactored to accept a scoreFn but the comparison / merge / ordering rules are byte-preserved (existing F31 tests pass unchanged).
- Out of scope "tags query-time filter + `search_vault` tool": CLEAN — tag-filter (F33) runs BEFORE the boost pass in the pipeline; `search_vault` does not pass `activeNotePath` and therefore stays on the cosine path.

## QA aggregate
Verdict: PASS — typecheck / lint / 625-tests / build all green.

## Verdict: PASS (runtime wire-up — supplying `graphCache` to `RAGEngine` + threading `activeNotePath` / `activeNoteTags` from F08 Focused Context through F10 AgentRunner — parked alongside main.ts integration slice, same pattern as F33)
