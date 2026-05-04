# Compliance iteration 1 — F16 wiki-lint-scan

## Acceptance criteria
- AC1: PASS — `scanWiki` calls `loadPages(WIKI_PAGES_DIR)` and `loadSources(WIKI_SOURCES_DIR)` only.
- AC2: PASS — `SKIP_PAGE_PATHS` set blocks `index.md` / `log.md` / `introduction.md` / `SCHEMA.md` from page enumeration. Test "cross-linked pages …" asserts none appear in `result.pages`.
- AC3: PASS — `schemaMd` field on result populated once via `vault.read(WIKI_SCHEMA_PATH)`. Test asserts `result.schemaMd === '# schema'`.
- AC4: PASS (with documented deviation per impl-1.md) — `buildAdjacency` produces symmetric back-links from wikilink regex output, mirroring `MetadataCache.resolvedLinks` symmetry. Test verifies `alpha→beta` and `beta→alpha` both present in adjacency.
- AC5: PASS — `orphanRawPaths` filters raw files lacking a `sources/` summary citing them. Test verifies `wiki/raw/2026-04-29-r2.md` flagged orphan; `r1.md` covered by `sources/r1.md` with `raw_path: wiki/raw/2026-04-29-r1.md`.
- AC6: PASS — Synthetic-vault test exercises adjacency + orphan list + missing-directories case.

## Scope coverage
- In scope "Enumerate wiki/pages/ + wiki/sources/ only": PASS.
- In scope "Build wikilink adjacency Map<path, Set<targetPath>>; symmetric merge": PASS.
- In scope "Count inbound + outbound refs per page; identify orphan pages and orphan raw entries": PASS.
- In scope "Pass SCHEMA.md content to checkers as read-only input": PASS — `schemaMd` field on result.
- In scope "Skip index.md, log.md, introduction.md": PASS — SKIP set blocks each.

## Out-of-scope audit
- Out of scope "checker logic (F17)": CLEAN — no checker subagents.
- Out of scope "proposing/writing/UI": CLEAN — pure scan, no IO outside vault read.

## QA aggregate
QA verdict: PASS (typecheck/lint/2244 tests/build all PASS).

## Integration notes
- F16 has no consumer at the entry point yet; F17 (checkers) and F18 (lint subgraph driver) will invoke `scanWiki`. Per §5.3.1, no wiring regex matches in the bullets — scanning/build/identify are domain logic.
- No stub bodies (§5.3.2): every helper has a real body.

## Verdict: PASS
