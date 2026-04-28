# Compliance iteration 1 — F59 wire-edit-lock-cm6

## Acceptance criteria

- AC1 (editLock / highlights / withLock reachable from main.ts): PASS — all three files removed from the orphan list (25 → 22). `main.ts` now imports `EditLockController`, `HighlightController`, `createLockDecorationExtension`, and `createActiveNoteEditBridge`; `withLock` is reached via `activeNoteEditBridge`.
- AC2 (CM6 extension registered on load, unregistered on unload): PASS — `main.ts` calls `this.registerEditorExtension(createLockDecorationExtension(...))`; Obsidian auto-removes registered editor extensions on plugin unload.
- AC3 (readonly decoration renders and blocks keystrokes inside locked range): PASS — `cm6LockDecoration.ts:23-36` renders `leo-edit-lock-range` mark; `beforeinput` handler at `cm6LockDecoration.ts:82-98` calls `preventDefault` when the selection intersects the lock range and calls `lock.recordBlocked`. Domain behaviour is pure TS and covered by existing `tests/unit/editLock.test.ts` (recordBlocked → onBlockedKeystroke invocation).
- AC4 (highlight decoration fades after controller TTL): PASS — `HighlightController` fires a timer per-range (F18-shipped module) which removes the range from `list()`; the ViewPlugin rebuilds decorations on the controller's `subscribe` callback; existing `tests/unit/highlightController.test.ts`-equivalent logic in the `editLock.test.ts` suite covers the TTL path. The active test "writes the range under the lock and releases" additionally asserts `highlights.list().length === 1` post-edit (pre-TTL).
- AC5 (edit_note through active editor: lock + transaction + release + single undo): PASS — `activeNoteEditBridge.ts:67-98` acquires the lock via `withLock`, issues `editor.transaction(...)` with a single `changes` entry labelled `leo-edit`, then releases via the `withLock` `finally` block. Test "writes the range under the lock and releases" asserts exactly one write op and lock released.
- AC6 (edit_note on non-active path falls back to vault-API): PASS — `createEditNoteTool` (F20, existing) invokes the vault path whenever `bridge.isActiveNote(path) === false`; `activeNoteEditBridge.isActiveNote` returns false for unresolved paths (test "isActiveNote is true only when resolver returns an editor").
- AC7 (failure path releases lock): PASS — `withLock` `finally` calls `lock.release()` (F18 module, shipped); test "returns ok=false and releases the lock when the signal aborts before apply" covers the abort branch. `try`/`catch` inside `withLock` also routes thrown errors through the release.
- AC8 (all existing tests stay green + new coverage): PASS — 1030/1030; 5 new tests in `activeNoteEditBridge.test.ts`.

## Scope coverage

- In scope "CM6 extension that reads EditLockController locked ranges and marks them readonly": PASS — `cm6LockDecoration.ts`.
- In scope "CM6 extension producing 3s highlight": PASS — same file; highlight rebuild is driven by `HighlightController.subscribe`.
- In scope "Real EditNoteBridge.applyActiveEdit": PASS — `activeNoteEditBridge.ts`.
- In scope "Real EditNoteBridge.isActiveNote": PASS — resolver-based.
- In scope "Notice on blocked keystrokes": PASS — `main.ts:148` passes `onBlockedKeystroke: () => new Notice(...)` into the controller.
- In scope "Unit tests": PASS — 5 new; domain-layer edge cases delegated to existing F18 suite.

## Out-of-scope audit

- Out of scope "EditLockController / HighlightController internals": CLEAN — not modified.
- Out of scope "Accept/reject inline UI (F20 already ships)": CLEAN — not touched.
- Out of scope "Multi-editor / split-pane concurrency": CLEAN — bridge uses first-match resolver; no new concurrency primitives.

## QA aggregate

`qa-1.md` verdict: `PASS` (typecheck, lint, 1030/1030 tests, build 346 KB).

## Integration gate (§5.3.1)

New public modules under `src/`:
- `src/editor/cm6LockDecoration.ts` — anchor `createLockDecorationExtension` → `main.ts:35, 178-182` ✓
- `src/editor/activeNoteEditBridge.ts` — anchors `createActiveNoteEditBridge`, `ActiveMarkdownResolver`, `EditorLike` → `main.ts:36-40, 173-177, 184-189` ✓

Both modules reachable from the entry point. Gate PASS.

## Verdict: PASS
