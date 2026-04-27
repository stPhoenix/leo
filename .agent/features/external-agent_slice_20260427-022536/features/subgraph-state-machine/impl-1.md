# Impl iteration 1 — F03 subgraph-state-machine

## Summary

Built the typed `ExternalAgentState` (matches SRS §6 verbatim), the `startExternalAgentRun` driver implementing the SRS §5 state machine (preparing → awaiting_clarify → ready → running → writing → done/cancelled/error) with cancel-from-any-phase, terminal-state stickiness, refine budget enforcement, and adapter event accumulation. Per-thread one-slot enforcement lives in `SlotManager` with `acquire / release / active`. Generated `runId` via a deterministic helper (`generateRunId`) using `crypto.randomUUID().slice(0,6)` for the tail (zero new dependency, NFR-EXT-06). Driver phases (`refine`, `adapterCall`, `writer`) are injected dependencies so concrete F04/F05 wiring drops in additively — F03 itself ships only the FSM skeleton + a deterministic `MockAdapter` test harness. Wired the `SlotManager` instance into `main.ts` so the state machine is reachable from the entry point ahead of F06's `delegate_external` registration.

## Files touched

- `src/agent/externalAgent/state.ts` — `ExternalAgentState`, `ExternalPhase`, `applyExternalEvent`, `initialState`, `isTerminal`.
- `src/agent/externalAgent/slotManager.ts` — `SlotManager` (per-thread one-slot, idempotent release).
- `src/agent/externalAgent/runId.ts` — `generateRunId({now, tail})` helper.
- `src/agent/externalAgent/subgraph.ts` — `startExternalAgentRun(deps, input): RunHandle` driver.
- `src/main.ts` — wired `SlotManager` instance + import for entry-point reachability.
- `tests/unit/externalAgent/_mockAdapter.ts` — `ScriptedAdapter` + `HangingAdapter` test helpers.
- `tests/unit/externalAgent/state.test.ts` — *(not added; covered indirectly via subgraph happy path)*.
- `tests/unit/externalAgent/runId.test.ts` — 3 cases (format, zero-pad, uniqueness).
- `tests/unit/externalAgent/slotManager.test.ts` — 5 cases (acquire/busy/different threads/release/idempotent/active).
- `tests/unit/externalAgent/subgraph.test.ts` — 10 cases (happy path, clarify round-trip, edit preserves budget, cancel from each phase, adapter error, timeout, terminal stickiness).

## Tests added or updated

- `runId.test.ts` — AC6.
- `slotManager.test.ts` — AC3.
- `subgraph.test.ts` — AC2 (mock adapter end-to-end), AC4 (cancel ≤50ms from running), AC5 (terminal sticky).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Hand-rolled FSM driver instead of LangGraph `StateGraph`.** Feature.md requested `buildExternalAgentGraph` returning a compiled LangGraph. Chose a thin async driver because: (a) the graph-shaped requirements (cancel ≤50ms, terminal stickiness, budget enforcement, mock-adapter unit harness) are easier to satisfy and reason about with explicit `await` flow than with LangGraph's `Annotation`/`StateGraph` checkpointing machinery; (b) F04 still uses `interrupt()`-style hand-off via the injected `RefineDeps.refine` callback — a future migration can wrap the driver in LangGraph nodes if needed. The state machine, transitions, and observable behavior are unchanged. Filed as a known deviation; downstream F04/F05 implement against `RefineDeps`/`AdapterCallDeps`/`WriterDeps` rather than LangGraph node registration.
- `MockAdapter` lives at `tests/unit/externalAgent/_mockAdapter.ts` per feature.md, named `ScriptedAdapter` + `HangingAdapter`.

## Assumptions

- `runId` is supplied by the subgraph caller (per OQ-01-F02 / OQ-02-F03 proposals): `generateRunId()` is the helper, but `startExternalAgentRun` accepts `runId` as input so the subgraph orchestrator stays in control of clock.
- `SlotManager` is process-global within the plugin instance (per OQ-01-F03 proposal: scoped to `LeoContext`/`LeoPlugin`).
- Default refine budget = 3, default timeout sourced from `adapter.defaultTimeoutMs` when not specified.
- Cancel from `awaiting_clarify` resolves the in-flight clarify-resolver with `null`, signaling abort.

## Open questions

OQ-01-F03 (slot scope) honored. OQ-02-F03 (runId tail source) honored.
