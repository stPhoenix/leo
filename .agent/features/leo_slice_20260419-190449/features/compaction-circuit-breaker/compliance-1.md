# Compliance iteration 1 — F45 compaction-circuit-breaker

## Acceptance criteria
- AC1 (single session tracking state with `consecutiveFailures: 0`): PASS — `createTrackingState()` at `src/agent/autocompactBreaker.ts:21-29` returns the §6 shape with initial `0`; "initialises consecutiveFailures to 0" test asserts it.
- AC2 (increment on every `tengu_compact_failed` branch): PASS — `recordFailureIfTracked` at `src/agent/autocompact.ts:568-576` is called from the `no_streaming_response`, `no_summary`, and `prompt_too_long` paths; three integration tests drive each branch and assert the counter advances by 1.
- AC3 (reset on success): PASS — `recordSuccessIfTracked` at `src/agent/autocompact.ts:578-586` fires before the `tengu_compact` emission on the happy path; integration test starts at `consecutiveFailures=2`, runs a successful compaction, and asserts the counter is `0`.
- AC4 (pre-call skip + zero stream invocations): PASS — the guard at `src/agent/autocompact.ts:181-183` runs between the `querySource==='compact'` check and `shouldAutoCompact`; "skips autoCompactIfNeeded when breaker tripped — zero stream calls across 10 attempts" asserts no provider requests accumulate.
- AC5 (`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`): PASS — pinned at `src/agent/compactConstants.ts:9`; test asserts the value.
- AC6 (one-shot surface on `2 → 3` edge): PASS — `recordFailure` at `src/agent/autocompactBreaker.ts:42-58` gates the `tengu_compact_breaker_tripped` emit + `Notifications.status` write on `(wasBelow && nowAt)`; test asserts both fire exactly once across five consecutive failures.
- AC7 (no Notice on auto path): PASS — the module never calls a `NoticeChannel`; the Notice-guard test asserts a `vi.fn()` Notice spy is not called during three failures.
- AC8 (teardown clears status entry): PASS — `disposeBreakerSurface` at `src/agent/autocompactBreaker.ts:71-78` calls `removeStatus(BREAKER_STATUS_KEY)` and resets `consecutiveFailures`; test confirms the status channel records the remove call.

## Scope coverage
- In scope "session-scoped `AutoCompactTrackingState` with all four fields": PASS.
- In scope "Pre-call skip at `tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES`": PASS.
- In scope "Counter wiring on every failure path + reset on success": PASS.
- In scope "User-visible status-bar entry + `tengu_compact_breaker_tripped` event at the trip edge only": PASS.
- In scope "Lifecycle reset on `onunload` / `onload`": PASS at the module surface; `main.ts` wire-up parked (see deviation).
- In scope "Vitest coverage across all failure branches / skip / reset / trip-edge / teardown": PASS — 15 cases.

## Out-of-scope audit
- Out of scope "Autocompact engine, retry loop, prompt assembly": CLEAN — owned by F43/F44, this slice only plugs into their surfaces.
- Out of scope "Manual `/compact` re-throw + Notice": CLEAN — auto-path only; manual path has no feature yet.
- Out of scope "Cross-session persistence / re-enable UI": CLEAN — per-session only.
- Out of scope "Token-warning UI / `/context`": CLEAN — lives in F46–F48.
- Out of scope "Status-bar visual design": CLEAN — uses F13's `Notifications.status` contract only; concrete copy pinned via constant.

## QA aggregate
All 4 gates PASS (typecheck, lint, 854 / 854 tests across 84 files, build `main.js` ~254 KB unchanged — breaker tree-shaken until `main.ts` wiring lands). See `qa-1.md`.

## Verdict: PASS
