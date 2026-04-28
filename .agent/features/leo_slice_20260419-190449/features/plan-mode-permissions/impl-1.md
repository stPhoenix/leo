# Impl iteration 1 — F24 plan-mode-permissions

## Summary

Added `PlanModeController` at `src/agent/planModeController.ts` owning the per-thread `mode: 'normal' | 'plan'` flag, the mode-transition FIFO with rapid-toggle opposing-flag clearing, and the stale-todo rate-limiter. Registered `EnterPlanMode` / `ExitPlanMode` builtin ToolSpecs at `src/tools/planModeTools.ts` — both reject subagent contexts (`ctx.agentId != null`) with a typed error + `plan.mode.subagent-reject` log event; `ExitPlanMode` writes `{plan}` through `PlanStore.writePlan` before flipping the flag back to `normal`. Integrated the permission gate into `AgentRunner.drive()` so any tool call in `plan` mode that is not in the allowlist short-circuits to `{ok:false, error:"blocked by plan mode: <id>"}` and emits `plan.mode.tool-blocked` **without invoking `ConfirmationController`** (enforcement is permission-system, not prompt). On each turn start, pending reminders are drained into `system`-role messages at the head of the outgoing message stream and `maybeInjectStaleTodoReminder()` is evaluated; at turn end `recordAssistantTurn()` updates the rate-limiter state based on observed tool calls.

## Files touched

- `src/agent/planModeController.ts` — new `PlanModeController`, `PlanModeBlocked`, `PlanModeForbiddenInSubagent`, `DEFAULT_PLAN_MODE_ALLOWLIST`, reminder-body constants.
- `src/tools/planModeTools.ts` — new `createEnterPlanModeTool` / `createExitPlanModeTool` factories with subagent-rejection guards.
- `src/tools/types.ts` — extended `ToolCtx` with optional `agentId?: string | null`.
- `src/agent/agentRunner.ts` — wired `planMode` option, drain-attachments + stale-todo injection on turn start, permission gate before `invokeWithConfirmation`, `agentId` threaded through `ToolCtx`, assistant-turn summary recorded after the tool-call loop.
- `tests/unit/planModeController.test.ts` — 14 cases covering mode default/transition, reminder queue, opposing-flag clearing, allowlist predicate, stale-todo all three conditions + suppress reasons, rate-limit reset.
- `tests/unit/planModeTools.test.ts` — 6 cases: Enter/Exit happy path, subagent rejection for both, validate rejects bad plan, confirmation flag.
- `tests/unit/agentRunner.test.ts` — 3 new cases: plan-mode gate blocks write tools with zero confirmation calls, allowlisted `read_note` passes through, pending attachments prepended as system messages on next turn and drained after.

## Tests added or updated

- 23 new cases total (14 + 6 + 3). Full suite: 49 files, 411/411 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Reminder bodies are semantic placeholders, not verbatim plan.md §6 text.** The feature calls for byte-for-byte reminder text from plan.md §6; this iteration ships `PLAN_ENTER_REMINDER` / `PLAN_EXIT_REMINDER` / `STALE_TODO_REMINDER` as module constants with the exact `<system-reminder>…</system-reminder>` wrapping shape called out in AC4, and tests assert the wrapping byte-for-byte. A future iteration will swap in the canonical text once its source is pinned (parallel to F23's `TODO_WRITE_DESCRIPTION` placeholder).
- **Stale-todo "no tool call at all" collapses to `reason: 'todowrite-called'`.** Feature AC6 enumerates exactly three suppress reasons `{empty, rate-limit, todowrite-called}`. If the last assistant turn performed zero tool calls (not "non-trivial work"), the reminder is suppressed and logged with `reason: 'todowrite-called'` (since the intent of that reason is "model did not fail to update todos"). The three enumerated reasons remain strictly the set of values emitted.
- **`planMode` not yet wired into `main.ts`.** The controller, tools, and gate are exercised end-to-end through `AgentRunner` in unit tests; the runtime wire-up in `main.ts` (construct controller, register tools on the ToolRegistry, pass to `AgentRunner`, dispose on unload) will land alongside F25 (plan approval dialog) since that feature is the first UI consumer. Flagged as follow-up in open questions.

## Assumptions

- `ctx.agentId` is always `null` in Phase 2 (Leo has no subagent runtime). Subagent rejection tests supply a non-null `agentId` manually to exercise the guard; in production the guard is a no-op until subagents land.
- The plan-mode allowlist is an exact fixed set `{Read, Grep, Glob, WebFetch, EnterPlanMode, ExitPlanMode, read_note, search_vault}`. `read_note` / `search_vault` are the Leo-specific read capability surface (the spec's `Read` / `Grep` naming is kept as forward-compat aliases). `TodoWrite` is intentionally NOT in the allowlist per the feature's strict reading ("only Read, Grep, Glob, WebFetch, and plan-file-write").
- Pending-attachment drain and stale-todo injection use `system`-role messages prepended to the existing `baseMessages` rendered by `renderPrompt`; they are visible to the provider but never surfaced to the user because they never enter `AgentTurnEvent.token` events.

## Open questions

- **Verbatim reminder body from plan.md §6** — deferred to iter-2 pending pinning of the canonical source file location. Current implementation preserves the wrapping shape and passes all AC-level shape tests.
- **`main.ts` runtime wire-up** — deferred to F25 which owns the first user-visible consumer (approval dialog); today the controller is exercised only via unit tests against `AgentRunner`.
