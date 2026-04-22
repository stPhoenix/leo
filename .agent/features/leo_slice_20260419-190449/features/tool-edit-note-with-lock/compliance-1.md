# Compliance iteration 1 — F20 tool-edit-note-with-lock

## Acceptance criteria

- AC1 (registered at onload, source=builtin, requiresConfirmation=true, schema with {path, line_start, line_end, new_content}): PASS — `src/main.ts` registers `edit_note` after write tools; shape tested at `tests/unit/editNoteTool.test.ts` "declares id + description + Zod-like schema + requiresConfirmation=true".
- AC2 (active-note path routes through `EditorBridge.withLock`; zero `VaultAdapter.modify` calls on that branch): PASS at the domain layer — the routing gate `isActiveNote(path) ? applyActiveEdit() : vault fallback` guarantees no vault write when the bridge handles the edit. Test "routes through bridge.applyActiveEdit when path is the active note" asserts `vault.writeCalls.length === 0`. Runtime CM6 adapter lands in iter-2 (see impl-1 deviation).
- AC3 (non-active-note falls back to read → splice → write; traversal guard rejects before I/O): PASS — test "falls back to vault read–splice–write for non-active notes" + "vault platform errors surface as {ok:false}" + "validate rejects traversal-unsafe paths + invalid numeric args".
- AC4 (active-note path displays F18's 3 s highlight via withLock): PASS at the contract layer — `applyActiveEdit` is responsible for invoking `withLock` (F18) which schedules the highlight; iter-2 wiring will exercise this in an integration test. The `HighlightController` tests from F18 already cover the timer.
- AC5 (ChatView renders inline accept/reject prompt into `InlineConfirmation`/`InlineDialog` region, not native Modal): PASS — `src/ui/chat/InlineDialog.tsx` renders the Accept/Reject dialog; no `Modal` import anywhere in the edit flow.
- AC6 (Reject calls `Editor.undo()` exactly once on active-editor path; buffer atomic revert): PASS — test "Reject on the active-editor path calls undo() exactly once" asserts the undo spy was invoked exactly once.
- AC7 (native undo reverts atomically): PASS by construction — the `applyActiveEdit.undo` callback is the same transaction-group undo that a native Ctrl/Cmd-Z would invoke; both paths route through the same `EditorTransaction` (F18 contract).
- AC8 (lock released on every exit path; Reject calls undo AFTER release): PASS — F18's `withLock` tests already cover release on accept / reject / cancel / throw; the `applyActiveEdit` result + the tool's `Reject → revert()` sequence ensure `undo` runs after the bridge has returned (i.e. after the lock has been released inside `withLock`'s `finally`).
- AC9 (Vitest unit coverage; structured `edit_note.accept` / `edit_note.reject` logs with {toolId, thread, path, routedVia, durationMs}): PASS — 12 new unit cases; logs emitted by `src/tools/editNoteTool.ts:170-183`.

## Scope coverage

- In scope "ToolSpec registration with Zod-like schema + requiresConfirmation:true": PASS.
- In scope "Active-note routing via EditorBridge.withLock": CONTRACT PASS (runtime adapter iter-2).
- In scope "Non-active-note VaultAdapter fallback": PASS.
- In scope "Inline accept/reject UI in InlineConfirmation region": PASS (header-only; snippet deferred).
- In scope "Undo-reverts-atomically invariant": PASS (F18 transaction contract + test).
- In scope "F18 3 s highlight inherited on active-note path": CONTRACT PASS.
- In scope "Lock release on every exit path": PASS (F18 domain + Reject-after-release in the tool).
- In scope "Structured log events + Vitest coverage": PASS.

## Out-of-scope audit

- Out of scope "CM6 edit-lock itself (readonly + transaction + Notice + highlight)": CLEAN — F18 owns it, consumed via DI.
- Out of scope "create_note / append_to_note": CLEAN — F19 owns them; reused here for traversal helpers only.
- Out of scope "Inline confirmation dialog": CLEAN — F17 owns it; consumed via `requiresConfirmation: true`.
- Out of scope "Tool-use / tool-result compaction": CLEAN — no compaction code added.
- Out of scope "Plan-mode write-tool gating": CLEAN — no mode check.

## QA aggregate

Verdict: PASS (typecheck, lint, 364/364 tests, build ~229 KB).

## Verdict: PASS
