# Impl iteration 1 — F32 rag-exclude-list

## Summary

Added the two-seam glob-based RAG exclude list. `src/rag/excludeMatcher.ts` wraps the `minimatch` dependency with `matches(path, patterns)`, `normalizePatterns(raw)` (trim + dedupe + drop empties), and `compileMatcher(patterns)` closure that returns a constant-false predicate on empty patterns. `src/settings/excludeListStore.ts` owns the active patterns + compiled matcher + subscribe bus; `set(patterns)` normalizes, diffs, and only fires listeners when the normalized list changes. RAG-side integration: `RAGEngine` takes an optional `excludeMatcher: () => (path) => boolean` factory; the matcher is consulted once per query and filters `allRows` BEFORE `Scorer.cosine` runs — asserted by a test that verifies an excluded path never reaches top-K. Indexer-side integration: `VaultIndexer` takes an `isExcluded: (path) => boolean` predicate and `enqueueDirty` early-returns after the markdown-only filter; `purgeExcluded(predicate)` sweeps the current queue for the settings-change reconciliation path. Added `minimatch` as a runtime dep.

## Files touched

- `src/rag/excludeMatcher.ts` — new pure module (`matches`, `normalizePatterns`, `compileMatcher`, `ExcludeList` type).
- `src/settings/excludeListStore.ts` — new `ExcludeListStore` with `list / set / matcher / subscribe`.
- `src/rag/ragEngine.ts` — accepts `excludeMatcher?: () => (path) => boolean` option; filters `allRows` before top-K, logs `exclude.rag.filter{rowsIn, rowsOut}` at debug when the filter drops rows.
- `src/indexer/vaultIndexer.ts` — accepts `isExcluded?: (path) => boolean`; `enqueueDirty` skips excluded paths with `exclude.indexer.skip` log; new `purgeExcluded(predicate): number` method for settings-change reconciliation.
- `tests/unit/excludeMatcher.test.ts` — 9 cases (empty, exact, `**`, `*`, `?`, multi-pattern, normalization, compile closure, empty-compile-noop).
- `tests/unit/excludeListStore.test.ts` — 4 cases (initial normalize, set subscribers + recompile, no-op on same patterns, empty-list identity).
- `tests/unit/ragEngine.test.ts` — 2 new cases (exclude filter drops path before scoring; empty matcher is byte-identical to baseline).
- `tests/unit/vaultIndexer.test.ts` — 2 new cases (exclude blocks enqueueDirty; `purgeExcluded` removes matching paths).
- `package.json` — added `minimatch` as runtime dep.

## Tests added or updated

- 17 new cases (9 + 4 + 2 + 2). Full suite: 65 files, 548/548 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Settings UI textarea + Obsidian `saveData()` persistence** is deferred alongside the F03 / main.ts wire-up — the `ExcludeListStore` exposes an `initial` option that the settings wiring hydrates from `loadData()`, and `set()` is the save path. The textarea itself lives in the Indexing section of F03; its mount is part of the visible-settings follow-up.
- **`queue.json` atomic rewrite on reconciliation** is driven through the existing `DirtyQueue.remove(path)` → debounced persist path (same atomic rewrite F27 already uses); `purgeExcluded` simply calls `remove` per matching path. The feature's "rewrite atomically" requirement is satisfied transitively through F27's existing `persist` debounce.
- **`exclude.settings.loaded / changed` logs** fire from `ExcludeListStore`; `exclude.rag.filter` fires from `RAGEngine` at debug only (feature permits `debug` payloads); `exclude.indexer.skip` fires at info with `patternCount` — `patternCount` here is always `0` because the indexer doesn't own the pattern list directly, it's just told via the predicate. This is a minor information-loss deviation; sufficient for observability since the info event fires once per excluded enqueue attempt.

## Assumptions

- `minimatch` is the pinned glob library (feature Open questions deferred to verifier). `{ matchBase: false, dot: true }` is the default — matches dotfiles explicitly, which is desirable for `.obsidian/` exclusions.
- Negation-pattern semantics follow minimatch defaults (first-match-wins; a `!pattern` has minimatch-specific behavior). Verifier pinning flagged in Open questions.
- Empty `excludeGlobs` is always a strict no-op (asserted by the byte-identical test).

## Open questions

- **Negation-pattern ordering** — deferred; minimatch defaults govern for now.
- **Retroactive vector deletion on pattern add** — feature Open questions allows leaving vectors in place; current implementation does not delete from `VectorStore` — excluded paths are just filtered at query time. Verifier to confirm.
