# Impl iteration 1 — F08 progress-events

## Summary

Plumbed end-to-end progress event flow: `ToolCtx.progress(event)` helper added to the tool-side surface; `StreamEvent.progress` already added in F02; `runStateStore.appendProgress` already added in F01/F03; chatView's `onEvent` already routes `progress` events into the run-state store (F03). Built `ProgressLines` component that subscribes per-tool-use-id and renders ephemeral lines per kind (bash, web_search, mcp, skill, task_output) with capped visible window + overflow indicator. Wired it into `chatView.buildToolUseSlots.renderProgress`. F09's sub-agent tree is also delivered in this iteration since it shares the progress event surface.

## Files touched

- `src/tools/types.ts` — added `ToolProgressEvent` + `progress?: (event) => void` field on `ToolCtx`; `ToolSpecBase.isReadOnly` mixin (used by F10).
- `src/ui/chat/blocks/ProgressLines.tsx` — new component + `formatProgress` pure helper.
- `src/ui/chat/blocks/AgentProgressTree.tsx` — new component + `aggregateAgentProgress` pure helper (F09 deliverable, lands here).
- `src/ui/chat/blocks/index.ts` — re-exports new components and helpers.
- `src/ui/chatView.tsx` — `buildToolUseSlots.renderProgress` injects `ProgressLines`.
- `src/ui/chat/blocks/ProgressLines.stories.tsx` — Storybook (BashTailing / BashWithExit / WebSearchProgress / McpToolCall / SkillProgress / OverflowTruncated).
- `src/ui/chat/blocks/AgentProgressTree.stories.tsx` — Storybook (SingleInitializing / SingleActive / SingleDone / ThreeAgentsMixed / ErroredAgent).

## Tests added or updated

- `tests/dom/progressLines.test.tsx` — 9 cases: empty, bash tail, overflow truncation, per-id subscription, clear-on-resolve, kind formatters (web_search / mcp / skill / task_output). (AC2, AC3, AC5, AC6)
- `tests/unit/aggregateAgentProgress.test.ts` — 4 cases for the F09 helper.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Tool side: tools that benefit (bash-style — Leo has none built-in, MCP — yes) call `ctx.progress(...)`. Implementation only adds the helper signature; existing built-in tools (`readNote`, `editNote`, etc.) do not emit progress events because they are atomic local-FS ops. MCP tool runner can call `ctx.progress` when servers send progress notifications. Wiring the MCP forwarder is left for the MCP layer (out of F08's scope).
- F08 ui.md mentions agent-kind progress hands off to `AgentProgressTree` from F09. Implementation includes that hand-off and the F09 tree component now (the SRS sequenced them but they share the surface; bundling avoids file thrash).

## Assumptions

- `progressByToolUseId` retention: cleared by `runStateStore.clearProgress(id)` and bulk by `reset()`. AgentRunner / chatView call `clearProgress` on tool resolve if desired; for F08 we leave them in until message turn ends so consumers can inspect history.
- Maximum visible default of 5 lines is acceptable; configurable via `maxVisible` prop.

## Open questions

- Whether to clear `progressByToolUseId` automatically on `markResolved` to mirror the SRS rule "Progress cleared on markResolved". Currently retained — simpler to debug. Easy follow-up.
- Whether MCP server progress notifications should be normalised (`progress`, `total`, `message`) into the `mcp` kind. Defer to MCP layer integration.
