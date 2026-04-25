# F06 — Normalized StreamEvent union

## Purpose

Expose the full `StreamEvent` union specified in [architecture.md § 4](../../../../architecture/architecture.md#4-key-contracts) to the UI — `token | tool_call | tool_confirmation | tool_result | usage | done | error` — see [context.md § Stream contract / FR-05](../../context.md#stream-contract). The provider-level event shape (`token | tool_call | usage | done | error`) is internal; `AgentRunner` normalizes and augments.

## Scope

In scope:
- Define the canonical `StreamEvent` discriminated union in a shared module (e.g. `src/agent/streamEvents.ts`).
- Emit `tool_confirmation` events when the graph suspends at an `interrupt()` (F05).
- Emit `tool_result` events after each tool invocation, carrying `{id, result: ToolResult}`.
- Wire `resolve` callback on `tool_confirmation` events to resume the graph.
- Ensure `token`, `usage`, `done`, `error`, `tool_call` keep current payload shapes.

Out of scope:
- Changing the public API return type (F07).
- Renaming provider-level event variants.
- Adding net-new event types (e.g. partial tool-arg streaming).

## Acceptance criteria

1. The shared `StreamEvent` union has exactly the variants listed in [architecture.md § 4](../../../../architecture/architecture.md#4-key-contracts). (FR-05)
2. Every graph node emits events through the shared union; provider events are transformed at the boundary, not passed through. (FR-05)
3. UI consumers (`ChatView` and downstream dispatchers in [`src/ui/chat/`](../../../../../src/ui/chat/)) compile against the new union with zero `any` casts. (NFR-01)
4. A `tool_result` event always follows a `tool_call` event for the same `id`; a test asserts ordering. (NFR-04)
5. Existing ChatView end-to-end flow (stream → render → confirm → resume) passes without behavioral change. (NFR-01)

## Dependencies

- [F05 — graph-interrupt-confirm](../graph-interrupt-confirm/feature.md)
- [../../context.md § Stream contract](../../context.md#stream-contract)
- [../../features-index.md](../../features-index.md) row F06

## Implementation notes

- Union source-of-truth — [architecture.md § 4 `StreamEvent`](../../../../architecture/architecture.md#4-key-contracts).
- Data-flow diagrams — [architecture.md § 5.2](../../../../architecture/architecture.md#52-chat-turn-no-tools) and [§ 5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation).
- Coding style — [code-style.md](../../../../standards/code-style.md).
- Testing patterns — [best-practices.md](../../../../standards/best-practices.md).

## Open questions

1. Should `tool_result` events include the same payload the model sees (stringified), or the raw `ToolResult<T>`? Default: raw typed `ToolResult<T>`; UI stringifies when needed.
2. Is `usage` a per-turn or per-roundtrip event? Default: per-roundtrip (matches provider stream).
