# Impl iteration 1 — F10 wiki-ingest-writer

## Summary
Implemented the deterministic ingest writer: `writeIngest({creates, edits, sourceSummaries, runId, ...}, {vault, logger?, now?})` writes page creates → page edits → `sources/` summaries → regenerated `index.md` → appended `log.md` line, in that exact order. Each phase iterates over keys sorted alphabetically. Per-file failures are captured as `{path, message}` errors but the run continues into the next phase. `index.md` is rebuilt from current `wiki/pages/` frontmatter (tags) on every successful WRITING; `log.md` append preserves prior content.

## Files touched
- `src/agent/wiki/ingest/writer.ts` — `writeIngest`, `WriteIngestInput`, `PersistedRawSummary`, `WriterResult`. Helpers: `renderPage`, `renderSource`, `regenerateIndex`, `renderLogLine`, frontmatter parser.

## Tests added or updated
- `tests/unit/wikiIngestWriter.test.ts` — 8 cases covering: full ordering across 5 phases (AC1); page edits sorted by slug, after creates; partial failure leaves prior writes + run continues + error captured (AC2/AC6); index regeneration grouped by tag categories with sorted slugs (AC3); log preserves existing entries (AC4); cancelled-mid-write annotation; error code/message in log line; source-summary frontmatter cites raw_path + sha256 + source_url (AC5).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
None.

## Assumptions
- Per-file atomic write delegated to `VaultAdapter.write` (Obsidian's adapter is the source of atomicity). No tmp-file dance — relies on the platform.
- Index categorisation uses `tags` frontmatter; pages with multiple tags appear under each, sorted within category by slug. `Untagged` bucket for pages with no tags.
- `log.md` entries use `## [<iso>] ingest | created=N edited=N sources=N | runId=<id>` for success; `## [<iso>] cancelled-mid-write | runId=…` for FR-43; `## [<iso>] error | <code>: <msg> | runId=…` for FR-46. F11 supplies the appropriate flags.

## Open questions
None.
