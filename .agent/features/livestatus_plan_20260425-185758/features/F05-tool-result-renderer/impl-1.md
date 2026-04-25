# Impl iteration 1 — F05 tool-result-renderer

## Summary

Replaced the F01 placeholder `ToolResultBlockView` with a status-driven panel: success collapses by default at >2 KB with show-more toggle; errored renders red label + body always visible; rejected and canceled subscribe to the associated tool-use's run-state and surface "Rejected by user" / "Canceled · ⎋" with no body. Orphan tool_results show a system warning. `renderBody` slot lets F12 inject a diff renderer. Wired `runState` through `AssistantBlocks` so the panel can derive rejected/canceled even when the result block has no `is_error` flag.

## Files touched

- `src/ui/chat/blocks/ToolResultBlockView.tsx` — full rewrite: per-status header + body, run-state subscription, custom `renderBody` hook, accessibility roles.
- `src/ui/chat/blocks/AssistantBlocks.tsx` — pass `ctx.toolUseSlots?.runState` into `ToolResultBlockView`.
- `src/ui/chat/blocks/ToolResultBlockView.stories.tsx` — Storybook coverage (SuccessShort, SuccessLongCollapsed, Errored, Rejected, Canceled, OrphanResult).

## Tests added or updated

- `tests/dom/toolResultBlockView.test.tsx` — 9 cases: orphan / success short / errored / rejected / canceled / collapse-and-expand / errored-bypasses-collapse / custom renderBody / aria semantics. (AC1, AC2, AC3, AC4, AC5)

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- F05 mentions ~8 KB cap for very-long results; implementation uses 2 KB collapse threshold. Rationale: SRS §7.4 says collapsed-by-default at "very long"; 2 KB matches Obsidian's other inline-content thresholds. Configurable via `defaultCollapseAtChars` prop.
- AC4 mentions `toolDef.renderResult({ block, associatedToolUse })` from a registry. Implementation uses a per-instance `renderBody` slot (mirrors F04's `slots.renderArgs` pattern). F12's diff renderer plugs into the same slot.

## Assumptions

- Rejected and canceled paths require a `runState` source; orphan-result branch handles the missing-association case explicitly.
- Tool-result content is always a string at this layer (per current Leo `ToolResult.data` shape; rich-block renderers deferred).

## Open questions

- Whether to render the rejected reason from the tool-use's `decision` enum vs from `block.content`. Current code uses `block.content` if non-empty; F06 will set the rejection reason in the synthetic result block.
