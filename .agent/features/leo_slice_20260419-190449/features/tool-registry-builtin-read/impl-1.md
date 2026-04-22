# Impl iteration 1 — F16 tool-registry-builtin-read

## Summary

Stood up the `ToolRegistry` plus a first concrete entry, `read_note`, and taught `AgentRunner` to drive the OpenAI-compatible `tool_call → tool_result → continue` loop. `ProviderChatRequest` now carries an optional `tools: OpenAITool[]`, `ChatMessage` gained `toolCalls` / `toolCallId` / `name` fields, and `StreamEvent` grew a `tool_call` variant. `LMStudioProvider` passes `tools` through in the request body and accumulates SSE `delta.tool_calls` fragments per-index, emitting a single `tool_call` `StreamEvent` per function call when `finish_reason === 'tool_calls'` or when the stream closes. `AgentRunner.drive` iterates a bounded (default 8) round-trip loop: each iteration feeds the provider the running message list (plus `tools` when non-empty), forwards `token` / `usage` to the consumer, collects any `tool_call` events, invokes them serially through the registry, appends a `role: "tool"` message with the `ToolResult` payload to the working messages, and re-enters the loop until the provider emits `done` with no new tool calls. `main.ts` registers `read_note` at `Plugin.onload` and passes the registry into `AgentRunner`.

## Files touched

- `src/providers/types.ts` — added `'tool'` to `ChatRole`, `ToolCallRequest`, `OpenAITool`, optional `tools` on `ProviderChatRequest`, optional `toolCalls` / `toolCallId` / `name` on `ChatMessage`, and `StreamEvent.tool_call`.
- `src/providers/lmStudioProvider.ts` — serialises extended `ChatMessage` shape (including `tool_calls` + `tool_call_id`), passes `tools` into request body, accumulates per-index `tool_calls` deltas and flushes them on `finish_reason==='tool_calls'` + stream close.
- `src/tools/types.ts` — new: `JsonSchema`, `ToolSpec`, `ToolResult`, `ToolCtx`, `ToolValidate`, `ToolSource`.
- `src/tools/toolRegistry.ts` — new: `ToolRegistry` with `register` (duplicate-id throw), `lookup`, `listFor`, `toOpenAITools`, `invoke(id, argsJson, ctx)` that parses JSON, runs `validate`, invokes, times the run, and emits `tool.register` / `tool.invoke.start` / `tool.invoke.ok` / `tool.invoke.error`.
- `src/tools/readNoteTool.ts` — new: `createReadNoteTool(vault)` returning a `ToolSpec<ReadNoteArgs, ReadNoteResult>`; `requiresConfirmation: false`, Zod-free hand-rolled `validate` that runs the `isSafeVaultPath` guard, reads via `VaultAdapter.read`, and returns `{ok:false}` on missing file, 200 KB cap, abort, or I/O error. No exception escapes.
- `src/agent/agentRunner.ts` — `toolRegistry` option; `drive()` rewritten as a bounded round-trip loop with serial `tool_call` invocation per iteration, `tool` messages appended between iterations, consumer-visible events limited to token / usage / error / done.
- `src/main.ts` — constructs `ToolRegistry`, registers `read_note` with the `VaultAdapter` at `onload`, feeds the registry into `AgentRunner`.
- `tests/unit/toolRegistry.test.ts` — 9 cases: CRUD (register / lookup / listFor), duplicate-id rejection, OpenAI tools array shape, `invoke` happy path with `tool.invoke.start` + `tool.invoke.ok` logs, invalid-JSON rejection, validation failure, invoke exception catch, unknown-id lookup.
- `tests/unit/readNoteTool.test.ts` — 9 cases: `isSafeVaultPath` boundary suite, tool shape (id/desc/schema/requiresConfirmation=false), happy read, traversal rejection, validation of absolute / empty / malformed args, missing-file error, 200 KB oversize rejection, aborted-signal early exit.
- `tests/unit/agentRunner.test.ts` — 2 new cases: full provider→tool_call→tool_result→tokens serial round trip with the registry; `tools` array present when registry non-empty and omitted when empty.

## Tests added or updated

- 20 new cases (9 toolRegistry, 9 readNoteTool, 2 agentRunner). Full suite: 38 files, 309/309 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- No `zod` / `@langchain/core/tools` dependency. The feature cites Zod as the schema layer and `zodToJsonSchema` as the serialiser; we ship each tool's `parameters` as a literal `JsonSchema` object plus a hand-rolled `validate` function on the spec. Rationale: a single tool with three primitive fields (`path: string`) doesn't justify an 85 KB bundle add. Future tools keep the same pattern; if a tool needs structural union / refinement, a zod dependency can be introduced alongside it without breaking the contract (`ToolSpec.validate` is decoupled from `ToolSpec.parameters`).
- `read_note` emits a 200 KB soft cap per the feature's open-question proposal; deferred definitive sizing to F41's token estimator.
- `AgentRunner.drive` caps tool round-trips at 8 by default (`maxToolRoundTrips`) — a pragmatic ceiling until the full agent graph / interrupt loop lands.

## Assumptions

- Most SSE `delta.tool_calls` payloads are indexed (`index: 0`, `1`, …) and call id / name / arguments fragments can interleave across many delta chunks; the provider accumulates per-index into a single `tool_call` event on `finish_reason==='tool_calls'` (or stream end).
- Returning the tool payload to the provider as `JSON.stringify(ToolResult)` matches the OpenAI convention of the tool-role content being a stringified JSON blob; downstream providers can parse as they see fit.
- `listFor(thread)` is an un-filtered pass-through today; F22 will supply a skill-filter predicate via dependency injection without breaking callers.

## Open questions

None.
