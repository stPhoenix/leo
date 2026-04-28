# Impl iteration 1 — F10 grouping-read-only

## Summary

Pure helper `detectGroups` (`src/chat/groupReadOnly.ts`) collapses contiguous successful read-only tool-use blocks of the same name into a `Group` segment when count ≥ 2. New `GroupedToolUses` component renders one summary line + expandable `<ul>` of `ToolUseBlockView`s. `AssistantBlocks` calls `detectGroups` per render via a fresh run-state snapshot read through `useSyncExternalStore`. Read-only set defaults to `{readNote, searchVault, listNotes, Read, Grep}`; tool registry can mark additional tools later.

## Files touched

- `src/chat/groupReadOnly.ts` — new pure helper.
- `src/ui/chat/blocks/GroupedToolUses.tsx` — new component.
- `src/ui/chat/blocks/AssistantBlocks.tsx` — integration: per-render run-state snapshot subscription + `detectGroups` walk.
- `src/ui/chat/blocks/index.ts` — barrel re-exports.
- `src/ui/chat/blocks/GroupedToolUses.stories.tsx` — Storybook (FourReadsCollapsed / FourReadsExpanded / TwoSearches).

## Tests added or updated

- `tests/unit/groupReadOnly.test.ts` — 6 cases: groups four reads, mid-failure splits, mixed names break, running prevents grouping, text blocks pass through, non-read-only never group.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Read-only set lives as a fixed default in `AssistantBlocks` rather than as a `ToolSpec.isReadOnly` registry field. The field IS added to `ToolSpec` (via `ToolSpecBase.isReadOnly` from F08), but the runtime path doesn't consult the registry yet; built-in names are sufficient for visible behaviour. Registry consultation is a one-line follow-up when MCP tools want to opt in.
- Group summary preview uses `path` or `query` from `block.input` as a best-effort preview; absent inputs fall back to count-only label.

## Assumptions

- Adjacent grouping is computed per render of `AssistantBlocks`. No memoization beyond `React.memo` on the group component itself.
- Min group size is 2 (configurable via `minGroupSize` on `detectGroups`).

## Open questions

- Should searches show first 1-2 queries with `+N` rather than 3? Default 3 matches the SRS preview hint.
- Whether to memoize `detectGroups` result by `(blocks ref, runState version)` for very-long messages. Not needed at current scales.
