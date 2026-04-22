# Impl iteration 1 — F26 plan-session-resume

## Summary

Added `PlanSessionResume` at `src/agent/planSessionResume.ts` — a pure transcript walker + store-seam writer that rehydrates `TodoStore` from the latest `TodoWrite` tool_use and recovers plan content through the plan.md §8 fallback chain (snapshot → tool_use → user attachment). `resume(thread, agentId?)` walks the hydrated `StoredThread` from F14 backwards, extracts `input.newTodos` from the most recent assistant `TodoWrite` tool_use (validated via the shared `validateTodo`), then runs the three-tier plan recovery in strict order and stops at the first non-empty hit. Writes through `PlanStore.writePlan` only if the recovered body differs from `PlanStore.readPlan()` (idempotency guard) and logs `plan.resume.skipped{reason:"plan-unchanged"}` when the second run finds the on-disk file already matches. No transcript mutation, no thrown errors into `Plugin.onload` — all failure paths surface as structured `plan.resume.*` events with metadata-only fields (plan/todo content never leaves `debug`).

## Files touched

- `src/agent/planSessionResume.ts` — new `PlanSessionResume` class, tool-use extractor helpers, tier resolvers.
- `tests/unit/planSessionResume.test.ts` — 12 cases covering every AC + the content-leak guard.

## Tests added or updated

- 12 new cases. Full suite: 52 files, 440/440 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **`file_snapshot` carrier lives in `StoredMessage.extras`**, not a dedicated `role:"system"` message — Leo's persisted schema has `role ∈ {user, assistant, tool, banner}` only. The walker looks at `msg.extras.fileSnapshot` / `msg.extras.file_snapshot` (and `banner.kind === 'file_snapshot'` with payload on `extras.snapshot`) across any role. Flagged in feature Open questions as schema-not-yet-defined; this is the least-coupled carrier available today.
- **`plan_file_reference` attachment** is read from `StoredMessage.extras` on user messages. The extractor tries inline `planContent` first, then `plan_file_reference.content`, then `plan_file_reference.path` resolved through `VaultAdapter.read` (requires `vault` option). Matches the feature's "inline first, else resolve path" reading.
- **`resume(thread, agentId)`** does not yet wire into `main.ts`. Runtime wiring to call `planSessionResume.resume(thread, null)` after `ConversationStore.load()` and before `ChatView.open()` is parked alongside the F24/F25 runtime wire-up.

## Assumptions

- Schema-version breaks notwithstanding, F14's `extras` side-channel preserves unknown fields verbatim (confirmed in `conversationSchema.ts` — `collectExtras` retains everything not in the known key set). So upstream producers can start emitting `fileSnapshot` / `planContent` / `plan_file_reference` payloads today and F26 will pick them up without schema changes.
- Tool-use payloads may appear as an object `{ name, input }` or an array of such objects (OpenAI tool_calls serialize as arrays). `extractToolUses` handles both.
- `PlanStore.readPlan()` throwing counts as "no existing file" for the idempotency guard; we catch and treat as `null`.

## Open questions

- None for this iteration — scope is exhausted by the transcript walker + tier resolvers + structured logs. Runtime wire-up into `Plugin.onload` is the same parked item as F24/F25.
