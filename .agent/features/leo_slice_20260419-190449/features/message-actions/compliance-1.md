# Compliance iteration 1 — F15 message-actions

## Acceptance criteria

- AC1 (invisible by default, visible on hover / focus, never obscures content): PASS — `styles.css` `.leo-message-actions { display: none }` by default; `.leo-bubble:hover .leo-message-actions, .leo-bubble:focus-within .leo-message-actions { display: flex }`. `MessageActionBar` renders a flat `<div role="toolbar">` inside the bubble after the body / usage footer so it never overlays.
- AC2 (Copy on both roles via `navigator.clipboard.writeText` + Obsidian `Notice`): PASS — Copy button in the action bar is unconditional (`src/ui/chat/MessageActionBar.tsx:28-39`); handler in `ChatView.buildMessageActions().copy` uses `navigator.clipboard.writeText(record.content)` and raises `new Notice('Copied message')` on success. Test `tests/dom/messageActions.test.tsx` "copy button invokes actions.copy with the record".
- AC3 (Regenerate assistant-only; strips selected assistant and dispatches new turn): PASS — Regenerate button renders only when `isAssistant` (`MessageActionBar.tsx:41-52`); `ChatView.buildMessageActions().regenerate` locates the preceding user, strips the selected assistant plus any trailing banners, then calls `turnDispatcher.submit(userText, { appendUserRecord: false })` to avoid duplicate user records. Tests: "assistant bubble: shows copy + regenerate + delete; no edit", "regenerate button invokes actions.regenerate with the id (assistant)".
- AC4 (Edit-and-resend user-only; inline editor swap; truncate + enqueue on Save; Cancel restores byte-for-byte): PASS — Edit button renders only when `isUser` and `editAndResend` is wired (`MessageActionBar.tsx:53-63`); `MessageList.UserBubble` swaps to `InlineEditor` when `editing===true`; Save calls `editAndResend(id, text)` which truncates at the user record and calls `turnDispatcher.submit(newContent)` (default appends user). Cancel calls `onFinishEdit` without mutating the store, so the original bubble is restored untouched. Tests: "user bubble: shows copy + edit + delete; no regenerate", "edit button fires onStartEdit with id (user)", "Escape cancels the editor".
- AC5 (Delete on both; user-delete cascades to following assistant/banner turn): PASS — `ChatView.buildMessageActions().delete` at `src/ui/chatView.tsx:181-195` scans forward from the user record until it hits the next `role === 'user'` and removes the whole contiguous block; assistant delete removes only that record. Tests: "delete button invokes actions.delete with id on both roles".
- AC6 (persistence through F14 `ConversationStore.mutate`; post-mutation state survives reload): PASS — every handler writes via `ChatMessageStore.set` / `.append` (regenerate / delete / edit-and-resend). `main.ts:110-116` wires a `ChatMessageStore.subscribe` that calls `ConversationStore.mutate(...)` on every change, which debounces a save. On reload, F14's `load()` hydrates the store from the persisted JSON. F14's `conversationStore.test.ts` "round-trips messages across save + load" already covers the load-after-mutation path; F15 inherits it.
- AC7 (real `<button>`s, ARIA labels, tab-reachable, Enter/Space activation, focus ring): PASS — every action is a real `<button type="button">` with `aria-label`; the toolbar carries `role="toolbar"` + `aria-label="message actions"`; focus ring is `.leo-message-action:focus-visible` using `var(--interactive-accent)`. Tests: "every action button is a <button> with an aria-label", "the toolbar carries role=\"toolbar\" and an aria-label".

## Scope coverage

- In scope "`MessageActionBar` mounted on each bubble with hover/focus visibility": PASS — see AC1.
- In scope "Copy / Regenerate / Edit-and-resend / Delete with per-role visibility": PASS — see AC2–AC5.
- In scope "Keyboard reachability (real buttons, Enter/Space, focus ring, aria-label)": PASS — see AC7.
- In scope "Persistence routed through F14": PASS — see AC6.
- In scope "Unit coverage for the action matrix, handlers, persistence, keyboard audit": PASS — 11 new cases, existing F14 tests cover the save round-trip.

## Out-of-scope audit

- Out of scope "Streaming cancel (Stop button, AbortController)": CLEAN — no change to `StreamingTurnController`; Delete does not call `stop()`.
- Out of scope "Compaction / snapshot mutations": CLEAN — no `CompactionEngine` code added.
- Out of scope "Thread CRUD": CLEAN — actions operate on the single thread; no thread create/switch/rename affordance added.

## QA aggregate

Verdict: PASS (typecheck, lint, 289/289 tests, build ~212 KB).

## Verdict: PASS
