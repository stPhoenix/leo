# Impl iteration 1 — F45 compaction-circuit-breaker

## Summary

Added the per-session autocompact circuit breaker. `src/agent/autocompactBreaker.ts` exports the `AutoCompactTrackingState` shape from compact.md §6 ("Tracking State"), `createTrackingState` factory, `shouldSkipForCircuitBreaker(tracking)` pure predicate (true iff `consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`), `recordFailure(tracking, surfaces)` that increments and — only on the exact `2 → 3` edge — emits `tengu_compact_breaker_tripped` and writes a single persistent status-bar entry via F13's `Notifications.status` contract with key `leo.autocompact.breaker` and message "Leo: autocompact disabled for this session", `recordSuccess(tracking, surfaces)` that zeroes the counter and removes the status entry, and `disposeBreakerSurface(tracking, surfaces)` for plugin unload teardown. `src/agent/autocompact.ts` wires these into every success / failure path: the pre-call skip runs immediately after the `querySource === 'compact'` guard; failure increments are called from the no-streaming, no-summary, and PTL-exhaustion branches; success is recorded right before the `tengu_compact` telemetry emission.

## Files touched

- `src/agent/autocompactBreaker.ts` — new. Exports the tracking state + predicate + recorders + `BREAKER_STATUS_KEY` + `BREAKER_STATUS_MESSAGE` + `BreakerStatusChannel` interface (a narrow subset of F13's `Notifications` surface).
- `src/agent/autocompact.ts` — added `tracking?: AutoCompactTrackingState` and `breakerNotifications?: BreakerStatusChannel` to `AutocompactOptions`, inserted the pre-call skip after the `querySource === 'compact'` guard, and added `recordFailureIfTracked` / `recordSuccessIfTracked` helpers called from every failure path (`no_streaming_response`, `no_summary`, `prompt_too_long` via F44) and the happy path.

## Tests added or updated

- `tests/unit/autocompactBreaker.test.ts` — 15 cases covering AC1–AC8:
  - **Constants** (1): `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES === 3` (AC5).
  - **`createTrackingState`** (1): initial `consecutiveFailures = 0` (AC1).
  - **`shouldSkipForCircuitBreaker`** (3): below / at / above threshold (AC4).
  - **`recordFailure`** (2): monotonic increment; single `tengu_compact_breaker_tripped` + single status-write across five failures past the threshold (AC2, AC6).
  - **`recordSuccess`** (1): reset to `0` + status remove after three failures (AC3).
  - **`disposeBreakerSurface`** (1): removes status entry + resets counter on teardown (AC8).
  - **`autoCompactIfNeeded` integration** (5): increments on `no_streaming_response`, `no_summary`, and `prompt_too_long` branches (AC2); resets on success (AC3); skips ten further attempts with zero stream calls once tripped (AC4).
  - **Notice guard** (1): auto-path trips the breaker without constructing any `Notice` (AC7) — only the injected `BreakerStatusChannel.status` is called.

Net delta: +15 tests (839 → 854 passing).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Breaker surface is a narrow `BreakerStatusChannel` interface** (subset of F13's `Notifications` class with `status(key, message)` + `removeStatus(key)`) rather than importing `Notifications` directly. This keeps `autocompactBreaker.ts` pure / DOM-free and lets tests inject a `RecordingStatusChannel`. A caller wiring Leo's real `Notifications` instance passes it directly (the shape is structurally compatible).
- **Plugin lifecycle wiring is not yet live.** `disposeBreakerSurface` exists and is tested, but `main.ts` does not yet construct a tracking state nor call it on `onunload`. Wiring lands when the AgentRunner autocompact pass is turned on (parallel to F44's gating). The test covers the dispose contract independent of plugin lifecycle.
- **No Notice toast on auto-path**: verified by the Notice-guard test asserting the auto-path never constructs a notice — the only user-visible surface is the status-bar entry, matching compact.md §20.

## Assumptions

- Tracking scope = per-session (plugin load), confirming feature Open question §1. Per-thread state would require per-thread tracking state maps; deferred to F37 follow-up if users report the symptom.
- A successful manual `/compact` (future feature) should reset the counter per Open question §5 — `recordSuccess` is called unconditionally on any non-null `CompactionResult`, so the manual path will benefit when it lands.
- The breaker-tripped status-bar entry uses a fixed key `leo.autocompact.breaker` so repeated trips within a session idempotently overwrite the same DOM slot; `recordSuccess` removes it via `removeStatus(key)`.

## Open questions

- **Settings-tab re-enable button** (Open question §2): not shipped in v1 — reload is the only reset path.
- **Status-bar copy / tooltip** (Open question §3): shipped text is "Leo: autocompact disabled for this session"; F13's wireframe pass can refine without changing the contract.
- **Cross-thread concurrency** (Open question §4): F10's turn serialisation (F11 queue) guarantees one autocompact in flight per session, so no double-increment; no runtime assertion added.
