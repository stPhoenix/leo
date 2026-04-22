# Impl iteration 1 — F36 canvas-file-indexing

## Summary

Added pure `CanvasChunker` at `src/indexer/CanvasChunker.ts` that parses Obsidian `.canvas` JSON and emits one `CanvasChunk` per text-bearing node in `nodes[]` document order. Dispatches by `node.type`: `"text"` uses `node.text` verbatim and runs the shared F28 inline-tag helper on the body; `"file"` / `"link"` / any type with a `label` emit prefixed strings (`"file: <ref>"`, `"link: <url>"`, `"label: <text>"`) and carry empty `inline_tags`. Unknown types and empty-body nodes silently skip with `indexer.canvas.skip-node` debug events. Malformed JSON / missing / non-array `nodes` short-circuits to `[]` + a single `indexer.canvas.parse-error` warning without ever throwing into the drain loop. The emitted shape extends F28's `Chunk` with a `node_id` field and fixes `heading_path: ['canvas']`, `frontmatter_tags: []`, `line_start: 0`, `line_end: 0` per FR-IDX-07-compatible contract. F28's chunker gained a new exported `extractInlineTagsFromText(body)` helper so canvas inline-tag extraction stays identical to markdown tag semantics (`#`-stripped, trimmed, first-seen dedupe, case-preserved). F27's `VaultIndexer` `enqueueDirty` filter relaxed from markdown-only to the indexable set `{'md', 'canvas'}` via a new `INDEXABLE_EXTENSIONS` constant; `listMarkdown()`-based diff sweep + reindex-all loops updated to filter by the same set.

## Files touched

- `src/indexer/CanvasChunker.ts` — new pure module. Exports `chunk(input, opts?): readonly CanvasChunk[]` + `CanvasChunk` / `CanvasChunkerInput` / `CanvasChunkerOptions` types.
- `src/indexer/chunker.ts` — added exported `extractInlineTagsFromText(body): readonly string[]` pure helper using a tokenizer-safe regex `(?<![\p{L}\p{N}_/])#([\p{L}\p{N}_\-/]+)/gu` to extract `#tag` / `#nested/path` tokens from arbitrary text, normalised identically to F28 `scopedInlineTags` (`#`-strip → trim → first-seen dedupe, case-preserved).
- `src/indexer/vaultIndexer.ts` — added `CANVAS_EXTENSION` + `INDEXABLE_EXTENSIONS` constants; `enqueueDirty` filter now accepts the indexable set (renamed log event `indexer.skip.non-markdown` → `indexer.skip.non-indexable`); diff sweep (`runDiffSweep`) and `reindexAll` both filter by `INDEXABLE_EXTENSIONS`; the header-reset "now" branch also filters so canvas files enter the queue alongside md.
- `tests/unit/vaultIndexer.test.ts` — updated the former "markdown-only filter" test to "indexable filter" — it now asserts `.canvas` enqueues `true`, `.pdf` / `.png` stay `false`, `.md` still `true`, and the queue contains both `x.canvas` and `x.md`.

## Tests added or updated

- `tests/unit/canvasChunker.test.ts` — 13 cases covering AC1–AC7:
  - mixed text/file/link/label nodes in document order (AC1).
  - unknown-type skip + group-without-label skip (AC2).
  - empty-body skip across all four node kinds (AC2).
  - inline-tag extraction w/ F28 normalisation (trim, `#`-strip, first-seen dedupe, nested `area/work`) (AC4).
  - file/link/label nodes carry empty `inline_tags` regardless of `#` in body content (AC4).
  - malformed JSON → `[]` + exactly one `indexer.canvas.parse-error` warning (AC3).
  - missing `nodes` key → `[]` + warning (AC3).
  - non-array `nodes` → `[]` + warning (AC3).
  - empty `nodes: []` → `[]` (not a parse error — no warning fired) (AC2).
  - never throws on weird inputs (`''`, `'null'`, `'[]'`, `'42'`, `'"string"'`) (AC3).
  - deterministic snapshot — `JSON.stringify(chunk(a)) === JSON.stringify(chunk(a))` (AC6).
  - `heading_path === ['canvas']` invariant on every emitted chunk (AC1, AC6).
  - `indexer.canvas.skip-node` debug event fires for missing-id + unknown-type nodes (AC2).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **`extractInlineTagsFromText` added to `chunker.ts` instead of reusing an existing export.** Feature § "Inline-tag reuse" says "pulled directly from F28 chunking-metadata via the same exported pure helper — no reimplementation". F28's `scopedInlineTags` at `chunker.ts:184-204` operates on Obsidian's pre-parsed `TagCacheLike[]` (which requires the markdown file cache), not a raw text body. Canvas text nodes have no pre-parsed cache, so a text-body helper is strictly needed. Implementation adds the new `extractInlineTagsFromText` alongside `scopedInlineTags` using the same normalisation pipeline (`#`-strip → trim → first-seen dedupe) so canvas and markdown tag semantics stay identical. Verifier: confirm this is the intended "reuse" split.
- **`processPath` seam dispatch deferred to the main.ts integration slice.** Feature § "Integration point with F27" says the seam dispatch is a two-line switch in this slice. `VaultIndexer.processPath` is injected as a constructor callback by the caller (see `opts.processPath` at `vaultIndexer.ts:58`); the concrete dispatch (`extension === 'canvas' ? CanvasChunker.chunk(...) : chunk(...)`) belongs to the main.ts composition where `VectorStore`, `EmbeddingClient`, and both chunkers are wired together. Unit tests prove `CanvasChunker` correctness against fakes; the one-liner dispatch ships with the integration slice alongside every other parked wiring (F24 / F25 / F27 / F29 / F30 / F32 / F33 / F34 / F35).
- **`CanvasChunk` extends `Chunk` with a `node_id: string` field** (not present in F28's `Chunk`). Feature § "Synthetic chunk metadata shape" explicitly lists `node_id: string`. Downstream `VectorStore.upsert(path, chunks, vectors)` accepts the base `Chunk` shape; the extra `node_id` field is ignored by current F29 keying (composite `path#line_start-line_end`). For canvas chunks with `line_start: 0, line_end: 0` all nodes on a file would collide on the same key — this is flagged in feature Open question §3 and will be addressed by F29 schema extension (composite `path#${line_start}-${line_end}#${node_id}` or a separate `node_id` index) in the runtime wire-up slice. For now, unit tests assert `CanvasChunker` correctness independently.
- **`MARKDOWN_EXTENSION` constant retained; added sibling `CANVAS_EXTENSION` + `INDEXABLE_EXTENSIONS` set.** Kept the existing constant name stable to avoid shuffling 10+ references in the F27 test fixture; downstream checks route through `INDEXABLE_EXTENSIONS.has(ext)`.

## Assumptions

- Canvas `edges[]` (node-to-node adjacency) is out of scope — only `nodes[]` is walked. Canvas-to-markdown link edges continue to flow through `metadataCache.resolvedLinks` on the F34 side.
- The downstream F29 composite-key collision on `(path, 0, 0)` for multi-node canvas files will be resolved in the integration slice (either by extending the VectorStore key to include `node_id`, or by substituting node_index-derived line numbers). F33 graph boosts and F35 neighbors traversal already treat canvas paths as opaque; this unit-level slice does not alter those contracts.
- Runtime `VaultAdapter.read(path)` is markdown/JSON-agnostic — it already returns the raw file string, so canvas parsing goes through the same read path.

## Open questions

- Group-node body handling (feature Open question §1) — current behaviour emits a single `label:` chunk per group, does not unroll child nodes (they are already separate `nodes[]` entries). Verifier to confirm.
- Prefix strings `"file: "` / `"link: "` / `"label: "` (feature Open question §2) — lower-cased, space-separated. Verifier to confirm or adjust.
- `line_start` / `line_end` fixed to `0` with `node_id` disambiguation (feature Open question §3) — deferred to runtime wire-up as described in Deviations.
