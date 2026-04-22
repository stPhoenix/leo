# F59 — Wire edit-lock CM6 extension + active-note edit_note bridge

## Purpose

Close the integration gap left by F18 and F20. The `EditLockController`, `HighlightController`, and `withLock` orchestrator ship as pure domain modules but are not mounted on the CodeMirror 6 editor, and the `edit_note` tool's active-note bridge in `main.ts` is a stub returning `"active-note routing not wired in iter-1"`. This feature wires the CM6 readonly decoration + highlight decoration extensions into Obsidian's editor registrar and replaces the stub bridge with a real implementation that applies edits through a live CM6 `EditorTransaction`, grouped into a single "Leo edit" undo, under the edit lock.

## Scope

### In scope

- CM6 `StateField` / `Decoration` extension that reads `EditLockController` locked ranges and marks them readonly + styled; registered via `registerEditorExtension`.
- CM6 extension producing the 3s post-edit highlight, reading `HighlightController` ranges; fades out per the controller's `expiresAt`.
- Real `EditNoteBridge.applyActiveEdit` implementation: resolves the active editor for the target file (via `workspace.getActiveViewOfType(MarkdownView)` + path match), applies the range edit through `withLock` using an `EditorTransaction`, releases the lock on failure, produces a single undo step.
- Real `EditNoteBridge.isActiveNote` returning `true` only when the target path matches an open, focused markdown editor.
- `Notice` emission on blocked keystrokes inside the locked range (routed via the existing Notifications tri-channel once F67 lands; stub `Notice` acceptable here).
- Unit tests covering: CM6 extension registers and unregisters; readonly decoration matches `EditLockController.listSnapshot()`; highlight decoration fades after `EXPIRES_AT`; `applyActiveEdit` applies a transaction and grouped undo reverts it; `isActiveNote` returns `false` when no matching editor is open.

### Out of scope

- Refactoring `EditLockController` / `HighlightController` internals (already shipped & tested in F18).
- Accept/reject inline UI (F20 ships it; this feature only provides the live bridge so the tool can trigger edits).
- Multi-editor / split-pane concurrency beyond a single active editor per file (deferred to a later slice).

## Acceptance criteria

1. All three F18 orphans (`editor/editLock.ts`, `editor/highlights.ts`, `editor/withLock.ts`) become reachable from `src/main.ts`; §5.4 audit confirms removal.
2. A CM6 extension is registered via `Plugin.registerEditorExtension` on load, unregistered (Obsidian auto) on unload.
3. Locking a range through `EditLockController.lock(file, from, to)` renders a `Decoration.mark` with `readonly` class in the target editor; keyboard input inside the range is blocked (test via simulated CM6 dispatch).
4. `HighlightController.highlight(file, from, to, 3000)` causes a `Decoration.mark` with `highlight` class to appear, then fade after the controller's TTL (timer mocked in test).
5. `edit_note` tool invocation on a path open in the active editor routes through `applyActiveEdit`, which (a) acquires the lock via `withLock`, (b) issues a single `EditorTransaction.replaceRange`, (c) releases the lock, and (d) leaves exactly one undo step labeled "Leo edit".
6. `edit_note` invocation on a path not open in any editor falls back to the vault-API path and does not touch `applyActiveEdit`.
7. On any failure inside `applyActiveEdit` (e.g., `replaceRange` throws), the lock is released via the `withLock` finally block and no decoration remains.
8. All existing tests stay green; new tests added per §Scope.

## Dependencies

F08 (editor bridge) · F18 (edit lock domain) · F20 (edit_note tool). All `feature-complete`. This feature wires the CM6 mount + replaces the stub bridge.

## Implementation notes

- [Architecture §3.4 Adapters — CM6](../../../../architecture/architecture.md#34-adapters) — CM6 extensions live in `src/editor/` and are registered from `main.ts`.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — lock release on all failure paths.
- [Tech stack — Editor APIs](../../../../standards/tech-stack.md#platform-apis) — `EditorTransaction` is the grouped-undo primitive; `registerEditorExtension` is the mount point.
- F20 `compliance-1.md` records the stub bridge and calls out iter-2 as the replacement slot; this feature is the iter-2 successor.
- The CM6 extensions must subscribe to the existing controllers rather than re-implementing state; use the subscribe/listener APIs F18 already exposes.

## Open questions

- Should the readonly decoration visually distinguish lock-held-by-tool vs lock-held-by-user (e.g., distinct CSS classes)? Default: single class, visual styling left to CSS variables.
- Do we surface a Notice every time a blocked keystroke is attempted, or only on the first in a rolling window? Default: first-in-300ms, throttled.
