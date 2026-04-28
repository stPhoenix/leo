# Compliance iteration 1 — F24 plan-mode-permissions

## Acceptance criteria

- AC1: PASS — `PlanModeController.getMode/enterPlan/exitPlan` at `src/agent/planModeController.ts:86-104`; `ExitPlanMode` writes via `PlanStore.writePlan` before flipping flag at `src/tools/planModeTools.ts:97-105`; `plan.mode.enter` / `plan.mode.exit` logs assert at `tests/unit/planModeController.test.ts` "defaults mode to normal and flips to plan on enterPlan" + "exitPlan flips back to normal…".
- AC2: PASS — `AgentRunner.applyPlanModeGate` short-circuits non-allowlisted tools at `src/agent/agentRunner.ts:340-349`; typed error `"blocked by plan mode: <toolId>"` asserted by `tests/unit/agentRunner.test.ts` "plan-mode permission gate blocks non-allowlisted tools without invoking confirmation" which verifies `confirmCalls === 0` and `writeInvoked === false`; `plan.mode.tool-blocked` emitted via `PlanModeController.recordToolBlocked` at `src/agent/planModeController.ts:117-119`.
- AC3: PASS — Both tools check `isMainAgent(ctx.agentId)` at `src/tools/planModeTools.ts:62-68` and `src/tools/planModeTools.ts:97-101`; `PlanModeForbiddenInSubagent` + `plan.mode.subagent-reject` asserted by `tests/unit/planModeTools.test.ts` "EnterPlanMode rejects subagent context…" and "ExitPlanMode refuses subagent context — no write, no transition" (vault stays empty, mode unchanged).
- AC4: PASS — Each transition enqueues a `PendingReminder` at `src/agent/planModeController.ts:202-217`; drain prepends into `baseMessages` as `system` role at `src/agent/agentRunner.ts:222-232`; `<system-reminder>…</system-reminder>` wrapping asserted byte-for-byte at `tests/unit/planModeController.test.ts` "queues wrap reminder bodies with <system-reminder> tags byte-for-byte"; flush logged and attachments drained covered by "flushes pending attachments on drain and empties the queue" and `tests/unit/agentRunner.test.ts` "prepends pending plan-mode attachments as system messages on next turn".
- AC5: PASS — Opposing-flag clearing at `src/agent/planModeController.ts:205-213` pops the tail when kinds oppose; `plan.attachment.cleared-opposing` logged with `droppedKinds`; asserted by `tests/unit/planModeController.test.ts` "opposing-flag clearing drops both entries on rapid enter→exit before drain" and "opposing-flag clearing also works exit→enter".
- AC6: PASS — `maybeInjectStaleTodoReminder` enforces all three conditions at `src/agent/planModeController.ts:138-175`; `plan.stale-todo.reminder` + `plan.stale-todo.suppressed` events emitted with `reason ∈ {empty, rate-limit, todowrite-called}`; asserted by `tests/unit/planModeController.test.ts` "stale-todo reminder fires only when…" / "stale-todo suppressed with reason=empty" / "stale-todo suppressed with reason=todowrite-called" / "stale-todo rate-limit counter resets after a reminder fires". Reminder never surfaced to user: injected as `system`-role message, never converted to `AgentTurnEvent.token`.
- AC7: PASS — Vitest suite coverage: gate blocks write tool + zero confirmation (agentRunner `plan-mode permission gate blocks non-allowlisted tools…`), allowlist pass-through (agentRunner `plan-mode gate passes read_note through…`), subagent rejection (planModeTools both cases), ExitPlanMode write-before-flip (planModeTools `ExitPlanMode writes the plan through PlanStore.writePlan before flipping the flag`), attachment queued + flushed + wrapping (planModeController + agentRunner), opposing-flag clearing (planModeController two cases), stale-todo all conditions + rate-limit boundary + suppression reasons.

## Scope coverage

- In scope "`PlanModeController` module owning flag + attachments + stale-todo state": PASS — `src/agent/planModeController.ts`.
- In scope "`EnterPlanMode` and `ExitPlanMode` ToolSpecs registered with main-agent-only guard": PASS — `src/tools/planModeTools.ts` (registration into `ToolRegistry` is `main.ts` wire-up, deferred to F25; tools themselves ship with factory + guards exercised in unit tests).
- In scope "permission gate in AgentRunner before ConfirmationController with allowlist + PlanModeBlocked": PASS — `src/agent/agentRunner.ts:310-314` (applyPlanModeGate called before invokeWithConfirmation).
- In scope "subagent prohibition via `agentId` check at transition time": PASS — both tool factories guard on `ctx.agentId`.
- In scope "mode-transition FIFO with rapid-toggle opposing-flag clearing": PASS — `planModeController.enqueueReminder`.
- In scope "stale-todo rate-limiter with three conditions": PASS — `maybeInjectStaleTodoReminder`.
- In scope "structured log events through Logger": PASS — `plan.mode.enter`/`exit`/`subagent-reject`/`tool-blocked`, `plan.attachment.queued`/`flushed`/`cleared-opposing`, `plan.stale-todo.reminder`/`suppressed`.
- In scope "Vitest coverage of all seven assertion families": PASS — see AC7.

## Out-of-scope audit

- Out of scope "plan approval dialog + Approve/Edit/Reject + result-message variants": CLEAN — no dialog or result-variant code under this slice; ExitPlanMode only writes raw `{plan}` and flips flag.
- Out of scope "plan/todo session resume (todo rehydration from transcript, plan fallback chain)": CLEAN — `mode` starts `normal` on every controller instance; no persistence added; `historyByThread` unchanged.
- Out of scope "`TodoWrite` tool itself": CLEAN — no `todoWriteTool.ts` modifications; only reads `TodoStore.get(key)` from the rate-limiter.

## QA aggregate
Verdict: PASS — typecheck/lint/411-tests/build all green; zero gate failures.

## Verdict: PASS
