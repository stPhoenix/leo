# Impl iteration 1 — F60 wire-plan-mode

## Summary

Constructed `PlanStore` and `PlanApprovalController` in `main.ts.onload`, registered `TodoWrite`, `EnterPlanMode`, `ExitPlanMode` on the shared `ToolRegistry`, ran `PlanSessionResume` on load using the hydrated conversation, and threaded `PlanApprovalController` into `ChatView` so `PlanApprovalDialog` mounts via `makePlanApprovalSource`. Added `renderPlanMarkdown` callback using Obsidian's `MarkdownRenderer`. On `onunload`, `planApprovalController.dispose()` resolves pending approvals as `reject`. 1030/1030 tests (no new tests required — F23/F24/F25/F26 domain suites cover the controllers, resume, store, and tools; wiring is exercised end-to-end when the plugin boots). Orphans 22 → 18.

## Files touched

- `src/main.ts` — imports `PlanStore`, `PlanApprovalController`, `PlanSessionResume`, `createTodoWriteTool`, `createEnterPlanModeTool`, `createExitPlanModeTool`; constructs the two new fields; registers three plan-mode tools on `ToolRegistry`; runs resume after `conversationStore.load`; passes `planApprovalController` into `ChatView` deps; disposes approval controller on unload.
- `src/ui/chatView.tsx` — imports `PlanApprovalController` + `makePlanApprovalSource`; adds optional `planApprovalController` dep; builds `planApprovalSource` and `renderPlanMarkdown` (via `MarkdownRenderer`) and passes them to `ChatRoot` through the existing optional props.

## Tests added or updated

No new tests. Coverage rationale:
- TodoWrite tool, PlanStore CRUD, plan-mode controller permission gate, plan approval controller resolve/subscribe, and plan session resume tier chain are all covered by their per-feature suites (`todoStore.test.ts`, `planStore.test.ts`, `planModeController.test.ts`, `planModeTools.test.ts`, `planApprovalController.test.ts`, `planSessionResume.test.ts`).
- The wire-up itself is straight object composition; the single behavioural risk (resume running against a fresh thread with no messages) is covered by `planSessionResume.test.ts` "resume is a no-op on empty transcript".

## Addressed gaps from previous iteration

Not applicable — first iteration for F60.

## Deviations from feature.md

- `createTodoWriteTool` expects `{store, keyFor}` (not `{todoStore, logger}` as the feature doc suggested). Wiring passes the existing `TodoStore` plus a `keyFor` that uses `agentId` when present, falling back to `thread`.
- `createEnterPlanModeTool` / `createExitPlanModeTool` signatures take `{controller, planStore, logger}` (Exit additionally takes `approval`). Feature doc's descriptions matched, but constructor shapes differ from the draft.
- Resume runs once immediately after tool registration using `conversationStore.getThread()`, not a separate rehydration phase. This keeps the single-thread F14 model intact.
- No rate-limited stale-todo reminder wiring was added here — that's `PlanModeController`'s job and is already shipped/covered in F24.

## Assumptions

- `ConversationStore.getThread()` returns the live hydrated thread by default thread id, matching what `loadedThread` contains. Verified by reading `conversationStore.ts`.
- Tools registered in `main.ts.onload` via `toolRegistry.register(...)` remain available for the lifetime of the plugin unless explicitly unregistered; agent runner pulls them via `toolRegistry.toOpenAITools(thread)`.
- `PlanApprovalDialog` mounts globally inside `ChatRoot`; it's visible only when `planApprovalController.current() !== null`. The `makePlanApprovalSource` `subscribe` plumbs controller updates to the React root so Esc / Approve / Edit / Reject route back to `controller.resolve`.

## Open questions

- Should `TodoWrite` `keyFor` always prefer `agentId`? Default: yes — subagents may write their own todos and should not stomp on the main-thread list. Revisit once multi-agent lands.
- Where does the "Plan: Enter plan mode" palette entry live? Not wired here — F60's `in scope` covers the tool-side of plan mode, the `/plan` slash command is already registered by `ChatView`. Palette entry for `EnterPlanMode` can ship as a trivial follow-up in F67.
