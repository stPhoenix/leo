# Compliance iteration 1 — F08 editor-bridge-focused-context

## Acceptance criteria

- AC1 (CM6 extension on active editor, computes `FocusedContext` on every updateListener tick with non-null `cursor`, `selection`/empty, `viewport`): PASS — `src/editor/focusedContext.ts:27` defines `focusSnapshotField` that recomputes snapshot on `docChanged`/`selectionSet` via `snapshotFromState`, and `createFocusedContextExtension` at `src/editor/focusedContext.ts:56` attaches `EditorView.updateListener` that triggers notify on `docChanged`, `selectionSet`, or `viewportChanged`. Assembly of full `FocusedContext` (incl. viewport line range + text) at `readFocusedContextFromView` `src/editor/focusedContext.ts:45`. Covered by `tests/unit/editorBridge.test.ts` "emits a complete payload with all four fields".
- AC2 (≤ 1 emission per 300ms; final update in burst delivered): PASS — `src/editor/editorBridge.ts:52` constructs `debounce(fn, 300)`; trailing delivery verified by `tests/unit/debounce.test.ts` "delivers the final arguments of a burst" and `tests/unit/editorBridge.test.ts` "delivers the last context of a burst".
- AC3 (active-leaf-change + file-open re-attach + fresh emission / null payload): PASS — `src/editor/editorBridge.ts:67` wires `active-leaf-change`, `src/editor/editorBridge.ts:73` wires `file-open`; both call `probe.onLeafChange` / `onFileOpen`, cancel pending debounce, and emit immediately. `WorkspaceFocusProbe` at `src/editor/workspaceFocusProbe.ts:20` re-binds the last-known CM6 view on every leaf change; null-editor path returns `NULL_FOCUSED_CONTEXT` at `src/editor/workspaceFocusProbe.ts:42`. Tests: "active-leaf-change calls probe.onLeafChange and emits immediately, cancelling pending debounce", "file-open calls probe.onFileOpen and emits immediately", "emits NULL payload when probe reports no active markdown editor".
- AC4 (`editor-change` refreshes on same debounce; no double-fire vs CM6 updateListener): PASS — `src/editor/editorBridge.ts:80` registers `editor-change` handler that calls `this.notify()` (same debounce as updateListener). Shared debounce collapses both paths. Test `tests/unit/editorBridge.test.ts` "editor-change goes through debounce and does not double-fire alongside notify()" asserts a single emission after 5 interleaved pairs of `notify()` + emitted `editor-change`.
- AC5 (all three listeners via `registerEvent`, auto-teardown on `onunload`, no orphans): PASS — all three `plugin.registerEvent(...)` calls at `src/editor/editorBridge.ts:66`, `:73`, `:80`. `src/main.ts:96` wires `EditorBridge` inside `LeoPlugin.onload` (which is the Plugin instance that owns `registerEvent`), and `src/main.ts:116` calls `this.editorBridge?.dispose()` in `onunload` to cancel the pending debounce; Obsidian auto-detaches registered events on plugin unload. Test "listeners teardown on simulated unload; post-unload emissions are inert" simulates `offref` for all three registered refs and asserts zero active handlers plus zero emissions on post-unload event fires.
- AC6 (p95 ≤ 5ms microbenchmark of compute + debounce scheduling path): PASS — `tests/unit/editorBridge.test.ts` "microbenchmark: emit path stays well under 5ms budget at p95 across 200 iterations" measures `bridge.flush()` + `bridge.notify()` + `bridge.flush()` cycles with `performance.now()` and asserts `p95 < 5`.
- AC7 (unit tests cover debounce rate limit with trailing delivery, payload field completeness, listener attach/detach symmetry across all three events): PASS — debounce rate + trailing verified by `tests/unit/debounce.test.ts` "invokes only once after trailing wait" and `tests/unit/editorBridge.test.ts` "debounces bursts of notify() calls into a single emission at 300ms" + "enforces ≤ 1 emission per 300ms window across 1s burst". Payload completeness: "emits a complete payload with all four fields". Attach/detach symmetry: "registers active-leaf-change, file-open, editor-change listeners" + "listeners teardown on simulated unload; post-unload emissions are inert".

## Scope coverage

- In scope "CM6 extension exposing a `StateField` that tracks cursor position, selection range, and visible viewport line range for the focused editor": PASS — `focusSnapshotField` in `src/editor/focusedContext.ts:27` (cursor+selection) plus `readFocusedContextFromView` assembles viewport from `view.viewport` on each read.
- In scope "`FocusedContext` payload assembly (file, cursor, selection, viewport) and emission to `AgentController` through an in-memory push channel": PASS — `FocusedContextChannel` (`src/editor/focusedContextChannel.ts`) implements `FocusedContextSink` with `push` / `subscribe` / `current`; wired in `src/main.ts:91` and exposed as `plugin.focusedContext` for F09/F10 consumers.
- In scope "300ms trailing debounce on `FocusedContext` emission, capped at ≤ 1 emission per 300ms": PASS — default `debounceMs=300` at `src/editor/editorBridge.ts:35`; shared util at `src/util/debounce.ts`.
- In scope "Registration and teardown of Obsidian workspace listeners (active-leaf-change / file-open / editor-change) via `registerEvent`": PASS — `src/editor/editorBridge.ts:66`, `:73`, `:80`.
- In scope "Bridging active-leaf / file-open transitions into a fresh `FocusedContext` snapshot (null payload when there is no active markdown editor)": PASS — `WorkspaceFocusProbe.read()` at `src/editor/workspaceFocusProbe.ts:42` returns `NULL_FOCUSED_CONTEXT` when no `MarkdownView` is active; leaf/file handlers reset `this.last = null` and re-probe.
- In scope "Unit coverage for debounce timing, payload shape, and listener attach/detach symmetry": PASS — 14 bridge tests + 6 debounce tests.

## Out-of-scope audit

- Out of scope "Edit lock acquisition, readonly decorations, EditorTransaction batching": CLEAN — no edit-lock or readonly decoration code in `src/editor/*`.
- Out of scope "Inline diff accept/reject UI and atomic revert": CLEAN — no diff / revert code added.
- Out of scope "Context indicator chip UI in chat header": CLEAN — no UI changes shipped (chip UI awaits F09; `FocusedContextChannel.subscribe` is the extension hook, not a UI).
- Out of scope "Injecting `FocusedContext` into the LLM system prompt": CLEAN — `FocusedContextChannel` holds the value; no prompt assembly touches it.
- Out of scope "Canvas / non-markdown editor support": CLEAN — probe gates on `instanceof MarkdownView` and returns `NULL_FOCUSED_CONTEXT` otherwise.

## QA aggregate

Verdict: PASS (typecheck, lint, 192/192 tests, build ~189 KB all green).

## Verdict: PASS
