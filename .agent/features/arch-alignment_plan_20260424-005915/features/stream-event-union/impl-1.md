# Impl iteration 1 — F06 stream-event-union

## Summary

Added `src/agent/streamEvents.ts` exporting the canonical `StreamEvent` discriminated union specified in architecture.md §4 (`token | tool_call | tool_confirmation | tool_result | usage | done | error`). `AgentRunner` is now the sole emitter of this union; provider-level events keep their separate type (`@/providers/types` `StreamEvent`, aliased as `ProviderStreamEvent` at the agent→provider boundary) and are transformed by graph nodes. `callModelNode` emits `tool_call` when the provider announces a call; `handleToolCallsNode` Pass 2 emits `tool_result` with the raw `ToolResult<T>` after each invocation. UI consumers (`ChatView`, `turnDispatcher`, `streamingController`) switched their `StreamEvent` import from `@/providers/types` to `@/agent/streamEvents`. The obsolete `AgentTurnEvent` alias was removed; tests import `StreamEvent` under the legacy name via a rename-only import to keep diffs small.

## Files touched

- `src/agent/streamEvents.ts` — new; canonical 7-variant union per arch §4.
- `src/agent/types.ts` — deleted the `AgentTurnEvent` alias; `ToolConfirmationDecision` + `ToolConfirmationStreamRequest` remain (consumed by the new union).
- `src/agent/graph.ts` — imported `StreamEvent` from `./streamEvents`; aliased the provider event as `ProviderStreamEvent` at the import site; `TurnBinding.events` typed `EventChannel<StreamEvent>`; `callModelNode` now pushes `{ type: 'tool_call', call }` when the provider emits a tool call; `handleToolCallsNode` Pass 2 pushes `{ type: 'tool_result', id, result }` after each invocation (raw `ToolResult`, per Open-Q1 default).
- `src/agent/agentRunner.ts` — imports `StreamEvent` from the new module; `AgentRunnerProvider.stream` signature typed with `ProviderStreamEvent`; `send()` returns `AsyncIterable<StreamEvent>`; `EventChannel<StreamEvent>` throughout.
- `src/ui/chatView.tsx`, `src/ui/chat/turnDispatcher.ts`, `src/chat/streamingController.ts` — `StreamEvent` import swapped from `@/providers/types` to `@/agent/streamEvents`. No other changes required — existing narrow `switch/if` blocks don't handle the new variants (`tool_call`, `tool_result`, `tool_confirmation`), so they fall through via TS's exhaustive-union tolerance without `any` casts.
- `src/main.ts` — simplified `streamStarter`: since the ChatStreamStarter type now matches the agent union, it just yields through every non-`tool_confirmation` event instead of the old `if done / error / else` fan-out.
- `tests/unit/agentRunner.test.ts`, `tests/unit/agentRunner.microcompact.test.ts`, `tests/llm/agent.live.test.ts` — flipped the `AgentTurnEvent` import to `type StreamEvent as AgentTurnEvent from '@/agent/streamEvents'` to preserve the existing local name without touching every line.

## Tests added or updated

- `tests/unit/agentRunner.test.ts` "drives the provider through a serial tool_call → tool_result → tokens round trip" — extended to assert (AC4): a `tool_call` event with `call.id === 'c1'` is observed before a `tool_result` event with `id === 'c1'`, and the `result` payload is the raw `ToolResult<T>` (`{ ok: true, data: { echoed: 'hi' } }`).
- No new test files. 1095/1095 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

1. **`tool_result` payload is raw `ToolResult<T>`, not a stringified wire copy.** Per Open-Q1 default (and [decisions.md § Low-stakes Q10](../../decisions.md#low-stakes)): "Raw `ToolResult<T>`. UI stringifies." `workingMessages.push({ role: 'tool', content: JSON.stringify(...) })` still happens inside the graph for provider-wire compatibility, but the UI-facing event carries the typed object.
2. **`usage` is per-roundtrip (matches provider).** Per Open-Q2 default; the `usage` event fires once per `callModel` cycle if the provider emits one, which is at most once per round trip. No aggregation.

## Assumptions

1. **UI consumers that only care about a subset of variants are fine with the widened union.** `streamingController.consume(event)` has `if (event.type === 'token') … if (event.type === 'usage') … if (event.type === 'done') … if (event.type === 'error')` — the new `tool_call` / `tool_result` / `tool_confirmation` variants drop through harmlessly. No `any` casts needed; TypeScript accepts the narrowing because the old arms still type-check against the expanded union.
2. **Provider-level type keeping its local `StreamEvent` name is not a rename.** Feature OOS forbids "renaming provider-level event variants"; the variant names are untouched. The type identifier is also untouched in `@/providers/types`. The agent module defines its own same-named type at a different import path.

## Open questions

None blocking. Follow-ups:
1. Should `streamingController` grow a `tool_call` / `tool_result` arm for richer UI feedback? Not in scope of F06; `ToolConfirm.tsx` already covers the `tool_confirmation` arm.
2. F07 will convert `AgentRunner.send` into the architectural `AsyncIterable<StreamEvent>` shape at the type boundary (already the runtime behavior — the public type is already aligned).
