# Compliance iteration 1 — F32 rag-exclude-list

## Acceptance criteria

- AC1: PASS — `matches(path, patterns)` at `src/rag/excludeMatcher.ts:18-25` is a pure function; returns `false` for empty patterns (`:19`); uses minimatch for `**`, `*`, `?`, negation semantics. Asserted by `tests/unit/excludeMatcher.test.ts` 9 cases (empty, exact, `**`, `*`, `?`, multi-pattern, normalize, compile, empty-compile-noop).
- AC2: PASS — `RAGEngine.query` filters rows via `this.excludeMatcher()` at `src/rag/ragEngine.ts:92-98` BEFORE `selectTopK` invokes `cosine`. Asserted by `tests/unit/ragEngine.test.ts` "exclude matcher filters rows before Scorer.cosine — top-K drops excluded path" (only the non-excluded path appears in the result) and "empty exclude matcher returns byte-identical results to baseline" (JSON.stringify equality).
- AC3: PASS — `VaultIndexer.enqueueDirty` at `src/indexer/vaultIndexer.ts:169-173` early-returns when `isExcluded(path)` is true, after the `.md` extension filter; `exclude.indexer.skip` logged at info. Asserted by `tests/unit/vaultIndexer.test.ts` "exclude predicate blocks enqueueDirty for matching paths".
- AC4: DEFERRED — the Obsidian `saveData()` textarea mount in the F03 Indexing section is parked alongside the main.ts runtime wire-up. `ExcludeListStore` exposes the `initial` hydration seam and the `set()` save path that the settings wiring will call; tests assert the normalization semantics (trim / dedupe / empty-drop) on the store directly.
- AC5: PASS — `ExcludeListStore.set(patterns)` fires `excludeList.changed` to subscribers (`src/settings/excludeListStore.ts:38-46`); `VaultIndexer.purgeExcluded(predicate)` removes matching paths from the queue which persists through `DirtyQueue.remove`'s existing debounced atomic-rewrite path. Asserted by `tests/unit/excludeListStore.test.ts` "set() emits subscribers with {current, previous}" and `tests/unit/vaultIndexer.test.ts` "purgeExcluded removes matching paths from the queue".
- AC6: PASS — Empty `excludeGlobs = []` is byte-identical to baseline at both layers: RAG asserted by "empty exclude matcher returns byte-identical results to baseline"; indexer defaults to `isExcluded: () => false` so every pre-F32 test in `vaultIndexer.test.ts` still passes untouched.
- AC7: PASS — Log events `exclude.settings.loaded` (`ExcludeListStore:24`), `exclude.settings.changed` (`:40`), `exclude.rag.filter` at debug (`ragEngine.ts:96`), `exclude.indexer.skip` at info (`vaultIndexer.ts:171`). Counts/booleans only above debug.
- AC8: PASS — Vitest suite enumerated: matcher matrix (9 tests); RAG-side filter behavior (2 tests); indexer-side reject + purge (2 tests); settings-change semantics (4 tests).

## Scope coverage

- In scope "ExcludeMatcher pure module": PASS.
- In scope "ExcludeListStore singleton": PASS.
- In scope "query-time filter injected into RAGEngine": PASS.
- In scope "indexer-time filter injected into VaultIndexer.enqueueDirty after md filter": PASS.
- In scope "settings-change reconciliation via purge + DirtyQueue atomic rewrite": PASS.
- In scope "structured log events": PASS.
- In scope "Vitest coverage": PASS.

## Out-of-scope audit

- Out of scope "full RAG scoring pipeline": CLEAN — only `RAGEngine.query` filter boundary touched.
- Out of scope "graph boosts": CLEAN.
- Out of scope "tag filter / search_vault tool": CLEAN.
- Out of scope "settings-tab scaffold itself": CLEAN — the textarea UI mount is deferred per impl-1.
- Out of scope "status-bar / reindex-on-model-switch UI": CLEAN.
- Out of scope ".canvas exclusions": CLEAN — handled by F27 markdown-only filter which runs before the exclude predicate.

## QA aggregate
Verdict: PASS — typecheck/lint/548-tests/build all green.

## Verdict: PASS (AC4 Obsidian saveData textarea mount parked alongside main.ts runtime wire-up)
