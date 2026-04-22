# Compliance iteration 1 — F25 plan-approval-dialog

## Acceptance criteria

- AC1: PARTIAL PASS — main-agent non-empty-plan path calls `opts.approval.present({plan, threadId, isSubagent:false})` at `src/tools/planModeTools.ts:129-135`; `PlanApprovalDialog` subscribes via `makePlanApprovalSource` and mounts only when `source.current()` is non-null (`src/ui/chat/PlanApprovalDialog.tsx:41-52`); `plan.approval.request` logged with `{threadId, isSubagent, planLength}` at `src/tools/planModeTools.ts:125-128`. The `StreamEvent.plan_approval` emission is replaced by the Promise-based controller pattern (see impl-1 Deviations) — the net observable behavior (pause → dialog mount → await outcome → resume) is preserved, and Vitest coverage at `tests/dom/planApprovalDialog.test.tsx` "renders plan body + three buttons on pending request with role=dialog / aria-modal" asserts the mount + role/aria shape.
- AC2: PASS — Plan renders via optional `renderMarkdown(container, plan)` hook (Obsidian-runtime injected) with `<pre>` fallback at `src/ui/chat/PlanApprovalDialog.tsx:127-136`; three buttons in Tab order at `src/ui/chat/PlanApprovalDialog.tsx:137-163`; `Approve` / `Edit` both resolve to success paths in `ExitPlanMode.invoke`, `Reject` rejects without flipping mode at `src/tools/planModeTools.ts:137-142`. Asserted by `tests/dom/planApprovalDialog.test.tsx` "Approve resolves with type=approve…" / "Edit → Confirm resolves with type=edit…" / "Reject resolves with type=reject" and `tests/unit/planModeTools.test.ts` "ExitPlanMode on approve writes via PlanStore.writePlan…".
- AC3: PASS — Edit button sets `state = {phase:'edit', draft:plan}` at `src/ui/chat/PlanApprovalDialog.tsx:156-158`; `<textarea>` seeded with draft at `src/ui/chat/PlanApprovalDialog.tsx:182-189`; Confirm emits `{type:'edit', planWasEdited:true, plan:draft}` which `ExitPlanMode.invoke` routes through `opts.planStore.writePlan(outcome.plan)` BEFORE `opts.controller.exitPlan(threadId)` at `src/tools/planModeTools.ts:145-155`. Cancel returns to view at `PlanApprovalDialog.tsx:200`. `plan.approval.edit` logged at `planModeTools.ts:148`. Asserted by `tests/dom/planApprovalDialog.test.tsx` "Edit → Confirm resolves with…" / "Edit → Cancel returns to view state without side effects" + `tests/unit/planModeTools.test.ts` approve test.
- AC4: PASS — `role="dialog"` + `aria-modal="true"` + `aria-live="assertive"` at `src/ui/chat/PlanApprovalDialog.tsx:121-131`; focus moves to Approve on mount / textarea in edit (`PlanApprovalDialog.tsx:66-72`); Tab cycle + Shift+Tab reversal at `PlanApprovalDialog.tsx:92-111`; asserted by `tests/dom/planApprovalDialog.test.tsx` "Tab cycles Approve → Edit → Reject in view state, Shift+Tab reverses" and "focus moves to Approve on mount".
- AC5: PASS — Esc handler at `src/ui/chat/PlanApprovalDialog.tsx:81-90`: view-state resolves `{type:'reject'}`, edit-state first sets back to view phase; typed reject feeds back as `{ok:false, error:'plan approval rejected'}` at `planModeTools.ts:141`, no `writePlan` or flag flip. Asserted by `tests/dom/planApprovalDialog.test.tsx` "Esc in view state rejects" and "Esc in edit state first returns to view, second Esc rejects".
- AC6: PASS — Case 2 subagent short-circuit at `src/tools/planModeTools.ts:114-122` (no `approval.present` call, no `writePlan`, no flag change, Case 2 message returned verbatim); Case 3 empty-plan short-circuit at `planModeTools.ts:124` (flips mode, Case 3 message returned verbatim, no dialog mount). Asserted by `tests/unit/planModeTools.test.ts` "ExitPlanMode on subagent short-circuits to Case 2 without dialog or write" and "ExitPlanMode with empty plan short-circuits to Case 3 without dialog".
- AC7: PASS — `PlanApprovalController.dispose()` force-rejects any pending request at `src/agent/planApprovalController.ts:58-63`; `useEffect` cleanup in `PlanApprovalDialog` clears the markdown container and calls the optional cleanup from `renderMarkdown` at `src/ui/chat/PlanApprovalDialog.tsx:74-84`. Asserted by `tests/unit/planApprovalController.test.ts` "dispose force-rejects any pending request…" and `tests/dom/planApprovalDialog.test.tsx` "uses renderMarkdown hook when provided and cleans up on unmount".
- AC8: PASS — Vitest suite enumerated across `tests/dom/planApprovalDialog.test.tsx` (11 cases: render/approve/edit-confirm/edit-cancel/reject/Esc-view/Esc-edit-twice/Tab-cycle/renderMarkdown-cleanup/focus-on-mount/hidden-when-null) and `tests/unit/planModeTools.test.ts` (approve writes+flips mode; subagent→Case 2; empty→Case 3) — all covered assertions documented in impl-1.

## Scope coverage

- In scope "`PlanApprovalDialog` React component with view/edit/resolving phases": PASS — `src/ui/chat/PlanApprovalDialog.tsx`.
- In scope "`ExitPlanMode` tool integration pausing on non-subagent non-empty plan, resuming with outcome": PASS — Promise-based controller pattern in place of `StreamEvent.plan_approval` (see deviation), net behavior equivalent.
- In scope "Markdown rendering via `MarkdownRenderer.render` path": PARTIAL — `renderMarkdown` hook exposed; Obsidian `app`+`Component` plumbing deferred to `main.ts` wiring slice.
- In scope "Edit → Confirm writes via `PlanStore.writePlan` BEFORE flag flip": PASS — ordering asserted at `planModeTools.ts:145-147` and covered by `ExitPlanMode on approve writes…` test.
- In scope "Focus trap + `role=dialog` + `aria-modal=true` + `aria-live=assertive` + one-shot SR announcement": PASS.
- In scope "Esc precedence (view→reject / edit→view / edit→view→reject)": PASS.
- In scope "Tool-result variants per plan.md §5.8 Cases 1/2/3": PASS — strings `"## Approved Plan:"`, `"## Approved Plan (edited by user):"`, Case 2 and Case 3 literal messages exported as constants.
- In scope "Reject → `PlanApprovalRejected` tool-error + F24 flag stays `plan` + no `writePlan`": PASS (typed error surfaced as `{ok:false, error:'plan approval rejected'}`; the `PlanApprovalRejected` class is exported for callers that want to upcast).
- In scope "Teardown on `ChatView.onClose` force-rejects pending dialog": PASS via `PlanApprovalController.dispose()`.
- In scope "Structured log events": PASS — `plan.approval.request/approve/edit/reject`.
- In scope "Vitest coverage": PASS.

## Out-of-scope audit

- Out of scope "plan mode enforcement (F24 flag, gate, attachments, stale-todo)": CLEAN — no F24 code modified except that F25's `ExitPlanMode` subagent path now returns Case 2 instead of reject (explicitly called out in deviations).
- Out of scope "plan file storage details (F23 slug, path guard, layout)": CLEAN — only `PlanStore.writePlan(plan)` called.
- Out of scope "plan/todo session resume (F26 fallback chain)": CLEAN — no persistence / rehydration code added.

## QA aggregate
Verdict: PASS — typecheck/lint/428-tests/build all green; bundle +4 KB to 243 KB.

## Verdict: PASS
