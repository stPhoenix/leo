# Compliance iteration 1 — F28 chunking-metadata

## Acceptance criteria

- AC1: PASS — `chunk(input)` at `src/indexer/chunker.ts:52` is a pure function taking `{path, source, fileCache}` and returning `readonly Chunk[]` with zero IO and no `app.*` references. Determinism asserted by `tests/unit/chunker.test.ts` "returns byte-identical chunks on repeated calls" (JSON.stringify equality on two calls).
- AC2: PASS — `computeSections` at `src/indexer/chunker.ts:89-110` walks headings with an ancestor stack, popping entries with `level >= current.level` before pushing (classic heading-path algorithm). Section endLine = line before next same-or-shallower heading (`:98-102`) or EOF. Asserted by "emits one chunk per heading section with H1 > H2 > H3 ancestry" and "line_start / line_end cover heading line through line before next same-or-shallower heading".
- AC3: PASS — `emitSection` at `src/indexer/chunker.ts:121-131` measures section text with `estimateTokens` and routes to `slideWindows` when > `CHUNK_TARGET_TOKENS`; `slideWindows` at `:133-161` accumulates lines, rewinds by `CHUNK_OVERLAP_TOKENS` whole lines for the next window. Asserted by "oversized section falls back to sliding windows with ~64-token overlap" (verifies window count > 1, shared heading path, ≤~512-token budget, line-boundary overlap) and "all window boundaries are integers and snap to whole lines".
- AC4: PASS — `buildChunk` at `src/indexer/chunker.ts:163-173` constructs the canonical shape `{path, line_start, line_end, heading_path, frontmatter_tags, inline_tags, text}`; `text` = exact `lines.slice(startLine, endLine+1).join('\n')`. Asserted by "every chunk has canonical shape with integer line numbers and exact text".
- AC5: PASS — `normalizeFrontmatterTags` at `src/indexer/chunker.ts:196-212` accepts string or array, falls back to `tag:` key, trims whitespace (trim-then-strip-then-trim to handle `'  #tag'`), dedupes first-seen. All chunks share the snapshot (computed once at `:56` and stored on `SectionInputs`). Asserted by 6 tag-normalization tests (single string, array with dedupe, legacy `tag:`, missing, trim+strip+empties, shared-across-chunks).
- AC6: PASS — `scopedInlineTags` at `src/indexer/chunker.ts:176-194` filters `fileCache.tags` by `[startLine, endLine]` intersection and excludes any tag whose start.line ≤ `frontmatterEnd`. `#` stripped + trim + first-seen dedupe. Asserted by "keeps only tags whose position falls inside the chunk line range", "excludes frontmatter-line tags from inline_tags", "strips leading # and dedupes in first-seen order".
- AC7: PASS — All 18 test cases listed above run under `vitest run` with no vault or network fixture; module imports are limited to `@/agent/tokenCount` (pure).

## Scope coverage

- In scope "pure `Chunker.chunk` with `ChunkerInput = {path, source, fileCache}`": PASS — module IO-free, singleton-free.
- In scope "heading-based default chunking + ancestor chain": PASS.
- In scope "fixed-size overlapping fallback at 512 tokens + 64 overlap + whole-line snapping": PASS.
- In scope "canonical `Chunk` shape per FR-IDX-07": PASS.
- In scope "frontmatter-tag normalization": PASS (string/array/legacy/missing/trim/strip/dedupe/shared).
- In scope "inline-tag extraction scoped to chunk range, frontmatter excluded": PASS.
- In scope "heading-path reconstruction via ancestor stack": PASS.
- In scope "deterministic output ordering": PASS.
- In scope "seam for F27's `processPath` callback": PASS — `chunk(input): readonly Chunk[]` is a drop-in for F27's wire-up.
- In scope "Vitest unit coverage for every enumerated branch": PASS.

## Out-of-scope audit

- Out of scope "embed + IndexedDB upsert": CLEAN — no `EmbeddingClient` / IndexedDB / `idb` references.
- Out of scope "`DirtyQueue` orchestration": CLEAN — no F27 type references.
- Out of scope "graph cache": CLEAN — `resolvedLinks` not read.
- Out of scope "canvas parsing": CLEAN — only markdown source handled.

## QA aggregate
Verdict: PASS — typecheck/lint/485-tests/build all green.

## Verdict: PASS
