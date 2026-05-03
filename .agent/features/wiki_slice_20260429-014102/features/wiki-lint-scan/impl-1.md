# Impl iteration 1 — F16 wiki-lint-scan

## Summary
Built the lint SCANNING phase as a pure module: `scanWiki(deps): LintScanResult`. Enumerates only `wiki/pages/` and `wiki/sources/`, reads each page body, builds wikilink adjacency (with symmetric back-link merge), counts inbound refs, identifies orphan pages and orphan raw entries (raw files with no `sources/` summary citing `raw_path`), and surfaces `SCHEMA.md` content for downstream checkers.

## Files touched
- `src/agent/wiki/lint/scan.ts` — `scanWiki`, `LintScanResult`, `PageNode`, `SourceNode`. Module is pure-ish: every IO call is on the injected `VaultAdapter`.

## Tests added or updated
- `tests/unit/wikiLintScan.test.ts` — happy-path scenario with two cross-linked pages + one orphan + one orphan raw + one source-summary. Verifies enumeration excludes `index.md`/`log.md`/`introduction.md` (AC2), schema is read once (AC3), adjacency is symmetric (AC4), orphans detected (AC5+AC6), and missing-directories case returns empty result.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- AC4 says "symmetric merge of `MetadataCache.resolvedLinks` forward + back-links". `scanWiki` re-builds adjacency from page bodies via the wikilink regex rather than calling `MetadataCache.resolvedLinks` directly. The reason: F16 is unit-testable without an Obsidian app instance per code-style.md `Testing`; depending on `MetadataCache` would require harnessing `app.metadataCache` mocks. The wikilink regex output matches `resolvedLinks` for the canonical `[[pages/<slug>]]` shape SCHEMA.md prescribes; symmetric merge is performed in-module. Future enhancement: when an Obsidian app is available, `scanWiki` can accept an optional `metadataCache` source and prefer its resolution over the regex pass.

## Assumptions
- Skip set is `WIKI_INDEX_PATH`, `WIKI_LOG_PATH`, `WIKI_INTRODUCTION_PATH`, `WIKI_SCHEMA_PATH`. Per spec these are excluded from lint surface (or read-only input in SCHEMA's case).
- Orphan-raw detection uses `sources/<x>.md` frontmatter `raw_path` field. Source files lacking this field don't cover their raw entries.

## Open questions
None.
