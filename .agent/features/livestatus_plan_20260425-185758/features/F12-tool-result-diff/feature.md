# F12 — Tool-result diff renderer

## Purpose

Render file-edit tool results (`editNote`, `createNote`, `appendToNote`) as a unified diff (additions / removals, syntax highlighting) instead of the default monospace box. The single biggest UX upgrade vs. raw text per [`livestatus.md` §7.4](../../../../srs/livestatus.md). Covers [FR-16](../../context.md#functional-requirements), [NFR-01](../../context.md#non-functional-requirements).

## Scope

In scope:
- New component `DiffView` under `src/ui/chat/blocks/DiffView.tsx`.
- New pure helper `computeUnifiedDiff(before: string, after: string, opts?): DiffLine[]` — Myers-based, in-house implementation (no `diff` package — avoid bundle inflation, NFR-01).
- `editNote` / `createNote` / `appendToNote` tool results extended to carry `before` and `after` strings (or `path` + `before` + `after`) in their `data`. For `createNote`, `before === ''`.
- Tool registry registration: each writer tool's `renderResult(ctx)` returns `<DiffView>`.
- Hunk grouping with 3-line context, "+", "-", and " " gutter.
- Optional language hint for syntax highlighting via existing markdown code-block path; fall back to plain monospace if unknown extension.
- Collapse threshold: ≥ 30 changed lines collapses by default with "Show diff (12 +, 18 -)" toggle.
- Keep total bundle delta < 30 KB.

Out of scope:
- Multi-file diffs.
- Word-level intra-line diffs.
- Vault file read for missing `before` — relies on tool returning it (see OQ-05).

## Acceptance criteria

1. `computeUnifiedDiff` is pure: same inputs → same `DiffLine[]`. Vitest covers: identical, one-line changes, multi-hunk, very-long files. (NFR-09 transitive)
2. `DiffView` renders + / − gutter, line numbers per side, syntax-tinted body. (FR-16)
3. `editNote` / `createNote` / `appendToNote` ToolResult contracts updated to include `{ path, before, after, bytesWritten, undo }`; current consumers updated. (FR-16)
4. Bundle delta verified <30 KB via build measurement (esbuild metafile). (NFR-01)
5. Collapse threshold respected; "Show diff (a +, b −)" button reachable by Tab.
6. DOM tests: simple add, simple delete, mixed hunk, identical-file (no diff message), large-file collapse.
7. Storybook covers each variant.

## Dependencies

- Upstream: [F05](../F05-tool-result-renderer/feature.md).
- Touches: new `src/ui/chat/blocks/DiffView.tsx`, new `src/chat/diff.ts`, [`src/tools/builtin/editNote.ts`](../../../../../src/tools/builtin/editNote.ts), [`src/tools/builtin/createNote.ts`](../../../../../src/tools/builtin/createNote.ts), [`src/tools/builtin/appendToNote.ts`](../../../../../src/tools/builtin/appendToNote.ts), [`src/tools/types.ts`](../../../../../src/tools/types.ts) (broaden `ToolResult.data` for these tools).

## Implementation notes

- File-edit diff guidance: see [`livestatus.md` §7.4](../../../../srs/livestatus.md).
- Bundle budget rule: see [`tech-stack.md` § Bundle Budget](../../../../standards/tech-stack.md#bundle-budget).
- Pure-helper rule: see [`architecture.md` §3.3](../../../../architecture/architecture.md#33-domain--core-pure).
- Tool result typing: existing `ToolResult` shape in [`src/tools/types.ts`](../../../../../src/tools/types.ts); broaden via parameterised `TData`.
- React component rules: [`code-style.md` § React 18](../../../../standards/code-style.md#react-18).

## Open questions

- For `editNote`, the current tool (see [`src/tools/builtin/editNote.ts`](../../../../../src/tools/builtin/editNote.ts)) returns `{ ok: true; bytesWritten; undo }` with no pre/post strings. Need to enrich the result with `before` and `after`. Alternative: read vault by path inside `DiffView` (async; complicates renderer). Default plan: enrich tool result. Tracked as [OQ-05](../../context.md#open-questions).
- Whether to ship a generic `RichBlock` content type or keep diff data inside `ToolResult.data`. Default: inside `data` for now; revisit if more rich blocks needed.
