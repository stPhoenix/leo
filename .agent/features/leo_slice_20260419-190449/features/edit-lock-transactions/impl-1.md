# Impl iteration 1 — F18 edit-lock-transactions

## Summary

Added the domain core of the edit-lock / transaction pipeline as three new modules under `src/editor/`: `editLock.ts` (single-slot `EditLockController` with acquire / release / intersects / recordBlocked + observable listeners), `highlights.ts` (`HighlightController` with per-range expiry timers, configurable duration, DI'd setTimeout/clearTimeout for test fake-timers, `dispose` for view detach), and `withLock.ts` — an orchestrator `withLock({lock, highlights}, range, signal, apply)` that acquires the lock, runs the applier inside a try/finally, surfaces explicit failure reasons (`threw` / `applier-false` / `aborted` / `cancelled`), schedules a 3 s highlight on success, and guarantees release on every exit path. Scope is domain-logic only this iteration — F20 (`tool-edit-note-with-lock`) will plug in the CM6 `EditorTransaction` + readonly decoration extension and wire Obsidian `Notice` on blocked keystrokes. All invariants that the CM6 wiring depends on (symmetry, atomic release, timer cleanup) are unit-tested here.

## Files touched

- `src/editor/editLock.ts` — new: `EditLockController` with `acquire` / `release` / `isHeld` / `current` / `intersects(from,to)` / `recordBlocked` / `subscribe(listener)`. Structured `editor.lock.acquire` / `.release` / `.blocked-keystroke` log events at `debug`.
- `src/editor/highlights.ts` — new: `HighlightController` with `highlight(from,to) -> id`, per-id timer that auto-expires after `durationMs` (default 3000), `clear(id)`, `list()`, `subscribe(listener)`, `dispose()` cancels all pending timers. `setTimeoutImpl` / `clearTimeoutImpl` injectable for Vitest fake timers.
- `src/editor/withLock.ts` — new: `withLock(opts, range, signal, apply)` returns `{ok:true, range}` or `{ok:false, error, reason}` with reason in `'cancelled'|'applier-false'|'threw'|'aborted'`. On success schedules a highlight; on every failure path releases the lock in `finally`.
- `tests/unit/editLock.test.ts` — 13 cases: lock acquire+release symmetry, second-acquire throws, intersects() coverage, blocked-keystroke callback, highlight add+expire, dispose cancels timers, `clear(id)` early removal, withLock success path, `ok=false` release, apply-threw release, pre-abort release (apply skipped), mid-apply cancel release.

## Tests added or updated

- 13 new cases. Full suite: 41 files, 343/343 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The CM6 `EditorState.transactionFilter.of(...)` readonly extension and the CM6 `Decoration` StateField for both lock-mask + highlight decorations are intentionally left for F20, which is the first feature that actually applies edits through the bridge (`edit_note`). The feature spec notes "`editor/editLock.ts` (CM6 decoration/readonly)" — we deliver the controller + unit invariants today; F20 will add the thin CM6 extension factory that consumes the controller plus a `Notice` on the blocked-keystroke hook. AC5's "3s post-edit highlight" and AC3's "lock released on every exit path" are both testable at the controller layer without a live CM6 view.
- `onBlockedKeystroke` fires the `Notice` when F20 wires it — the controller today accepts an injectable callback so tests can assert the call without importing `obsidian`.

## Assumptions

- Single active lock at a time is sufficient for Phase 2; the controller throws on overlap attempts so callers don't accidentally stack locks.
- 3000 ms is the default highlight duration (feature.md §AC5 pins 3 s). Callers (F20) can override via `durationMs` when needed.
- `withLock.apply(ctx)` returns `{ok, newRange?}`. The optional `newRange` accounts for edits that grow / shrink the locked region — F20's `edit_note` will recompute the final range post-apply and surface it for the highlight.

## Open questions

None.
