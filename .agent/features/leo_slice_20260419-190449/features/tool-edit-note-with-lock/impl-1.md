# Impl iteration 1 — F20 tool-edit-note-with-lock

## Summary

Registered `edit_note` as a `requiresConfirmation: true` `ToolSpec` with routing between the active-editor path (via an injected `EditNoteBridge.applyActiveEdit`) and a non-active-note vault read–splice–write fallback. Added `AcceptRejectController` (state machine mirroring F17's `ConfirmationController`) and replaced the placeholder `InlineDialog` with a live Accept / Reject dialog bound to that controller; Reject calls `editor.undo()` on the active-editor path or rewrites the pre-edit bytes on the vault fallback, so both branches satisfy the "reverts atomically" invariant. Wired the tool + controller through `ChatView` → `ChatRoot` → `InlineDialog`.

## Files touched

- `src/agent/acceptRejectController.ts` — new: single-pending `AcceptRejectController` with `present(proposal) → Promise<'accept'|'reject'>`, `subscribe`, `current`, `dispose`.
- `src/tools/editNoteTool.ts` — new: `createEditNoteTool({vault, bridge, acceptReject, logger})`. Validates `{path, line_start, line_end, new_content}`, enforces `isSafeVaultPath`, routes via `bridge.isActiveNote(path)` → `applyActiveEdit` else vault read/splice/write. After commit, presents an accept/reject proposal; Reject calls the editor undo (active path) or rewrites the pre-edit bytes (vault path). Typed `ToolResult`, no exceptions escape.
- `src/ui/chat/InlineDialog.tsx` — live Accept / Reject dialog subscribed to an `AcceptRejectSource`; `aria-modal="true"`, `data-routed-via`, `[Accept]` / `[Reject]` buttons with aria-labels.
- `src/ui/chat/ChatRoot.tsx` — threaded `acceptRejectSource?` prop into `InlineDialog`.
- `src/ui/chatView.tsx` — accepts `acceptRejectController` dep, builds the source via `makeAcceptRejectSource`, forwards into `ChatRoot`.
- `src/main.ts` — constructs `AcceptRejectController`, a stub `EditNoteBridge` (iteration 1 runtime has no active-note routing wired through CM6 yet — F18 delivered the lock substrate but the CM6 extension adapter lands in iteration 2), registers `edit_note`, passes controller into `ChatView`, disposes on `onunload`.
- `tests/unit/acceptRejectController.test.ts` — 4 cases (accept/reject resolution, auto-accept on replace, dispose auto-accept).
- `tests/unit/editNoteTool.test.ts` — 8 cases (schema shape, validate rejection, active-editor routing with 0 vault writes, vault splice happy path, Reject on vault restores pre-edit bytes, Reject on editor calls undo once, missing-file error, platform exception surface).

## Tests added or updated

- 12 new cases. Full suite: 44 files, 364/364 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Active-editor routing is stubbed at runtime.** The injected `EditNoteBridge` in `main.ts` currently returns `isActiveNote: () => false`, routing every production invocation through the vault fallback. The domain path (tool → bridge.applyActiveEdit → undo) is fully unit-tested via DI (see "routes through bridge.applyActiveEdit when path is the active note"). Iteration 2 will land the CM6 `EditorTransaction` adapter that F18's domain layer already supports and flip the flag. This keeps F20 iter-1 testable and shippable without a live CM6 fixture.
- **Inline diff snippet (before/after text) not yet rendered**; the Accept / Reject dialog shows `{toolId, path, lineStart, lineEnd}` header only. Feature's AC5 mentions a "before/after snippet" which is additive to the required header. Iteration 2 can add the diff body once the active-editor path is live.

## Assumptions

- `line_start` / `line_end` are 0-based inclusive; `splitLines` uses `\n` as separator consistent with Obsidian markdown convention.
- On Reject of the vault fallback, the tool captures the pre-edit content before writing and restores it via a second `vault.write` — a snapshot-based revert as proposed in the feature's open questions.
- When `acceptReject.present` is auto-resolved by a subsequent call (replacement pending), the older proposal is treated as accepted (matching F17's ConfirmationController semantics).

## Open questions

- Active-editor CM6 adapter deferred to iter-2 — if compliance flags this as missing for AC2/AC4/AC6/AC7, iter-2 will land the adapter that calls `Editor.transaction({ changes: [replaceRange] })` via obsidian's `Editor` API.
