# F08 — Progress events plumbing

## Purpose

Add ephemeral progress events to the stream: tools (bash, web_search, MCP, agent, skill, task_output) push mid-execution updates that surface as throwaway lines under their tool-use block. Not persisted. Covers [FR-13](../../context.md#functional-requirements), [NFR-09](../../context.md#non-functional-requirements), [NFR-10](../../context.md#non-functional-requirements).

## Scope

In scope:
- New `ProgressEvent` tagged union (kinds: `bash | web_search | task_output | mcp | agent | skill`) defined in `src/agent/streamEvents.ts`.
- New `StreamEvent` variant `progress` carrying a `ProgressEvent`.
- `StreamingTurnController` routes `progress` to `runStateStore.appendProgress(toolUseId, event)`. No message-store mutation.
- `ToolCtx.progress(event: ProgressEvent)` helper added to the existing tool ctx in [`src/tools/types.ts`](../../../../../src/tools/types.ts) (next to `signal`, `vault`, `editor`, `logger`). Tools call this; runner forwards to the stream's event channel.
- New component `ProgressLines` mounted inside `ToolUseBlockView`'s progress slot. Subscribes to `runStateStore.subscribeToolUse(id)`.
- Per-kind line formatting:
  - `bash` → tail of stdout/stderr, optional exitCode pill
  - `web_search` → `query · {resultsSoFar} results`
  - `task_output` → `{taskId} · {status}`
  - `mcp` → `{serverName}.{methodCall}`
  - `agent` → handed to F09 (sub-agent tree)
  - `skill` → `{skillName} · {status}`
- Progress cleared on `markResolved | markRejected | markCanceled` via store mutator.
- No persistence ever.

Out of scope:
- Sub-agent tree shape — F09.
- Live indicator — F11.

## Acceptance criteria

1. `ProgressEvent` union shape matches [`livestatus.md` §5](../../../../srs/livestatus.md). (FR-13)
2. `StreamingTurnController.consume({type:'progress', event})` calls `runStateStore.appendProgress(event.toolUseId, event)`. Message store never sees this event. (FR-13, NFR-09)
3. Built-in tools that benefit (bash-style — n/a in Leo built-ins; MCP tools — yes) call `ctx.progress(...)` at meaningful checkpoints. (FR-13)
4. `MCPClient` adapter forwards MCP server progress notifications to `ctx.progress({kind:'mcp', …})`. (FR-13)
5. `ProgressLines` renders at most N=5 latest lines (older ones truncated with "…+K more"). Each line memoised. (NFR-04 transitive, FR-13)
6. Progress entries are dropped from `runStateStore` once the tool resolves; the rendered slot becomes empty. (FR-13)
7. Logger entry on `progress` kind = `agent` for sub-agent observability. (NFR-10)
8. Storybook: `ProgressLines.stories.tsx` covers each kind + truncation + cleared-on-resolve transition.

## Dependencies

- Upstream: [F03](../F03-run-state-store/feature.md), [F04](../F04-tool-use-renderer/feature.md), [F02](../F02-stream-aggregator/feature.md) (event union extension).
- Touches: [`src/agent/streamEvents.ts`](../../../../../src/agent/streamEvents.ts), [`src/chat/streamingController.ts`](../../../../../src/chat/streamingController.ts), [`src/tools/types.ts`](../../../../../src/tools/types.ts), [`src/mcp/mcpClient.ts`](../../../../../src/mcp/mcpClient.ts), new `src/ui/chat/blocks/ProgressLines.tsx`.
- Downstream: F09 (consumes `agent` kind).

## Implementation notes

- Schema and per-kind shape: see [`livestatus.md` §5](../../../../srs/livestatus.md).
- Persistence rule (never persist progress): see [`livestatus.md` §12](../../../../srs/livestatus.md).
- Tool-context shape and architectural boundaries (tool runner is the IO edge): see [`architecture.md` §3.2](../../../../architecture/architecture.md#32-agent-layer) and [`architecture.md` §4 ToolCtx](../../../../architecture/architecture.md#4-key-contracts).
- Logging cadence: see [`code-style.md` § Logging](../../../../standards/code-style.md#logging) — debug for stdout tails, info for state changes.

## Open questions

- Should progress events carry a monotonic `seq` so renderers can de-dup if a tool emits during a backlog flush? Default: yes — append uses `seq` for tie-break ordering.
- For MCP `tools/progress` notifications, decide normalization shape (`progress`, `total`, `message`). Default: pass through into `methodCall` string.
