# Compliance iteration 1 — F05 graph-interrupt-confirm

## Acceptance criteria

- AC1 (No `confirmTool`-style function on `AgentRunner`; confirmation is mediated by graph `interrupt()`): **PASS** — `AgentRunnerOptions` in `src/agent/agentRunner.ts` no longer exports `confirmTool`; `handleToolCallsNode` calls `interrupt(payload)` at `src/agent/graph.ts:~450`; driver loop at `src/agent/agentRunner.ts:~260` resumes via `new Command({ resume: decision })`.
- AC2 (Graph resumes correctly on all three decisions without losing queued tool calls): **PASS** — `handleToolCallsNode` Pass 1 records one outcome per pending tool call before Pass 2 acts; resuming with `allow-once`, `allow-thread`, or `deny` produces the correct `CallOutcome.kind` and Pass 2 preserves order. Regression coverage: `tests/unit/agentRunner.test.ts` "pauses for confirmation on requiresConfirmation: true tools; allow-once invokes without persisting", "allow-thread persists via markThreadAllowed before invoking", "deny produces a tool-error ToolResult and does not invoke the tool".
- AC3 (`allow-thread` persists into thread metadata and is honored on subsequent turns): **PASS** — in `graph.ts` Pass 2, `deps.markThreadAllowed?.(thread, call.name)` is called for `allow-thread`; `src/main.ts:~570` `markThreadAllowed` mutates `conversationStore` so the allow-list persists to the thread JSON; "bypasses confirmation when tool id is already in the thread allowlist" covers the honor-on-subsequent-turn behaviour (Pass 1 takes the `allow-allowlisted` branch, no interrupt emitted).
- AC4 (Cancellation mid-interrupt aborts the graph and releases any pending slot): **PASS** — `awaitDecision` in `agentRunner.ts` registers an abort listener that resolves the pending decision to `deny`; the resume flows into Pass 2, sets `cancelled = turn.signal.aborted`, and routes to `finalize` which emits `{ type: 'done', cancelled: true }` and closes the EventChannel. The existing cancellation tests (`'cancel(thread) aborts the in-flight turn and emits cancelled=true done'`, `'cancel(thread) drops queued turns …'`, `'dispose cancels in-flight …'`) continue to pass against the graph path.
- AC5 (Existing confirmation tests pass with minimal adapter shims): **PASS** — the five confirmation tests in `tests/unit/agentRunner.test.ts` were migrated to use a new `collectWithConfirm(iter, decider)` helper that consumes the stream and calls `ev.resolve(decision)`; `tests/llm/agent.live.test.ts#runTurn` now auto-resolves any `tool_confirmation` events with `allow-once`. 1095/1095 tests green.
- AC6 (Tool calls with `requiresConfirmation === false` never trigger an interrupt): **PASS** — Pass 1 short-circuits on `!spec.requiresConfirmation` with `{ kind: 'allow-no-confirm' }` before reaching the `interrupt()` call. Covered implicitly by `"drives the provider through a serial tool_call → tool_result → tokens round trip"` (the `echo_tool` in that test has `requiresConfirmation: false`; no `tool_confirmation` event is emitted — `collect` observes only token/tool_result-like provider activity).

## Scope coverage

- "Inside `handleToolCalls`, call `interrupt({call, spec})` before invoking any tool with `requiresConfirmation === true` that is not already in the per-thread allowlist.": PASS — Pass 1 of `handleToolCallsNode` does exactly this; payload includes `toolId`, `thread`, `argsJson`, and `category`.
- "Emit a `tool_confirmation` stream event when the graph suspends on the interrupt.": PASS — `driveWithGraph` detects `isInterrupted(result)`, reads `result[INTERRUPT][0].value`, and pushes `{ type: 'tool_confirmation', request, resolve }` into the EventChannel.
- "Resume the graph with the user decision via the standard LangGraph resume mechanism.": PASS — `input = new Command({ resume: decision })` after the consumer calls `event.resolve(...)`.
- "On `allow_for_thread`, update the thread allowlist atomically before resuming.": PASS — Pass 2 (which runs once all interrupts resolve) calls `deps.markThreadAllowed?.(thread, call.name)` for `allow-thread` outcomes before `deps.toolRegistry!.invoke(...)`.
- "Keep `ConfirmationController` as a thin adapter … do not duplicate state.": PASS — controller source unchanged; the stream→controller glue in `src/main.ts:streamStarter` is the only new adapter code.
- "Preserve existing inline confirmation test surface.": PASS — `tests/dom/inlineConfirmation.test.tsx` (9 tests) untouched and green.

## Out-of-scope audit

- "Redesigning UI confirmation UX": CLEAN — `InlineConfirmation.tsx` unchanged.
- "Plan-mode gating (F04 scope)": CLEAN — plan-mode gate logic preserved verbatim, now evaluated inside Pass 1 of `handleToolCallsNode`.
- "Stream event union shape (F06)": Borderline — F05 adds one new variant (`tool_confirmation`) to `AgentTurnEvent`. This is required by the feature scope bullet ("Emit a `tool_confirmation` stream event …"); F06 will finish normalising the entire union. Not a leak.

## QA aggregate

QA verdict PASS (typecheck / lint / tests / build all clean; 1095/1095 tests; 1.40 MiB bundle). See `qa-1.md`.

## Integration notes

No new files outside `src/agent/*` or existing entries. Entry point `src/main.ts` directly imports `AgentRunner`, and `streamStarter` now consumes `tool_confirmation` events — the interrupt path is wired end-to-end. Integration gate: no new orphan modules (graph.ts / EventChannel already anchored by F04).

## Verdict: PASS
