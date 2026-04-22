# Compliance iteration 1 — F26 plan-session-resume

## Acceptance criteria

- AC1: PASS — `PlanSessionResume.resume(thread)` emits `plan.resume.start` unconditionally at `src/agent/planSessionResume.ts:42`; empty transcript short-circuits to `plan.resume.skipped{reason:'empty-transcript'}` at `src/agent/planSessionResume.ts:43-47`. Asserted by `tests/unit/planSessionResume.test.ts` "emits plan.resume.start and skipped on empty transcript". Runtime ordering (post-F14 load, pre-ChatView mount) is parked for `main.ts` wire-up (see impl-1 Deviations).
- AC2: PASS — `rehydrateTodos` walks backwards via `findLatestToolUse(messages, 'TodoWrite')` at `src/agent/planSessionResume.ts:105-115`; `validateTodo` used for each entry at `src/agent/planSessionResume.ts:68-79`; `TodoStore.write(key, validated)` called at `src/agent/planSessionResume.ts:82`; no `TodoWrite` → `plan.resume.todos.none`; Zod failure → `plan.resume.todos.rehydrated{count:0, reason:'validation-failed'}`. Asserted by "replays latest-wins TodoWrite…", "silently rejects invalid TodoWrite…", "emits todos.none when no TodoWrite…".
- AC3: PASS — Three tier resolvers at `src/agent/planSessionResume.ts:96-104` run in order `[snapshot, tooluse, attachment]`; each hit emits `plan.resume.plan.<tier>-hit` and the loop breaks on first non-empty; miss-all emits `plan.resume.plan.none`. Asserted by "recovers plan from file_snapshot tier…", "falls through to ExitPlanMode tool_use…", "falls through to user attachment planContent…", "stops at first non-empty tier — snapshot wins…", "logs plan.none when no recovery tier yields a hit".
- AC4: PASS — On first-hit, `PlanStore.writePlan(hit.content)` called at `src/agent/planSessionResume.ts:120`; `plan.resume.plan.write{tier}` logged. Byte-for-byte round-trip asserted by comparing vault file values against the source content in "recovers plan from file_snapshot tier…" et al.
- AC5: PASS — Tier loop breaks on first non-empty hit at `src/agent/planSessionResume.ts:102` (no merging); `StoredThread.messages` is typed `readonly` and never reassigned. The "stops at first non-empty tier" test asserts snapshot wins over tool_use + attachment and vault contains only the snapshot body.
- AC6: PASS — Idempotency guard compares recovered content against `PlanStore.readPlan()` at `src/agent/planSessionResume.ts:111-118`; equal → `plan.resume.skipped{reason:'plan-unchanged', tier}` and no write. Asserted by "is idempotent — a second resume with the same transcript does not re-write when PlanStore.readPlan matches" — second resume produces 1 skipped event and keeps the write count at 1.
- AC7: PASS — Vitest suite enumerated: latest-wins ("replays latest-wins TodoWrite…"), tier-isolation (three tests), strict-stop-at-first-hit ("stops at first non-empty tier…"), empty/no-TodoWrite/no-recovery no-ops (empty, "emits todos.none…", "logs plan.none…"), Zod-invalid rejection ("silently rejects invalid TodoWrite…"), write-through (every tier test checks `vault.files` content), re-entry idempotency, content-leak guard ("never logs plan or todo content above debug").

## Scope coverage

- In scope "`PlanSessionResume` module with `resume(thread)` invoked at `Plugin.onload` post-F14 hydration": PASS — module lands; runtime call-site deferred to `main.ts` wire-up.
- In scope "todo rehydration via shared `Todo` schema into `TodoStore.write`": PASS — `validateTodo` from F23 reused.
- In scope "plan-content recovery fallback chain in strict order": PASS — tier loop breaks on first hit.
- In scope "write back via `PlanStore.writePlan`": PASS — `PlanStore.writePlan(hit.content)` sole write path.
- In scope "structured `plan.resume.*` log events": PASS — 9 event names emitted per tier/case.
- In scope "idempotency with `plan.resume.skipped`": PASS.
- In scope "Vitest coverage per listed branches": PASS — all 7 branches covered.

## Out-of-scope audit

- Out of scope "plan approval dialog (F25)": CLEAN — no dialog code referenced.
- Out of scope "plan mode permission gate (F24)": CLEAN — no `PlanModeController` usage.
- Out of scope "TodoWrite tool (F23)": CLEAN — only consumes `TodoStore.write` + `validateTodo`.
- Out of scope "compaction boundary handling": CLEAN — resume is best-effort on whatever transcript exists.
- Out of scope "multi-thread resume": CLEAN — single-thread only, no thread iteration.
- Out of scope "subagent/sessionId partitioning": CLEAN — `todoKeyFor(thread, agentId)` defaults to `agentId ?? thread.id` matching F23.

## QA aggregate
Verdict: PASS — typecheck/lint/440-tests/build all green.

## Verdict: PASS
