# Compliance iteration 1 — F03 subgraph-state-machine

## Acceptance criteria

- AC1: PASS — `ExternalAgentState` (`state.ts:32-54`) carries every field from SRS §6 verbatim (`runId`, `threadId`, `phase`, `originalAsk`, `refineHistory`, `refineIterations`, `refineBudget`, `refinedPrompt`, `selectedAdapterId`, `timeoutMs`, `startedAt`, `endedAt`, `textBuffer`, `pendingFiles`, `logEvents`, `resultFolder`, `writtenFiles`, `error`). `clarifyingQuestion` is an additive UI-state slot for the awaiting_clarify phase.
- AC2: PASS — `subgraph.test.ts` "happy path" uses `ScriptedAdapter` + stub refine + stub writer (no LLM, no vault, no HTTP). `tests/unit/externalAgent/subgraph.test.ts:48-78` proves the FSM walks preparing → ready → running → writing → done.
- AC3: PASS — `SlotManager.acquire` returns `{busy:false, handle}` first call, `{busy:true, activeRunId}` on duplicate (`slotManager.ts:24-44`); `release()` is idempotent (`slotManager.ts:42-50`). Tested in `slotManager.test.ts`.
- AC4: PASS — Cancel from running phase produces terminal `cancelled` in <50 ms (`subgraph.test.ts:226-249`, asserts `Date.now() - t0 < 50`).
- AC5: PASS — Terminal-stickiness: `setState` short-circuits if phase is terminal via `isTerminal` check in `transitionTo` (`subgraph.ts:127-133`); `cancel` / `applyReadyAction` / `resumeClarify` after `done` are no-ops. Tested in "cancel after done is a no-op".
- AC6: PASS — `generateRunId` formats `YYYYMMDD-HHmmss-<6char>` (`runId.ts:16-31`), tested with fixed `now` and `tail` injectors.

## Scope coverage

- In scope `src/agent/externalAgent/state.ts`: PASS — present.
- In scope `src/agent/externalAgent/subgraph.ts`: PASS — present (driver replaces LangGraph builder per documented deviation).
- In scope `Per-thread slot manager Map<threadId, RunHandle>`: PASS — `slotManager.ts`.
- In scope `MockAdapter test helper at tests/unit/externalAgent/_mockAdapter.ts`: PASS — `_mockAdapter.ts` shipped as `ScriptedAdapter` + `HangingAdapter`.
- In scope `Vitest suite covering: state transitions for happy path, cancel from each phase, busy-slot rejection, terminal-state idempotency`: PASS — happy path, 4 cancel cases, slot busy via slotManager.test, terminal stickiness.

## Out-of-scope audit

- Out of scope `Refine sub-agent LLM call wiring (F04)`: CLEAN — `RefineDeps` is an injected interface only.
- Out of scope `Real adapter call wiring (F05)`: CLEAN — `AdapterCallDeps` is injected.
- Out of scope `Widget projection (F07)`: CLEAN — driver exposes `subscribe(listener)` but no widget store.
- Out of scope `Persistence (F12)`: CLEAN — state is in-memory (NFR-EXT-04).

## QA aggregate

PASS (typecheck + lint + tests + build all green; +18 tests since F02). Integration gate: `SlotManager` instantiated in `src/main.ts:228`/`375`; `AdapterRegistry` already wired in F01; subgraph driver remains library-style and is consumed by F05/F06 as they land.

## Integration notes

- `startExternalAgentRun` is consumed by F06 (`delegate_external` tool) and F05 (run-phase wiring of real adapter call); not yet referenced from `src/main.ts`. The `SlotManager` instance is reachable from the entry point so concurrency enforcement is established.

## Verdict: PASS
