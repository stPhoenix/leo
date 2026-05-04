# Impl iteration 1 — F01 wiki-bootstrap

## Summary
Stood up wiki-folder bootstrap path: paths constants, two seed modules, idempotent `bootstrapWiki` that mkdirs the layout, seeds `introduction.md`/`SCHEMA.md`/`index.md`/`log.md`/`wiki-inbox.md` on first run only, and registers `wiki/` with `excludeStore.ensureDefaultPrefix`. Wired call from `main.ts` `onload` after `wireIndexerRag` and before `vaultIndexer.init`. Added `WIKI_DIR_PREFIX` to `dirtyQueue.DROP_PREFIXES`.

## Files touched
- `src/agent/wiki/paths.ts` — wiki path/dir/inbox constants (single source of truth).
- `src/agent/wiki/seed/introduction.ts` — `INTRODUCTION_MD` seed string per FR-03.
- `src/agent/wiki/seed/schema.ts` — `SCHEMA_MD` seed string per FR-04.
- `src/agent/wiki/bootstrap.ts` — `bootstrapWiki()` async entry.
- `src/indexer/dirtyQueue.ts` — added `WIKI_DIR_PREFIX` to `DROP_PREFIXES` (FR-05 intake filter).
- `src/main.ts` — import `bootstrapWiki`, call it in `onload` after wiring indexer, before `vaultIndexer.init`.

## Tests added or updated
- `tests/unit/wikiBootstrap.test.ts` — first-run creates+seeds+registers; second-run idempotent (no overwrite, no re-add); recreates missing dirs without re-seeding; seed-text smoke checks AC7.
- `tests/unit/dirtyQueue.test.ts` — added "drops paths under wiki/ at intake" case (AC4).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
None.

## Assumptions
- `wiki-inbox.md` is seeded with a short header comment so first-run users see the intent. Spec does not mandate inbox content, only existence.
- `wiki/index.md` and `wiki/log.md` seeds carry one-line scaffolding text rather than being literally empty bytes — `index.md` is regenerated on every ingest anyway and `log.md` is append-only; this matches FR-32/FR-38 expectations downstream.

## Open questions
None.
