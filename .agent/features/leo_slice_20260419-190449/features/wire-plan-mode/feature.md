# F60 — Wire plan mode stack

## Purpose

Close the integration gap left by F23, F25, F26. `PlanStore`, `todoWriteTool`, `planModeTools` (`EnterPlanMode` / `ExitPlanMode`), and `PlanSessionResume` ship as domain modules but are not constructed, registered, or invoked from `main.ts`. The `planModeController` and `todoStore` are already constructed, but the tools that write todos/plans are not registered on the `ToolRegistry`, and plan-session resume never runs on load. The `PlanApprovalDialog` React component ships but has no mount point. This feature wires the full plan-mode vertical into the plugin lifecycle so an agent invocation of `TodoWrite`, `EnterPlanMode`, or `ExitPlanMode` reaches real stores and the approval dialog renders in the `ChatView`.

## Scope

### In scope

- Construct a `PlanStore` rooted at `.leo/plans/` using the existing `VaultAdapter`, wired with collision retry ×10 and the path-traversal guard from F23.
- Register `createTodoWriteTool(todoStore)` on the `ToolRegistry` as `TodoWrite` with `requiresConfirmation: false` per F23 spec.
- Register `EnterPlanMode` and `ExitPlanMode` tools using `planModeTools.ts` factories, wired with the existing `PlanModeController` and the new `PlanStore`.
- Mount `PlanApprovalDialog` via `PlanApprovalController` in the `ChatView`'s inline-dialog slot; the dialog opens when `ExitPlanMode` is invoked with an approval-required plan and resolves the promise that `AgentRunner` is awaiting (per F25 Promise-based pause).
- Run `PlanSessionResume` once on `onload` after the conversation store hydrates: walk the latest `TodoWrite` tool_use to rehydrate `todoStore`, and run the snapshot → tool_use → attachment fallback chain to recover the in-progress plan into `PlanStore` (first non-empty hit wins + write-back).
- Logger events `plan.store.create|collision|rehydrated`, `plan.mode.enter|exit`, `todo.write` per the existing domain modules' emit API.
- On `onunload`, dispose `PlanApprovalController` and flush `PlanStore` if any write is in flight.
- Unit + integration tests: resume on load rehydrates todos + plan; TodoWrite tool round-trips a todo list; EnterPlanMode flips the permission gate (which F24 owns); ExitPlanMode with approval-required shows the dialog and Approve/Edit/Reject fire correct result variants.

### Out of scope

- New plan-file schema fields (F23 schema is frozen here).
- Plan diffing / merging across sessions (F26 resumes, doesn't merge).
- Subagent plan-mode (F24 covers the permission flag; this wires the tools).

## Acceptance criteria

1. Orphans `storage/planStore.ts`, `tools/todoWriteTool.ts`, `tools/planModeTools.ts`, `agent/planSessionResume.ts` all become reachable from `src/main.ts`; §5.4 audit removes them.
2. `ToolRegistry.toOpenAITools(thread)` includes `TodoWrite`, `EnterPlanMode`, `ExitPlanMode` after `onload`.
3. Invoking `TodoWrite` through the agent updates `todoStore`; a subsequent `todoStore.snapshot(session)` returns the written list.
4. Invoking `EnterPlanMode` flips `planModeController.mode(thread) === 'plan'`; invoking `ExitPlanMode` triggers the approval dialog (via `PlanApprovalController`) and on `Approve` returns `mode: 'normal'` with no edit.
5. `PlanSessionResume` runs once on load: if the hydrated conversation contains a `TodoWrite` tool_use, `todoStore` reports the rehydrated list; if a plan snapshot or tool_use or attachment exists, the plan is written back to `PlanStore` (first non-empty hit).
6. `PlanApprovalDialog` mounts in the `ChatView` inline-dialog slot (via the existing `InlineDialog` host used by `ConfirmationController`); Esc = Reject, focus is trapped per F25 AC.
7. Editing a plan in the dialog and clicking `Approve` re-syncs the edited body to `PlanStore`; the `ExitPlanMode` result message variant matches F25 §5.8 Case 2.
8. On `onunload`, any pending dialog is dismissed and the plan store write is flushed; regression test verifies no uncaught promise.
9. All existing tests stay green; new tests added per §Scope.

## Dependencies

F14 (conversation persistence — hydrated before resume runs) · F17 (confirmation flow — reuses InlineDialog host) · F22 (skills picker — plan mode permission interaction) · F23 (plan & todo store) · F24 (plan mode controller) · F25 (approval dialog) · F26 (session resume). All `feature-complete`.

## Implementation notes

- [Architecture §4 Runtime data flow — Plan mode](../../../../architecture/architecture.md#4-runtime-data-flow) — shows EnterPlanMode → ExitPlanMode round-trip and the approval-dialog seam.
- [Architecture §5 Lifecycle — Resume](../../../../architecture/architecture.md#5-lifecycle) — plan + todo rehydration runs in the same phase as conversation rehydration.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — register tools once in `onload`; tools are idempotent.
- F25 compliance-1 notes "Promise-based pause" as the replacement for the earlier `StreamEvent.plan_approval` design; `PlanApprovalController.requestApproval()` returns the promise that gets resolved when the dialog closes.
- F26 tier chain (snapshot → tool_use → attachment) must execute in exactly that order and short-circuit on first non-empty hit.

## Open questions

- Where does the plan dialog live in the DOM: inside `ChatView` (per F04) or a global modal? Default: inside `ChatView`'s `InlineDialog` host for continuity with tool confirmations.
- Should `PlanSessionResume` backfill a `TodoWrite` snapshot into history if the tool_use exists but the store was lost mid-session? Per F26 spec: write back on first non-empty hit; this is the default.
