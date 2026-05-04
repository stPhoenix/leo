# Compliance iteration 1 — F01 wiki-bootstrap

## Acceptance criteria
- AC1: PASS — `tests/unit/wikiBootstrap.test.ts` "first run creates folders, seeds files, and registers wiki/ in excludeStore" asserts all 4 dirs + 5 seed files.
- AC2: PASS — `tests/unit/wikiBootstrap.test.ts` "second run is idempotent" asserts no overwrite + no extra writes; "recreates missing directories without touching existing seed files" asserts dir-only recreate.
- AC3: PASS — first test asserts `excludeStore.matcher()('wiki/pages/foo.md') === true`; second test asserts `result.excludeRegistered === false` on re-call (`ensureDefaultPrefix` idempotent path in `excludeListStore.ts:60-72`).
- AC4: PASS — `tests/unit/dirtyQueue.test.ts` "drops paths under wiki/ at intake (FR-WIKI-05)" verifies `q.add('wiki/pages/foo.md') === false`.
- AC5: PASS — `bootstrap.ts:43` calls `vault.exists` + `vault.mkdir` only; no FS-specific code. Symlink/sync handling delegated to `VaultAdapter` per feature.md `Implementation notes`.
- AC6: PASS — diff adds no `addCommand`, no `addRibbonIcon`, no settings field, no slash entry. Only files touched at the registration layer are `main.ts` (calling `bootstrapWiki`) and `dirtyQueue.ts` (intake filter).
- AC7: PASS — `INTRODUCTION_MD` (introduction.ts) covers wiki-vs-lifestream, source intake, folder map, agent–user authoring policy (agent owns pages/sources/index, reducer preserves user content compatible with SCHEMA, lint flags drift as info, destructive actions need confirmation). `SCHEMA_MD` covers kebab-case page naming, wikilink form `[[pages/<slug>]]`, citation format, page structure (H1 + Sources H2), Dataview frontmatter (`tags`, `last_updated`, `source_count`), source-summary frontmatter (`source_url`, `fetched_at`, `sha256`, `raw_path`), index conventions. Both originate from compiled-in `src/agent/wiki/seed/{introduction,schema}.ts`. Smoke-asserted in fourth test.

## Scope coverage
- In scope "Ensure `wiki/`, `wiki/raw/`, `wiki/sources/`, `wiki/pages/`, `wiki-inbox.md` exist (FR-01)": PASS — `bootstrap.ts:42-47`.
- In scope "First-run-only seed of `wiki/introduction.md`, `wiki/SCHEMA.md`, `wiki/index.md`, `wiki/log.md` from `src/agent/wiki/seed/{introduction,schema}.ts` (FR-02, FR-03, FR-04)": PASS — `bootstrap.ts:49-58`; existence-gated.
- In scope "Register `wiki/` in `excludeListStore` (FR-05)": PASS — `bootstrap.ts:60` calls `excludeStore.ensureDefaultPrefix(WIKI_DIR_PREFIX)`.
- In scope "Filter `wiki/` at `dirtyQueue` intake (FR-05)": PASS — `dirtyQueue.ts:10` adds `WIKI_DIR_PREFIX` to `DROP_PREFIXES`.
- In scope "Hard-coded folder/inbox names — no settings field (FR-06)": PASS — constants live in `paths.ts`; no settings field touched.

## Out-of-scope audit
- Out of scope "tools, subgraphs, widgets, inbox parsing, search": CLEAN — no `ToolRegistry.register`, no LangGraph subgraph, no React component, no inbox parser, no `search_wiki` added.

## QA aggregate
QA verdict: PASS (typecheck/lint/tests/build all PASS; 2082 unit/dom tests green).

## Integration notes
- `bootstrap.ts` referenced from `src/main.ts:91,878` — primary wiring anchor PASSes §5.3.1.
- `paths.ts` reached transitively from entry via `bootstrap.ts` and `dirtyQueue.ts`; both are themselves wired (`dirtyQueue` is constructed inside `vaultIndexer.ts`, which is wired via `wireIndexerRag` in `main.ts`). Acknowledged best-effort one-hop limitation; no orphan in practice.
- `seed/introduction.ts`, `seed/schema.ts` reached transitively via `bootstrap.ts`; functional reach confirmed by the seed-text smoke test running against the same imports.
- No stub bodies in any new file (§5.3.2): all functions have functional bodies; the three `mkdir`/`write` paths execute real adapter calls.

## Verdict: PASS
