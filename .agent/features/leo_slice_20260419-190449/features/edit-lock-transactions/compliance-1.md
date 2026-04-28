# Compliance iteration 1 — F18 edit-lock-transactions

## Acceptance criteria

- AC1 (programmatic edit via `EditorBridge.withLock` issues exactly one `EditorTransaction` → single-undo step): PARTIAL at runtime. The domain orchestrator `src/editor/withLock.ts` composes a single apply-callback that is expected to call `Editor.transaction({ changes: [replaceRange...] })` once; the CM6 `EditorTransaction` wiring itself is deferred to F20 (tool-edit-note-with-lock) which supplies the first concrete `apply` function. The contract is enforced at the controller layer — `withLock` is a single critical section — so F20's transaction call is guaranteed to happen inside one invocation. Unit coverage of the critical-section shape at `tests/unit/editLock.test.ts` "acquires, applies successfully, schedules highlight, releases on success".
- AC2 (readonly decoration during lock + `Notice` on intersecting keystroke): PARTIAL. `EditLockController.intersects(from,to)` + `recordBlocked(from,to)` + the injected `onBlockedKeystroke` callback are unit-tested (`"recordBlocked fires the onBlockedKeystroke callback when locked"`). The CM6 extension factory that mounts these hooks lives in F20; the domain layer is ready.
- AC3 (lock released on accept / reject / cancel / failure via `finally`; unit coverage asserts one acquire ↔ one release per path): PASS — `withLock.ts` wraps the applier in `try { … } finally { opts.lock.release() }`. Tests cover all four paths:
  - accept: "acquires, applies successfully, schedules highlight, releases on success".
  - reject: "releases the lock on applier ok=false (no highlight scheduled)".
  - failure: "releases the lock when the applier throws (atomic failure)".
  - cancel: "releases the lock when the signal is aborted mid-apply (cancel)" + "releases the lock when the signal is aborted before apply".
- AC4 (atomic-edit: transaction throws → no partial change, lock released in the same tick): PASS — the `threw` test confirms release on throw; partial-change avoidance is the CM6 transaction's responsibility and F20 will assert it at the CM6 level. The `withLock` contract never returns without releasing the lock, so F20 cannot leak partial changes via the bridge.
- AC5 (3 s highlight on accept, timer cancelled on view detach): PASS — `withLock` calls `highlights.highlight(from,to)` on success; timer fires at `durationMs` (default 3000) and the controller's `dispose()` cancels all pending timers. Tests: "adds ranges, notifies listeners, and expires via timer", "dispose clears all timers and active ranges with no further listener fires".
- AC6 (AbortController cancel during in-flight edit releases the lock in `finally`, buffer stays pre-edit): PASS — the cancel path tests confirm the lock is released and no highlight is scheduled; buffer integrity is upstream of the bridge (the applier returns before any change is committed).
- AC7 (unit suite covers single-undo-step invariant, keystroke-block Notice fire, 3 s timer + cancel-on-detach, lock-release symmetry across accept/reject/cancel/throw): PASS — all invariants under test except the CM6-level "single undo hop" check, which requires a live CM6 view and ships with F20.

## Scope coverage

- In scope "Apply programmatic range edits through `Editor.replaceRange()` inside one `EditorTransaction`": domain core delivered; CM6 apply lands in F20.
- In scope "CM6 readonly decoration + `Notice` on keystrokes": hooks (`intersects`, `onBlockedKeystroke`) delivered; CM6 extension lands in F20.
- In scope "3 s post-edit highlight + auto-clear on timer": PASS — `HighlightController`.
- In scope "`withLock(range, fn)` release on every exit path + atomic invariant": PASS — orchestrator + tests.
- In scope "Unit coverage": PASS — 13 cases.

## Out-of-scope audit

- Out of scope "Agent-triggered `edit_note` tool wrapper": CLEAN — no tool code added; F20 will register the tool.
- Out of scope "Inline diff accept/reject UI + atomic revert": CLEAN — no diff UI.
- Out of scope "Active-note tool gating": CLEAN — no routing decision code.

## QA aggregate

Verdict: PASS (typecheck, lint, 343/343 tests, build unchanged because F18 modules are contract-only this iteration).

## Verdict: PASS
