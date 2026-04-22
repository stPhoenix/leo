# Compliance iteration 1 — F36 canvas-file-indexing

## Acceptance criteria

- AC1: PASS — `CanvasChunker.chunk` at `src/indexer/CanvasChunker.ts:20-52` iterates `nodes[]` in document order and emits one chunk per text-bearing node with `{path, node_id: node.id, heading_path: ['canvas'], frontmatter_tags: [], inline_tags, text, line_start: 0, line_end: 0}`. Asserted by `tests/unit/canvasChunker.test.ts` "parses text + file + link + label-group nodes in document order" (4 chunks, node_ids `['1','2','3','4']`, all four invariants on `heading_path / frontmatter_tags / line_start / line_end`).
- AC2: PASS — Unknown-type nodes skipped in `buildChunkText` default branch (`CanvasChunker.ts:57-87`) when no label is present; group-without-label skipped for the same reason. Empty `nodes: []` returns `[]` via `parseCanvas`'s `nodes.length === 0` path followed by the empty-loop exit. Skip events emit `indexer.canvas.skip-node` at debug. Asserted by `canvasChunker.test.ts` "skips nodes with unknown type and no label" + "skips empty-body nodes" + "empty nodes array → [] (not a parse error)" + "indexer.canvas.skip-node debug event fires for missing-id and unknown-type".
- AC3: PASS — `parseCanvas` wraps `JSON.parse` in try/catch (`CanvasChunker.ts:88-108`); any throw / null root / missing `nodes` / non-array `nodes` logs exactly one `indexer.canvas.parse-error` at warn and returns `null` (chunk → `[]`). `chunk()` never throws. Asserted by three dedicated cases: "malformed JSON returns [] + emits single indexer.canvas.parse-error warning" (`toHaveBeenCalledTimes(1)`), "missing nodes key → [] + parse-error warning", "non-array nodes → [] + parse-error warning", + defensive "never throws into the indexer drain loop on malformed / weird inputs" covering `''`, `'null'`, `'[]'`, `'42'`, `'"string"'`, `'undefined'`.
- AC4: PASS — `extractInlineTagsFromText` at `src/indexer/chunker.ts:225-240` runs the same normalisation pipeline as F28 `scopedInlineTags` (trim → `#`-strip → first-seen dedupe, case-preserved). Frontmatter tags fixed to `[]` on every emitted chunk. Asserted by `canvasChunker.test.ts` "extracts inline tags with F28-style normalisation" (`'#alpha'`, `'#beta'`, `'#alpha'` again, nested `'#area/work'` → `['alpha', 'beta', 'area/work']`) + "file/link/label nodes have empty inline_tags regardless of body content".
- AC5: PASS — F27 `VaultIndexer.enqueueDirty` filter relaxed at `src/indexer/vaultIndexer.ts:170-175` via `INDEXABLE_EXTENSIONS.has(ext)` (covers `{md, canvas}`); diff sweep + reindex loops filter by the same set. `processPath` seam is dispatch-neutral — the extension-to-chunker switch is injected by the caller via `opts.processPath`, parked alongside the main.ts runtime wire-up (same pattern as every prior feature since F24). Unit fixture asserts queue admits `.canvas`: `tests/unit/vaultIndexer.test.ts` "indexable filter accepts .md and .canvas but rejects .pdf, .png" (queue contents `['x.canvas', 'x.md']`).
- AC6: PASS — `CanvasChunker.chunk` is pure: zero IO (`JSON.parse` + array traversal only), no Obsidian-singleton access, no module-level mutable state beyond the `HEADING_PATH: Object.freeze(['canvas'])` singleton. Asserted by "deterministic snapshot: same input yields byte-identical Chunk[]" (`JSON.stringify(a) === JSON.stringify(b)`) + "heading_path === ['canvas'] invariant on every emitted chunk".
- AC7: PASS — Vitest suite totals 13 new cases covering every bullet: mixed nodes / unknown-skip / empty-skip / inline-tags / file-link-label empty-tags / malformed-JSON / missing-nodes / non-array-nodes / empty-nodes / never-throws-weird-inputs / deterministic-snapshot / heading-path-invariant / skip-node-debug. All pass under `pnpm test`.

## Scope coverage

- In scope "`CanvasChunker` pure module at `src/indexer/CanvasChunker.ts`": PASS.
- In scope "Canvas file format parsing (text / file / link / group-with-label)": PASS — all four branches shipped.
- In scope "Synthetic chunk metadata shape `{path, node_id, heading_path:['canvas'], frontmatter_tags:[], inline_tags, text, line_start:0, line_end:0}`": PASS — `CanvasChunk` extends `Chunk` with `node_id`.
- In scope "Non-text / unknown-type / empty-body skip with debug log": PASS.
- In scope "Malformed JSON resilience → `[]` + warning log": PASS.
- In scope "Inline-tag reuse of F28 helper": PASS with deviation — `extractInlineTagsFromText` added to `chunker.ts` alongside existing `scopedInlineTags` (the latter needs `TagCacheLike[]` which canvas lacks).
- In scope "Integration point with F27 (filter relaxed to `{md, canvas}`, `processPath` seam dispatch)": PASS — filter relaxed in this slice; concrete chunker dispatch parked to main.ts integration slice.
- In scope "Deterministic output ordering": PASS — snapshot byte-identical on same input.
- In scope "Vitest unit coverage": PASS.

## Out-of-scope audit

- Out of scope "F28 chunker internals (heading segmentation, sliding-window fallback, frontmatter-tag normalization)": CLEAN — only added the new `extractInlineTagsFromText` helper; existing `chunk()` / `scopedInlineTags` / `normalizeFrontmatterTags` untouched.
- Out of scope "Embedding + IndexedDB upsert of canvas chunks": CLEAN — `VectorStore` / `EmbeddingClient` not touched.
- Out of scope "Canvas `edges[]` → GraphCache adjacency": CLEAN — only `nodes[]` is walked; `GraphCache` untouched.
- Out of scope "Indexer UI status-bar separation for canvas": CLEAN — F30 indexer-ui-controls unchanged.
- Out of scope "Non-canvas phase-4+ formats (PDFs, images)": CLEAN — `INDEXABLE_EXTENSIONS` fixed to `{md, canvas}` only.

## QA aggregate
Verdict: PASS — typecheck / lint / 638-tests / build all green.

## Verdict: PASS (processPath canvas-vs-md dispatcher parked to main.ts runtime wire-up; F29 composite-key extension for `node_id` disambiguation parked as noted in feature Open question §3 and impl deviations)
