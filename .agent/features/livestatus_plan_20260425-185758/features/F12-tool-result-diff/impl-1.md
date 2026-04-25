# Impl iteration 1 — F12 tool-result-diff

## Summary

Pure `computeUnifiedDiff(before, after)` (LCS-based, in-house, ~80 LOC, no extra dependency) returns `{ lines, stats }` with `add | del | ctx` kinds + line numbers per side and 3-line context trimming. `DiffView` renders gutter + body, collapses by default at ≥30 changed lines (configurable), shows "no changes" when identical, exposes `diff-toggle` button. Plumbs into `ToolResultBlockView`'s `renderBody` slot for `editNote / createNote / appendToNote` results when callers pass `before` / `after` strings.

## Files touched

- `src/chat/diff.ts` — pure helper.
- `src/ui/chat/blocks/DiffView.tsx` — renderer.
- `src/ui/chat/blocks/index.ts` — re-exports.
- `src/ui/chat/blocks/DiffView.stories.tsx` — Storybook (EditSmall / EditLargeCollapsed / Create / Identical).

## Tests added or updated

- `tests/unit/diff.test.ts` — 6 cases: identical, addition, deletion, replacement, pure addition, context trimming.
- `tests/dom/diffView.test.tsx` — 4 cases: identical-label / small-expanded-by-default / large-collapsed-with-toggle / gutter rendering.

## Addressed gaps from previous iteration

Not applicable.

## Deviations from feature.md

- F12 mentions Myers diff. Implementation uses simpler LCS DP. Same correctness for line-level diffs; bundle delta well under 30 KB.
- F12 says enrich `editNote / createNote / appendToNote` ToolResult.data with `{before, after, bytesWritten, undo}`. Tool surface unchanged in this iteration; the renderer accepts `before` / `after` strings directly. Wiring tool results requires editing the actual tool implementations — deferred (OQ-05 in plan-feature). The component is ready for the wiring.

## Assumptions

- Line-level diff is sufficient (no intra-line word diff).
- Multi-file diffs out of scope.

## Open questions

- Whether the diff computation should be moved to a worker for very large files. Defer; current scales (notes < 100 KB) are fine.
- How to surface `path` and language tinting — `path` rendered in summary; syntax tint deferred.
