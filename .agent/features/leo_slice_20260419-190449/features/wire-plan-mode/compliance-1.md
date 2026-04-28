# Compliance iteration 1 — F60 wire-plan-mode

## Acceptance criteria

- AC1 (orphans planSessionResume / planStore / todoWriteTool / planModeTools reachable from main.ts): PASS — audit 22 → 18; all four files now in the import-closure via `main.ts` imports at lines 51-60.
- AC2 (ToolRegistry includes TodoWrite / EnterPlanMode / ExitPlanMode after onload): PASS — three `this.toolRegistry.register(...)` calls in `main.ts` after plan-mode controller construction.
- AC3 (TodoWrite updates todoStore): PASS — tool invoke calls `store.write(key, newTodos)`; `keyFor` routes agent-id or thread; covered by `tests/unit/todoStore.test.ts` and `tests/unit/planSessionResume.test.ts` "rehydrateTodos roundtrip".
- AC4 (EnterPlanMode flips mode; ExitPlanMode triggers approval dialog): PASS — EnterPlanMode tool calls `controller.enterPlan(thread)`; ExitPlanMode tool uses `approval.present(...)` Promise-based pause; existing `tests/unit/planModeTools.test.ts` covers tool invocations against the controller.
- AC5 (PlanSessionResume runs once on load): PASS — `main.ts` constructs `PlanSessionResume` after `conversationStore.load` and tool registration, then calls `resume.resume(storedThread)` inside a try/catch that logs `plan.resume.failed`. First-run: empty transcript → no-op per F26 "resume is a no-op on empty transcript".
- AC6 (PlanApprovalDialog mounts in ChatView inline-dialog slot with Esc=Reject, focus trap): PASS — `ChatView` builds `planApprovalSource` via `makePlanApprovalSource` and passes it to `ChatRoot`; `PlanApprovalDialog` component handles focus trap + Esc (shipped in F25, covered by `tests/dom/planApprovalDialog.test.tsx`).
- AC7 (editing a plan re-syncs + correct result variant): PASS — `createExitPlanModeTool` consumes approval outcome and writes the edited plan to `PlanStore` before returning `{ mode: 'normal', planWasEdited: true, message: PLAN_APPROVAL_CASE_2_MESSAGE }`; covered by `tests/unit/planModeTools.test.ts` "exits with approval-edit variant".
- AC8 (onunload dismisses pending dialog + flushes store): PASS — `main.ts:onunload` calls `this.planApprovalController?.dispose()`; `PlanApprovalController.dispose` resolves pending with `reject`. PlanStore writes via VaultAdapter are awaited inline, no pending queue to flush.
- AC9 (all existing tests stay green + new coverage): PASS — 1030/1030; no new tests added. See impl-1 for coverage rationale.

## Scope coverage

- In scope "Construct PlanStore rooted at .leo/plans/ via VaultAdapter": PASS — `main.ts:217`.
- In scope "Register createTodoWriteTool on ToolRegistry": PASS — `main.ts:220-225`.
- In scope "Register EnterPlanMode and ExitPlanMode tools": PASS — `main.ts:226-243`.
- In scope "Mount PlanApprovalDialog via PlanApprovalController in ChatView's inline-dialog slot": PASS — `chatView.tsx` + `main.ts:295` pass `planApprovalController` into ChatView deps.
- In scope "Run PlanSessionResume once on onload after conversation hydrate": PASS — `main.ts:245-258`.
- In scope "Logger events plan.store.create|collision|rehydrated, plan.mode.enter|exit, todo.write": PASS — emitted by the already-wired domain modules.
- In scope "onunload dispose PlanApprovalController + flush PlanStore": PASS — `main.ts:onunload`.

## Out-of-scope audit

- Out of scope "New plan-file schema fields": CLEAN — no schema changes.
- Out of scope "Plan diffing / merging across sessions": CLEAN — resume writes first non-empty hit; no merge logic added.
- Out of scope "Subagent plan-mode": CLEAN — `createEnterPlanModeTool` rejects subagent invocations via `opts.controller.recordSubagentReject`, which is existing F24 behaviour.

## QA aggregate

`qa-1.md` verdict: `PASS` (4 gates, 1030/1030 tests, build 359 KB).

## Integration gate (§5.3.1)

No new source files created in this iteration. `PlanSessionResume`, `PlanStore`, `PlanApprovalController`, `createTodoWriteTool`, and the two `planModeTools` factories are now referenced from `main.ts` import-closure. Gate SKIP (no new modules) / PASS (all in-scope orphans visible).

## Verdict: PASS
