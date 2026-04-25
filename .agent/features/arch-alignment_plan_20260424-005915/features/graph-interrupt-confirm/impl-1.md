# Impl iteration 1 — F05 graph-interrupt-confirm

## Summary

Ripped the `confirmTool` callback out of `AgentRunner` and moved tool-confirmation gating into the LangGraph `interrupt()` + resume model defined by architecture.md §1 ("Interrupt-driven tool flow") and §5.3. `handleToolCallsNode` now runs a two-pass algorithm — Pass 1 is pure: it inspects plan-mode, registry lookup, thread allowlist, and (only when needed) calls `interrupt()` to pause the graph for a user decision; Pass 2 runs exactly once after every interrupt resolves and performs the side effects (plan-mode record, logging, actual tool invocation, skill-envelope injection, messages push). The driver loop in `AgentRunner.drive()` pumps `graph.invoke` until `isInterrupted()` returns false, emitting an `AgentTurnEvent.tool_confirmation` to the stream consumer for each pause and resuming with `new Command({ resume: decision })` once the consumer calls `event.resolve(d)`. The legacy `driveLegacy` imperative loop + its helpers (`applyPlanModeGate`, `invokeWithConfirmation`, `applyMicrocompactPass`) were deleted — the feature-flag fallback is superseded by the interrupt architecture. `ConfirmationController` survives unchanged; `src/main.ts`'s `streamStarter` now intercepts `tool_confirmation` events, feeds them into `ConfirmationController.request`, and calls `event.resolve(decision)` when the user clicks.

## Files touched

- `src/agent/types.ts` — added `ToolConfirmationDecision` alias and `ToolConfirmationStreamRequest`; extended `AgentTurnEvent` with a new `tool_confirmation` variant that carries the request payload and a `resolve(decision)` callback.
- `src/agent/graph.ts` — imported `interrupt`, `MemorySaver` from `@langchain/langgraph`; compiled the graph with `{ checkpointer: new MemorySaver() }` so interrupts can suspend and resume; rewrote `handleToolCallsNode` as Pass 1 (pure + interrupts) / Pass 2 (side effects); removed the old `applyPlanModeGate` / `invokeWithConfirmation` closures and the `confirmTool` entry on `GraphDeps`; added `ToolConfirmationInterruptPayload` and `ConfirmationDecision` exports consumed by `AgentRunner`.
- `src/agent/agentRunner.ts` — dropped `confirmTool` from `AgentRunnerOptions`, class state, and deps construction; rewrote `drive()` as a resume loop that calls `graph.invoke`, checks `isInterrupted`, emits a `tool_confirmation` stream event via `awaitDecision`, and resumes with `new Command({ resume: decision })`; added `awaitDecision` which wires abort-signal handling so cancellation resolves the pending decision to `deny`; deleted `driveLegacy` and the helpers (`applyPlanModeGate`, `invokeWithConfirmation`, `applyMicrocompactPass`) that existed only for the fallback path, along with the now-unused compact helpers and imports.
- `src/main.ts` — removed the `confirmTool` option from the `AgentRunner` constructor call; `streamStarter` now intercepts `tool_confirmation` events, forwards the request through `ConfirmationController.request`, and calls `event.resolve(decision)` when the user picks an action.
- `tests/unit/agentRunner.test.ts` — added a `collectWithConfirm(iter, decider)` helper; migrated the five confirmation tests (allow-once, allowlist bypass, allow-thread, deny, plan-mode) off `confirmTool` onto the stream-event contract.
- `tests/llm/agent.live.test.ts` — removed the `confirmTool: async () => 'allow-once'` options and added inline `if (ev.type === 'tool_confirmation') ev.resolve('allow-once')` inside `runTurn`, matching the new stream contract.

## Tests added or updated

No new test files. The five existing agentRunner-confirmation tests were rewritten against the stream-event contract (no `confirmTool` prop, no vi spy on the callback, assertions now count `tool_confirmation` events emitted or omitted). The live-agent helper also migrated. All 118 test files / 1095 tests pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

1. **`ConfirmationController` left entirely untouched.** Feature.md scope says "Keep `ConfirmationController` as a thin adapter that turns graph interrupts into existing UI confirmation UX — do not duplicate state." Shipped: the class source is unchanged. The adapter glue lives in `src/main.ts`'s `streamStarter`, which is the correct owner of the runtime-to-UI hand-off; the controller doesn't need to know it's now fed by interrupts. This keeps the class API stable for DOM tests (`tests/dom/inlineConfirmation.test.tsx` etc.) that already passed without modification.
2. **Per-turn `MemorySaver` rather than a singleton.** LangGraph requires a checkpointer for `interrupt()` to actually pause; we instantiate one per `driveWithGraph` call so turns don't share interrupt state. Thread id is `${thread}:${enqueuedAt}` to ensure uniqueness even across queued turns on the same chat thread. No persistence leaves the process.
3. **Removed the `USE_GRAPH_RUNTIME` fallback path.** F04 introduced it as a one-release safety. F05 makes the graph the only path (interrupts can't be expressed in the imperative loop without re-adding a confirmTool callback). The constant itself is still exported so `src/main.ts`'s `plugin.load` log line continues to work (it reads `true` at runtime), but `driveLegacy` and its helpers are gone. Removing the flag entirely is fine in a follow-up once we're confident no regression is pending.

## Assumptions

1. **Only one interrupt is ever pending at once.** Feature.md Open Q2 default: architecture requires serial tool calls per request (FR-AGENT-07), so `handleToolCallsNode` issues at most one interrupt per pause. The driver loop reads `interrupts[0]` accordingly; a best-effort runtime check would be a later tightening.
2. **Replay semantics are safe for Pass 1.** LangGraph replays a node from the top on each resume until every `interrupt()` in that node has a cached resume value. Pass 1 contains only pure reads (`deps.planMode.getMode`, `deps.toolRegistry.lookup`, `deps.allowedToolsForThread`), so multiple replays are idempotent. Every side effect (logging, `recordToolBlocked`, `markThreadAllowed`, `toolRegistry.invoke`) lives in Pass 2 which runs exactly once after the last interrupt returns.
3. **Cancellation during interrupt resolves to `deny`.** `awaitDecision` listens on the slot's abort signal; if the user cancels while the graph is paused, the decision promise resolves to `deny`, the graph resumes with `deny`, `handleToolCallsNode` notes `cancelled = turn.signal.aborted` and routes to `finalize` which emits `done(cancelled: true)`. No edit lock is held mid-pause (invoke hasn't run yet) so there's nothing to release.

## Open questions

1. **Concurrent confirmations.** If a future architectural change allows parallel tool calls, the Pass 1 loop will issue multiple interrupts in order; the driver would need to handle `interrupts.length > 1` rather than assume index 0. Defer.
2. **Keep `USE_GRAPH_RUNTIME` constant?** It's now a tombstone (always true, no alternate path). Could be removed in F07 cleanup alongside the `driveLegacy` excision.
