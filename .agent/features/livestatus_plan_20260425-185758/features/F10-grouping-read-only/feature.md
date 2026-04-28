# F10 — Grouping for read-only tools

## Purpose

Collapse adjacent successful read-only tool-use blocks (e.g. multiple `readNote` or `searchVault`) within the same assistant message into a single expandable summary ("Read 4 files ▸"). Reduces visual noise once a turn is settled. Covers [FR-15](../../context.md#functional-requirements), [NFR-04](../../context.md#non-functional-requirements).

## Scope

In scope:
- New pure helper `detectGroups(blocks: ContentBlock[], runState: RunState): GroupingPlan` returning a sequence of `Single | Group` segments.
- Grouping rule: contiguous run of `tool_use` blocks where `(a)` `toolDef.isReadOnly === true`, `(b)` every block resolved successfully (`statusOf === 'success'`), `(c)` same `name`. Mixed names break the run.
- Never group running / errored / rejected / canceled. A non-success status in the middle splits the run.
- New component `GroupedToolUses` rendering the summary and on-expand the underlying `ToolUseBlockView` list.
- `AssistantBlocks` (from F01) calls `detectGroups` and renders groups via `GroupedToolUses` instead of individual blocks.
- Groups remember user-expansion state via local component state (not persisted).
- Pre-condition: `ToolDef.isReadOnly` field must be populated for built-in read tools (`readNote`, `searchVault`, `listNotes`).

Out of scope:
- Cross-message grouping (only within a single assistant message).
- Group-level diff or summary statistics beyond count and tool name.

## Acceptance criteria

1. `detectGroups` is pure, deterministic, exhaustive over the block list. Vitest covers: all-success grouping, mid-failure split, mixed-name split, single-block fallback, no-tool-use sequence. (FR-15, NFR-09)
2. `GroupedToolUses` renders one summary line: `<icon> Read N files ▸`, expandable to a list of the wrapped `ToolUseBlockView`s. (FR-15)
3. Default state: collapsed when group count ≥ 2; toggle to expand. (FR-15)
4. While *any* member is still running, grouping is suspended (members render individually). Re-evaluated on every render via `detectGroups`. (FR-15)
5. Memoised: `detectGroups` result cached by `(blocks ref, runState version)`. Per-group component memoised. (NFR-04)
6. Aria: summary is `<button aria-expanded>`; expanded list inside `<ul>` for screen readers.
7. `ToolDef.isReadOnly` set on `readNote`, `searchVault`, `listNotes` (matching existing built-ins). MCP tools default to `false` until tagged.
8. Storybook covers: 4 reads grouped, 4 reads with one error (split), running mid-group (no grouping), expanded view.

## Dependencies

- Upstream: [F04](../F04-tool-use-renderer/feature.md), [F05](../F05-tool-result-renderer/feature.md), [F03](../F03-run-state-store/feature.md).
- Touches: new `src/ui/chat/blocks/GroupedToolUses.tsx`, new pure `src/chat/groupReadOnly.ts`, [`src/tools/builtin/readNote.ts`](../../../../../src/tools/builtin/readNote.ts), [`src/tools/builtin/searchVault.ts`](../../../../../src/tools/builtin/searchVault.ts), [`src/tools/builtin/listNotes.ts`](../../../../../src/tools/builtin/listNotes.ts) (add `isReadOnly`), [`src/tools/types.ts`](../../../../../src/tools/types.ts) (add `isReadOnly?: boolean` to `ToolSpec`).

## Implementation notes

- Grouping rules and collapsibility constraints: see [`livestatus.md` §7.3 Grouping](../../../../srs/livestatus.md).
- Pure-core domain placement: [`architecture.md` §3.3](../../../../architecture/architecture.md#33-domain--core-pure).
- Tool registry contract: see [`livestatus.md` §6](../../../../srs/livestatus.md) for `isReadOnly`.
- Existing built-in tools: see structure in [`project-structure.md`](../../../../standards/project-structure.md) under `src/tools/builtin/`.

## Open questions

- Should the group summary preview the file paths read (e.g. `Read 4 files: README.md, foo.md, bar.md, +1`)? Default: yes — extract path from each `block.input.path` when defined; degrade gracefully when not.
- Should `searchVault` grouping include the queries? Default: yes, comma-joined first-2 + count.
