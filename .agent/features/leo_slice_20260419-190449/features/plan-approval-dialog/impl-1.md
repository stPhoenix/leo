# Impl iteration 1 — F25 plan-approval-dialog

## Summary

Added `PlanApprovalController` at `src/agent/planApprovalController.ts` mirroring the `AcceptRejectController` / `ConfirmationController` shape — single-pending-slot state machine with `present(request)`, `resolve(outcome)`, `subscribe(cb)`, and `dispose()` force-reject. Added `PlanApprovalDialog` React component at `src/ui/chat/PlanApprovalDialog.tsx` with three phases (`view` / `edit` / resolving via the controller's in-flight promise), `role="dialog"` + `aria-modal="true"` + `aria-live="assertive"`, Tab/Shift+Tab focus-trap cycling `Approve → Edit → Reject` (view) and `Textarea → Confirm → Cancel` (edit), Esc-rejects-in-view / Esc-exits-edit-mode-first / second-Esc-rejects precedence, and an optional `renderMarkdown(container, plan)` hook so Obsidian's `MarkdownRenderer.render` can be wired at runtime while tests render a fallback `<pre>` body. Mounted the dialog into `ChatRoot`'s region stack alongside existing `InlineConfirmation` / `InlineDialog` with a `data-region="plan-approval"` slot.

Rewired `ExitPlanMode.invoke` at `src/tools/planModeTools.ts` for plan.md §5.8 Cases 1/2/3: subagent short-circuit to Case 2 verbatim (no dialog, no writePlan, no mode flip — this supersedes F24's former subagent-reject behavior specifically for `ExitPlanMode`, keeping `EnterPlanMode`'s subagent-reject intact); empty/whitespace plan short-circuits to Case 3 verbatim (no dialog, flag still flips back to normal); main-agent non-empty plan presents the approval dialog and awaits outcome. On approve → `"## Approved Plan:\n<plan>"` + flag flip; on edit → `PlanStore.writePlan(edited)` BEFORE flag flip, then `"## Approved Plan (edited by user):\n<plan>"`; on reject → typed `{ok:false, error:"plan approval rejected"}` with no writePlan and no flag flip (F24 controller stays `"plan"`). Structured log events `plan.approval.request`, `plan.approval.approve`, `plan.approval.edit`, `plan.approval.reject` routed through the F01 Logger with `planLength` instead of plan body.

## Files touched

- `src/agent/planApprovalController.ts` — new single-pending-slot controller.
- `src/tools/planModeTools.ts` — `ExitPlanMode.invoke` rewired for Cases 1/2/3 + approval dialog integration; exported `PLAN_APPROVAL_CASE_2_MESSAGE`, `PLAN_APPROVAL_CASE_3_MESSAGE`, `PlanApprovalRejected`.
- `src/ui/chat/PlanApprovalDialog.tsx` — new React component with view/edit phases, focus trap, Esc precedence, `renderMarkdown` hook.
- `src/ui/chat/ChatRoot.tsx` — mounted `PlanApprovalDialog` between `InlineDialog` and `ComposerInput`; added `planApprovalSource` + `renderPlanMarkdown` optional props.
- `tests/unit/planApprovalController.test.ts` — 5 cases (present+resolve, current() snapshot, auto-reject on re-present, subscribe, dispose force-reject).
- `tests/unit/planModeTools.test.ts` — ExitPlanMode subagent test rewritten for Case 2 behavior (was: F24 subagent-reject); added Case 3 empty-plan test + approve-flow test; updated validate test for new looser schema (accepts empty string in `validate`, empty handled at `invoke` level).
- `tests/dom/planApprovalDialog.test.tsx` — 11 DOM cases (hidden-when-null, three-button render, Approve/Edit+Confirm/Edit+Cancel/Reject, Esc in view, Esc-twice in edit, Tab cycling, renderMarkdown hook + cleanup, focus-on-mount).
- `tests/dom/chatRoot.test.tsx` — region-list expected to include `plan-approval`; dialog-count invariant updated to 3.

## Tests added or updated

- 16 new cases (5 controller + 11 DOM) + 3 updated `planModeTools.test.ts` cases + 2 `chatRoot.test.tsx` updates. Full suite: 51 files, 428/428 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **`StreamEvent.plan_approval` + LangGraph `interrupt()` not added to the provider stream event type.** The feature couches the pause/resume handoff as a new `StreamEvent` variant; this iteration instead routes the pause through the `PlanApprovalController` Promise (the same pattern F17 `ConfirmationController` / F20 `AcceptRejectController` use) — `ExitPlanMode.invoke` simply `await`s `controller.present(...)`, identical to how `invokeWithConfirmation` awaits a user decision. No new `StreamEvent` variant is introduced; `AgentTurnEvent` remains unchanged. This keeps the spine consistent across all three inline dialogs.
- **F24's ExitPlanMode subagent-reject is overridden to plan.md §5.8 Case 2.** Feature AC6 explicitly demands subagent short-circuit to Case 2 (success), not a rejection; the F24 test asserting `PlanModeForbiddenInSubagent` for `ExitPlanMode` was rewritten to assert Case 2. `EnterPlanMode`'s subagent-reject remains intact (F24 AC3 only held on `EnterPlanMode`).
- **`ExitPlanMode.validate` accepts empty strings and lets `invoke` dispatch to Case 3.** The feature requires Case 3 fallback for empty/missing plans; this needs `validate` to pass the empty string through rather than rejecting it at the schema boundary, so Case 3 can emit the canonical payload.
- **`MarkdownRenderer.render` wiring is delegated to a `renderMarkdown` hook.** The runtime call to `MarkdownRenderer.render(app, plan, container, "", component)` requires `app` + `Component` from Obsidian, which cannot be imported under happy-dom. The component exposes `renderMarkdown?: (container, plan) => cleanup`, with a raw `<pre>` fallback when no renderer is passed. The `main.ts` wire-up to plumb Obsidian's `MarkdownRenderer` through is deferred along with the F25 runtime mount (see Open questions).
- **ChatView runtime wire-up (controller construction, source binding, onClose force-reject) not added to `main.ts` this iteration.** Runs parallel to F24's carry-over for `PlanModeController` wiring; both land when F26 (plan-session-resume) ships the first cross-feature consumer or when the planMode stack is promoted to `main.ts` in a dedicated wiring slice.

## Assumptions

- Subagent short-circuit for `ExitPlanMode` takes precedence over F24's general subagent-reject rule for this tool. `EnterPlanMode` keeps F24 behavior.
- The `renderMarkdown` hook returns an optional cleanup `() => void`; the component calls it on `useEffect` cleanup and also clears `innerHTML` to avoid leaking rendered nodes on unmount.
- Approve outcome does NOT re-write the plan file — plan.md §5.8 notes "plan already on disk from earlier plan-file-write calls in plan mode", which we honor by skipping `writePlan` on Approve (the plan was presumably written during plan-mode work). Only Edit triggers a write.

## Open questions

- **Runtime wire-up of `MarkdownRenderer.render` + controller construction in `main.ts`** — deferred along with the F24 carry-over. Current implementation is exercised entirely through unit/DOM tests.
