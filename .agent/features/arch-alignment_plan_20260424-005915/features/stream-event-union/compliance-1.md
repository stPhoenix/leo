# Compliance iteration 1 — F06 stream-event-union

## Acceptance criteria

- AC1 (Shared `StreamEvent` union has exactly the variants in arch §4): **PASS** — `src/agent/streamEvents.ts:12-22` lists the seven variants `token`, `tool_call`, `tool_confirmation`, `tool_result`, `usage`, `done`, `error` with the payload shapes specified by architecture.md §4.
- AC2 (Every graph node emits events through the shared union; provider events transformed at the boundary, not passed through): **PASS** — `callModelNode` translates provider `tool_call` → `{ type: 'tool_call', call }` (graph.ts:~500); provider `token` → `{ type: 'token', text }`; provider `usage` → `{ type: 'usage', input, output }`; provider `error` → `{ type: 'error', error }`. `handleToolCallsNode` emits `{ type: 'tool_result', id, result }` (graph.ts:~674). `finalizeNode` emits `{ type: 'done', cancelled }`. `driveWithGraph` emits `tool_confirmation`. No provider event is yielded through AgentRunner's channel unwrapped.
- AC3 (UI consumers compile against the new union with zero `any` casts): **PASS** — `src/ui/chatView.tsx:14`, `src/ui/chat/turnDispatcher.ts:4`, `src/chat/streamingController.ts:2` all import `StreamEvent` from `@/agent/streamEvents`. `npm run typecheck` passes with no new casts anywhere in the changed files (grep for `as any` in diff yields only pre-existing cases unrelated to this feature).
- AC4 (`tool_result` always follows `tool_call` for the same `id`; a test asserts ordering): **PASS** — new assertions in `tests/unit/agentRunner.test.ts` "drives the provider through a serial tool_call → tool_result → tokens round trip" verify that `out.findIndex(tool_call, id=c1)` precedes `out.findIndex(tool_result, id=c1)` and that the `result` field equals the raw `ToolResult<T>`.
- AC5 (Existing ChatView end-to-end flow passes without behavioral change): **PASS** — `tests/dom/chatRoot.test.tsx` (8), `tests/dom/streamingView.test.tsx` (9), `tests/dom/inlineConfirmation.test.tsx` (9), and every other DOM suite continue to pass. No DOM test required modification.

## Scope coverage

- "Define the canonical `StreamEvent` discriminated union in a shared module": PASS — `src/agent/streamEvents.ts` new, 7 variants.
- "Emit `tool_confirmation` events when the graph suspends at an `interrupt()`": PASS — shipped in F05; preserved in F06 as the `tool_confirmation` variant of the union.
- "Emit `tool_result` events after each tool invocation, carrying `{id, result: ToolResult}`": PASS — `handleToolCallsNode` Pass 2 pushes `{ type: 'tool_result', id: call.id, result }`.
- "Wire `resolve` callback on `tool_confirmation` events to resume the graph": PASS — the `resolve` property on the union variant is the same callback `driveWithGraph`'s `awaitDecision` produces, which feeds the graph resume via `new Command({ resume: decision })`.
- "Ensure `token`, `usage`, `done`, `error`, `tool_call` keep current payload shapes": PASS — `StreamEvent` variant payloads match pre-existing agent event shapes exactly (token.text, usage.input/output, done.cancelled?, error.error, tool_call.call: ToolCallRequest).

## Out-of-scope audit

- "Changing the public API return type": CLEAN — `AgentRunner.send(...)` still returns `AsyncIterable<StreamEvent>` (the variable renaming from `AgentTurnEvent` is a type-alias rename, same runtime surface). F07 will formalize the contract pointer.
- "Renaming provider-level event variants": CLEAN — `src/providers/types.ts` variant names (`token`, `tool_call`, `usage`, `done`, `error`) unchanged; only the import alias at consumer sites (`ProviderStreamEvent`) differs where needed.
- "Adding net-new event types": CLEAN — the union matches arch §4 exactly; no partial-args or partial-tool events introduced.

## QA aggregate

QA verdict PASS (typecheck / lint / tests / build all clean; 1095/1095 tests; 1.40 MiB bundle). See `qa-1.md`.

## Integration notes

`streamEvents.ts` is a new module. Its `StreamEvent` type is imported by `agent/graph.ts`, `agent/agentRunner.ts` (both wired from `src/main.ts` via `AgentRunner`), `ui/chatView.tsx` (entry-point-referenced), `ui/chat/turnDispatcher.ts`, and `chat/streamingController.ts`. Every importer is reachable from `src/main.ts`. No orphan modules.

## Verdict: PASS
