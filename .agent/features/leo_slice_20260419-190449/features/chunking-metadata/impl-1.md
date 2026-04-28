# Impl iteration 1 — F28 chunking-metadata

## Summary

Added the pure `Chunker` module at `src/indexer/chunker.ts` with a single `chunk({path, source, fileCache})` export returning `readonly Chunk[]`. Heading-based segmentation walks `fileCache.headings`, maintaining an ancestor stack so each emitted chunk carries its full H1→H2→H3 `heading_path: string[]`; section boundaries span from a heading line through the line before the next same-or-shallower heading (or EOF). Zero-heading files collapse to a single whole-body section with empty `heading_path`. Oversized sections (token estimate > `CHUNK_TARGET_TOKENS=512` via `estimateTokens(text) = Math.ceil(text.length/4)` reused from F12 compaction) are split by `slideWindows` — sliding windows that accumulate lines until the 512-token budget is exhausted, then rewind by ~`CHUNK_OVERLAP_TOKENS=64` whole lines for the next window. All `line_start`/`line_end` values are integers (whole-line snapping). Frontmatter tag normalization accepts both `tags:` as string and array plus the legacy `tag:` key, trims whitespace, strips leading `#` after trim, dedupes first-seen. Inline tags from `fileCache.tags` are scoped to `[line_start, line_end]` and exclude anything falling in the `frontmatterPosition` range. Module is IO-free and Obsidian-singleton-free — `CachedMetadataLike` mirrors only the fields consumed.

## Files touched

- `src/indexer/chunker.ts` — new `Chunker` pure module + `Chunk` + `ChunkerInput` + `CachedMetadataLike` / `HeadingCacheLike` / `TagCacheLike` + `CHUNK_TARGET_TOKENS` / `CHUNK_OVERLAP_TOKENS` `as const`.
- `tests/unit/chunker.test.ts` — 18 cases: heading H1/H2/H3 ancestry, line boundary logic, zero-heading whole-body, empty source, oversized fallback window + overlap, integer line invariants, constant values, frontmatter tag normalization (string/array/legacy/missing/trim+strip+dedupe/shared-across-chunks), inline tag scoping (range, frontmatter exclusion, `#` + dedupe), determinism, canonical shape.

## Tests added or updated

- 18 new cases. Full suite: 57 files, 485/485 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Line numbers are 0-based (matching Obsidian's `CachedMetadata.position` convention)** rather than 1-based as the feature description loosely mentions. Obsidian's actual metadataCache uses 0-based line indexes; the AC requires "integers" without pinning a base. Tests are consistent with the 0-based convention; F29 / F31 (which consume chunks) will key on whatever we emit.
- **Token estimator inlined as `estimateTokens(text) + 1`** per line during windowing — the +1 accounts for the newline between joined lines so cumulative window estimate matches `estimateTokens(section.join('\n'))` within ±1.

## Assumptions

- `CachedMetadataLike` is a structural minimum of `app.metadataCache.getFileCache(file)` surface needed; F27 wire-up will pass Obsidian's real `CachedMetadata` which is a superset.
- Tags that span across a chunk boundary (rare edge; would require `start.line < startLine && end.line >= startLine`) fall inside the chunk — the range check is inclusive on both sides.
- `frontmatterPosition` is the authoritative frontmatter boundary; Obsidian provides this when present. When absent, no lines are treated as frontmatter.

## Open questions

- **Heading-path casing / trimming** — feature Open questions flags this; current behavior is `trim()` only (preserves embedded markdown like `*bold*`). Can be revisited once F29 displays `heading_path` in RAG result metadata.
- **Overlap exact token count** — feature Open questions allows tuning `CHUNK_OVERLAP_TOKENS`. Current 64 matches SRS default; constant is `as const` export so a one-line change propagates.
