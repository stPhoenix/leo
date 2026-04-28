# F18 — Edit lock & grouped transactions

## Purpose

Give `EditorBridge` the mutation half it was missing: once F08 is tracking Focused Context, F18 wires the write path so a programmatic range edit lands as a single user-visible step, under a lock that keeps human and agent out of each other's way. Every agent-driven mutation is applied via `Editor.replaceRange()` grouped inside one [`EditorTransaction`](../../../../standards/tech-stack.md#platform-apis) so it collapses to one "Leo edit" undo entry per [FR-EDIT-05](../../context.md#fr-edit-05); a CM6 readonly decoration over the target range blocks user keystrokes with a `Notice` per [FR-EDIT-06](../../context.md#fr-edit-06); the lock is released on accept, reject, cancel, and failure paths per [FR-EDIT-07](../../context.md#fr-edit-07); the modified region flashes a highlight for 3s after the edit lands per [FR-EDIT-08](../../context.md#fr-edit-08); and the whole pipeline satisfies the atomic-edit invariant [NFR-REL-02](../../context.md#nfr-rel-02) and the must-release-on-any-failure-path invariant [NFR-REL-04](../../context.md#nfr-rel-04).

## Scope

### In scope

- Apply programmatic range edits through `Editor.replaceRange()` wrapped in a single [`EditorTransaction`](../../../../standards/tech-stack.md#platform-apis) so the resulting undo stack shows exactly one "Leo edit" step per [FR-EDIT-05](../../context.md#fr-edit-05).
- CM6 readonly decoration installed over the target range for the lifetime of the lock, living in `editor/editLock.ts` per the [Architecture §9 layout](../../../../architecture/architecture.md#9-project-file-layout-proposed), per [FR-EDIT-06](../../context.md#fr-edit-06).
- `Notice` surfaced on any user keystroke that targets the locked range per [FR-EDIT-06](../../context.md#fr-edit-06).
- 3s post-edit highlight decoration on the modified region that auto-clears on timer per [FR-EDIT-08](../../context.md#fr-edit-08).
- Lock released on all four exit paths (accept / reject / cancel / failure) via a `try { apply } finally { release }` [`EditorBridge.withLock(range, fn)` wrapper](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules), per [FR-EDIT-07](../../context.md#fr-edit-07) and [NFR-REL-04](../../context.md#nfr-rel-04).
- Atomic-edit invariant: if the transaction throws, no partial mutation is visible and the lock is released per [NFR-REL-02](../../context.md#nfr-rel-02) (matches the [§7 "CM6 edit rejected" row](../../../../architecture/architecture.md#7-error-handling-strategy)).
- Unit coverage for lock acquire/release symmetry on every exit path, single-undo-step invariant after transaction commit, keystroke-block `Notice`, and 3s highlight timer.

### Out of scope

- Agent-triggered edit tool wrapper (`edit_note` with live apply through the bridge) — ships with F20 `tool-edit-note-with-lock`.
- Inline diff accept/reject UI and atomic revert — ships with F20 `tool-edit-note-with-lock`.
- Active-note tool gating (deciding when `edit_note` routes through the bridge vs. `VaultAdapter`) — ships with F20 `tool-edit-note-with-lock`.

## Acceptance criteria

1. A programmatic edit applied through `EditorBridge.withLock(range, fn)` issues exactly one [`EditorTransaction`](../../../../standards/tech-stack.md#platform-apis) so the resulting undo stack collapses to a single "Leo edit" step, and `Editor.undo()` after the edit restores pre-edit content in one hop, per [FR-EDIT-05](../../context.md#fr-edit-05).
2. While the lock is held, a CM6 readonly decoration covers the target range and any user keystroke intersecting it is blocked with a `Notice`, per [FR-EDIT-06](../../context.md#fr-edit-06).
3. The lock is released on every exit path — accept, reject, cancel, and failure — via the `finally` branch of [`EditorBridge.withLock`](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules), with unit coverage asserting symmetry (one acquire ↔ one release) on each path, per [FR-EDIT-07](../../context.md#fr-edit-07) and [NFR-REL-04](../../context.md#nfr-rel-04).
4. When the transaction throws mid-apply, no partial text change is observable and the lock is released in the same tick, satisfying the atomic-edit invariant, per [NFR-REL-02](../../context.md#nfr-rel-02).
5. On successful accept, the modified region receives a highlight decoration that auto-clears 3 seconds later (timer cancelled on view detach), per [FR-EDIT-08](../../context.md#fr-edit-08).
6. The `AbortController` cancel path (F07/F10 stream cancel while an edit is in flight) releases the lock in `finally` and leaves the buffer in its pre-edit state, per [FR-EDIT-07](../../context.md#fr-edit-07) and the [§5.6 Cancellation rule "Active edit locks released in finally on every exit path"](../../../../architecture/architecture.md#56-cancellation).
7. Unit tests cover: single-undo-step invariant, readonly-decoration keystroke blocking + `Notice` fire, 3s highlight timer firing and cancel-on-detach, lock-release symmetry across accept/reject/cancel/throw, per [FR-EDIT-05](../../context.md#fr-edit-05), [FR-EDIT-06](../../context.md#fr-edit-06), [FR-EDIT-07](../../context.md#fr-edit-07), [FR-EDIT-08](../../context.md#fr-edit-08), [NFR-REL-02](../../context.md#nfr-rel-02), [NFR-REL-04](../../context.md#nfr-rel-04).

## Dependencies

- [F08 editor-bridge-focused-context](../editor-bridge-focused-context/feature.md) — the CM6 extension host and `EditorBridge` module this feature extends; F18 adds `editLock.ts` + `highlights.ts` alongside F08's `focusedContext.ts` per the [Architecture §9 editor/ layout](../../../../architecture/architecture.md#9-project-file-layout-proposed).
- Drives directly from [FR-EDIT-05](../../context.md#fr-edit-05), [FR-EDIT-06](../../context.md#fr-edit-06), [FR-EDIT-07](../../context.md#fr-edit-07), [FR-EDIT-08](../../context.md#fr-edit-08), [NFR-REL-02](../../context.md#nfr-rel-02), [NFR-REL-04](../../context.md#nfr-rel-04).

## Implementation notes

- [Architecture §3.4 Adapters — EditorBridge](../../../../architecture/architecture.md#34-adapters) — "Applies edits under edit lock with decorations. Try/finally ensures lock release." pins this feature's contract.
- [Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation) — "Active edit locks released in `finally` on every exit path" is the authoritative rule for F18's release semantics.
- [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy) — "CM6 edit rejected → Lock released; edit reverted; Notice." names the exact failure recovery shape.
- [Architecture §9 Project File Layout](../../../../architecture/architecture.md#9-project-file-layout-proposed) — `editor/editLock.ts` (CM6 decoration/readonly) and `editor/highlights.ts` are where this lands.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — `EditorBridge.withLock(range, fn)` guarantees release in `finally`; F18 is the implementation.
- [Architecture §1 Architectural Principles — Fail-safe editor ops](../../../../architecture/architecture.md#1-architectural-principles) — every EditorBridge edit try/finally wrapped to guarantee lock release per NFR-REL-04.
- [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — `Editor` + CM6 with `Decorations for edit lock + highlight` is the stated host; `Notice` is the user-visible error channel.
- [Code style — CodeMirror 6](../../../../standards/code-style.md#codemirror-6) — "Edit lock: always `try { apply } finally { release }`. Never early-return with lock held." is the exact invariant this feature must meet; decorations built in `RangeSet`, never mutated in place.
- [Code style — Error Handling](../../../../standards/code-style.md#error-handling) — "Release resources (locks, subscriptions, IndexedDB txns) in `finally`" applies verbatim.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — `Notice` is the channel for the blocked-keystroke user-visible message.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — structured `event: "editor.lock.*"` log entries (acquire/release/blocked-keystroke) at `debug` level give observable checkpoints.

## Open questions

- None. Acceptance criteria and implementation notes exhaust this feature's scope; no decisions are deferred at this slice.
