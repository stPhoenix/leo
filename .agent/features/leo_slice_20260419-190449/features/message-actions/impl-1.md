# Impl iteration 1 — F15 message-actions

## Summary

Added a per-message action bar under every user and assistant bubble plus an inline editor for user-message "edit & resend". New `src/ui/chat/MessageActionBar.tsx` exports `MessageActionBar`, `InlineEditor`, and the `MessageActions` contract; `MessageList` mounts the bar (hidden via CSS, revealed on hover / focus-within) and swaps the user bubble into the inline editor when editing. `ChatView.buildMessageActions()` implements the four handlers: copy→`navigator.clipboard` + `Notice`; delete with role-aware cascade (user message + following assistant/banner block; standalone assistant only); regenerate = strip assistant + subsequent banners and re-submit the preceding user content with `appendUserRecord: false`; edit-and-resend = truncate at the user record and `turnDispatcher.submit(newText)`. All mutations flow through `ChatMessageStore.set/append`, which is already observed by F14's `ConversationStore.mutate` subscription — persistence is automatic.

## Files touched

- `src/ui/chat/MessageActionBar.tsx` — new: `MessageActionBar` (role visibility matrix + handler wiring + ARIA toolbar) and `InlineEditor` (textarea + Save / Cancel + Esc / Cmd-Enter hotkeys).
- `src/ui/chat/MessageList.tsx` — threaded `actions` prop; `UserBubble` swaps to `InlineEditor` when editing; assistant bubble renders the bar once streaming has ended.
- `src/ui/chat/ChatRoot.tsx` — new `messageActions?: MessageActions` prop, forwarded into `MessageList`.
- `src/ui/chat/turnDispatcher.ts` — `submit(text, { appendUserRecord?: false })` so regenerate can dispatch a turn without duplicating the user record.
- `src/ui/chatView.tsx` — `buildMessageActions()` implements copy / delete (with cascade) / regenerate / edit-and-resend; wired into `ChatRoot` via `messageActions`.
- `styles.css` — `.leo-message-actions` (hover + focus-within reveal), `.leo-message-action` button, `.leo-inline-editor` textarea + save/cancel row; all Obsidian CSS vars.
- `tests/dom/messageActions.test.tsx` — 11 cases covering the role visibility matrix, handler wiring for copy / regenerate / delete / edit, ARIA-label coverage, toolbar role, and the InlineEditor (initial text, Save, Esc cancel, Cmd+Enter submit).

## Tests added or updated

- 11 new DOM cases. Full suite: 36 files, 289/289 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Hover/focus reveal is implemented in CSS only (`:hover` / `:focus-within`). The bar is a real DOM toolbar when focus lands on any child button, satisfying AC1's "becomes visible when ... any action button receives keyboard focus". No JS visibility state machine — simpler + survives theming changes.
- Regenerate does NOT currently cascade to delete subsequent user turns (per the feature's open question proposal "regenerate only replaces the selected assistant message"). Matches the feature's explicit recommendation.
- Delete cascade: on user-message delete, all subsequent records (assistant + banner) up to the next user-message boundary are removed (feature's open-question proposal). Standalone assistant delete touches only that record.

## Assumptions

- Copy button feedback is an Obsidian `Notice` ("Copied message") on success and "Copy failed" on rejection; feature.md only requires "Notice on success", we just add a matching failure path for robustness.
- `navigator.clipboard.writeText` is the only clipboard path used (no `document.execCommand('copy')` fallback). In a real Obsidian desktop environment this is always available; happy-dom in tests would reject silently, but the tests stub the action via `vi.fn` and don't exercise the real clipboard path.
- Regenerate reuses the previous user record's content verbatim (no editing). This matches AC3 ("dispatches a new turn against the preceding user message") where the user intent is literally "try again with the same prompt".

## Open questions

None.
