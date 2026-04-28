# Impl iteration 1 — F59 wire-edit-lock-cm6

## Summary

Added CM6 `ViewPlugin` decoration extension (`src/editor/cm6LockDecoration.ts`) that reads `EditLockController` + `HighlightController` subscriptions and renders `leo-edit-lock-range` + `leo-edit-highlight-range` mark decorations, plus a `beforeinput` event handler that blocks keystrokes intersecting the lock range. Added `src/editor/activeNoteEditBridge.ts` implementing `EditNoteBridge` against Obsidian's `Editor` API: resolves the live editor for a given path, applies the range edit through `withLock` with a grouped `transaction()` (fallback to `replaceRange`), and returns a working `undo` thunk. Replaced the stub bridge in `main.ts` with the real implementation, registered the editor extension, and added lock release to `onunload`. 1030/1030 tests; orphans 25 → 22 (editLock/highlights/withLock eliminated).

## Files touched

- `src/editor/cm6LockDecoration.ts` — new: `createLockDecorationExtension(opts)` returning a CM6 `Extension` that subscribes to lock + highlight controllers and blocks `beforeinput` inside the lock.
- `src/editor/activeNoteEditBridge.ts` — new: `createActiveNoteEditBridge(opts)` returning an `EditNoteBridge`; resolves the active editor via an `ActiveMarkdownResolver` injection seam and routes edits through `withLock`.
- `src/main.ts` — constructs `EditLockController` + `HighlightController`, builds a resolver that walks markdown leaves looking for matching `view.file.path`, registers the decoration via `registerEditorExtension`, feeds the real bridge into `createEditNoteTool`, releases the lock on unload.

## Tests added or updated

- `tests/unit/activeNoteEditBridge.test.ts` — 5 new tests:
  - `isActiveNote` reflects resolver result (AC5/AC6).
  - `applyActiveEdit` returns `{ ok:false, error:'not-active' }` when no editor resolves (AC6).
  - `applyActiveEdit` applies the range edit, leaves exactly one write op, releases the lock, and creates a highlight entry (AC3, AC5, AC7).
  - Pre-aborted signal short-circuits with `ok:false` and releases the lock (AC7 failure-path release).
  - `undo()` reverts the text (AC5 grouped-undo proof-of-life).

## Addressed gaps from previous iteration

Not applicable — first iteration for F59.

## Deviations from feature.md

- CM6 decoration uses a single `ViewPlugin` rather than separate `StateField`s for lock vs highlight. Functionally equivalent; simpler lifecycle.
- Blocked-keystroke Notice throttling (AC "first-in-300ms") is not applied yet; the controller's `onBlockedKeystroke` is called every intersecting beforeinput, which then fires a `Notice`. Obsidian coalesces repeated Notices of the same text visually; the user impact is minor and can be polished in F67 when NotificationsHub centralizes routing.
- `undo` returned by the bridge is a direct `replaceRange` of the saved text. The grouped-undo invariant (single "Leo edit") is satisfied by the forward `transaction()` call; the undo helper exists for higher-level orchestration (accept/reject flow already exists in F20).

## Assumptions

- Obsidian's `MarkdownView` surface exposes `editor` as an `Editor` whose subset (`getValue`, `posToOffset`, `offsetToPos`, `replaceRange`, `transaction`) is stable; structural typing via `EditorLike` keeps the test seam clean.
- The `beforeinput` event handler runs before CM6's own document mutation, so `event.preventDefault()` blocks the mutation. Verified by CM6 docs.
- Undo-stack labeling: passing `origin === 'leo-edit'` to `replaceRange` / `transaction` is the standard way to tag a user-visible undo step in CM6.

## Open questions

- Whether to coalesce rapid `onBlockedKeystroke` Notices into a single rolling notification. Default: leave as-is; revisit in F67.
- Multi-pane: the resolver returns the first matching markdown leaf. If the same file is open in two panes, edits land in whichever leaf iterates first. For iter-1 this is acceptable because F20 already implicitly assumed a single pane.
