# F15 — Per-message actions

## Purpose

Augment every message bubble rendered by [F05 chat-message-list-markdown](../chat-message-list-markdown/feature.md) with a per-message action bar exposing **copy content**, **regenerate** (assistant only), **edit-and-resend** (user only), and **delete**, per [FR-CHAT-07](../../context.md#fr-chat-07). Assistant messages remain non-inline-editable — regenerate replaces the message via a new turn; user messages open an inline editor that, on submit, truncates the thread at that point and resends. Every mutation flows through [F14 conversation-persistence-v1](../conversation-persistence-v1/feature.md) so the resulting thread state survives plugin reloads. The action bar is keyboard-reachable and appears on hover or focus, never as a persistent visual distraction.

## Scope

### In scope

- `MessageActionBar` component mounted on each message bubble rendered by [F05](../chat-message-list-markdown/feature.md), visible on hover or keyboard focus of the bubble or any action button, with a visible focus ring using Obsidian CSS variables per [FR-CHAT-07](../../context.md#fr-chat-07).
- **Copy content** action (both roles): copies the raw message text to the clipboard via `navigator.clipboard.writeText` and confirms with an Obsidian `Notice`.
- **Regenerate** action (assistant only): drops the selected assistant turn from the thread and dispatches a new turn against the preceding user message through the agent runner; the old assistant message is replaced, not duplicated.
- **Edit-and-resend** action (user only): swaps the bubble into an inline editor (textarea + Save / Cancel); on Save, truncates the thread at that user message and enqueues the edited content as a fresh turn; Cancel restores the original bubble untouched. Assistant messages are explicitly not inline-editable.
- **Delete** action (both roles): removes the message record from the thread; on user-message delete, subsequent assistant messages that depended on it are also removed per the thread-truncation rule documented in Open questions.
- Keyboard reachability: every action is a real `<button>` with `aria-label`, Tab-reachable, activatable via Enter / Space, and the action bar opens on bubble focus as well as hover.
- Persistence: every mutation calls into [F14 conversation-persistence-v1](../conversation-persistence-v1/feature.md) via `ConversationStore.mutate(threadId, fn)` so the in-memory thread and the `.leo/conversations/<id>.json` file stay in lockstep.
- Unit coverage for: per-role action visibility matrix, copy-click path, regenerate dispatch wiring, edit-and-resend truncate-then-enqueue flow, delete-plus-cascade truncation, persistence call on each mutation, and keyboard reachability audit.

### Out of scope

- Streaming cancel (Stop button, `AbortController`, cancelled-after-N-tools indicator) — ships with [F07 chat-streaming-stop](../chat-streaming-stop/feature.md).
- Compaction, microcompaction, and history-preserving snapshot mutations — ship with F42+ per [features-index.md](../../features-index.md).
- Thread CRUD (create / switch / rename / delete thread, thread list UI) — ships with [F37 multi-thread-management](../../features-index.md).

## Acceptance criteria

1. Every message bubble in the `MessageList` exposes a `MessageActionBar` that is invisible by default and becomes visible when the bubble or any action button receives hover or keyboard focus; the bar disappears when focus and hover both leave, and never obscures the bubble content. (FR-CHAT-07)
2. The **Copy content** action is present on both user and assistant bubbles, copies the exact raw message text to the clipboard via `navigator.clipboard.writeText`, and confirms success through an Obsidian `Notice`. (FR-CHAT-07)
3. The **Regenerate** action is present only on assistant bubbles; clicking it removes the selected assistant message from the thread and dispatches a new turn against the preceding user message through the agent runner, replacing (not duplicating) the old assistant output. (FR-CHAT-07)
4. The **Edit-and-resend** action is present only on user bubbles; clicking it swaps the bubble into an inline editor; on Save the thread is truncated at that user message and the edited content is enqueued as a fresh turn; on Cancel the original bubble is restored byte-for-byte. Assistant bubbles expose no inline edit affordance. (FR-CHAT-07)
5. The **Delete** action is present on both roles, removes the selected message record from the thread, and — when deleting a user message — also removes all assistant / tool messages that followed it in the same turn chain, keeping the thread consistent. (FR-CHAT-07)
6. Every mutation (regenerate, edit-and-resend, delete) is persisted through [F14 conversation-persistence-v1](../conversation-persistence-v1/feature.md) via `ConversationStore.mutate`; a simulated plugin reload after each mutation shows the post-mutation thread state restored from disk. (FR-CHAT-07)
7. Every action button is a real `<button>` with an `aria-label`, Tab-reachable, activatable via Enter / Space, and renders a visible focus ring using Obsidian CSS variables; a keyboard-only traversal from the bubble reaches every action in the bar in DOM order. (FR-CHAT-07)

## Dependencies

- [F05 chat-message-list-markdown](../chat-message-list-markdown/feature.md) — supplies the `MessageList` component, the user- and assistant-bubble rendering surfaces, the stable per-message keys, the copy-to-clipboard pattern (reused for message-level copy), and the teardown guarantees this feature hangs actions off.
- [F14 conversation-persistence-v1](../conversation-persistence-v1/feature.md) — supplies `ConversationStore.mutate(threadId, fn)` and the debounced atomic write pipeline that persists each per-message-action mutation to `.leo/conversations/<id>.json`.
- Drives requirement [FR-CHAT-07](../../context.md#fr-chat-07).

## Implementation notes

- [Architecture §3.1 UI Layer — ChatView](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) — pins the React host where `MessageActionBar` mounts alongside the `MessageList`.
- [Architecture §3.2 Agent Layer](../../../../architecture/architecture.md#32-agent-layer) — the `AgentRunner` entry point regenerate and edit-and-resend dispatch through.
- [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools) — the turn path regenerate and edit-and-resend re-enter after truncation.
- [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership) — fixes thread state as `ConversationStore`-owned, so every mutation routes through it.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — governs React-root teardown of the inline editor and action-bar listeners on unmount.
- [Architecture §11 Mapping SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules) — routes `FR-CHAT-*` through `ChatView` + `AgentRunner`; this feature binds `FR-CHAT-07` to `MessageActionBar`.
- [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) — selects React 18, Obsidian CSS variables, and Obsidian icons via `setIcon` for action glyphs.
- [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — names `Notice` used for copy confirmation and forbids private API usage.
- [Code style — React 18](../../../../standards/code-style.md#react-18) — governs stable keys, hook order, and teardown for the inline editor subtree.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — requires `Notice` for user feedback and forbids private API usage; all FS through the store.
- [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) — forbids hardcoded colours on the action bar and focus ring.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — governs the unit suite listed in Scope.
- [Best practices — General rules](../../../../standards/best-practices.md) — "do not make things up" governs the truncation-cascade choice surfaced in Open questions.

## Open questions

- Delete-cascade scope — [FR-CHAT-07](../../context.md#fr-chat-07) says "delete" without pinning whether deleting a user message cascades to downstream assistant / tool turns. Proposing: deleting a user message also removes the contiguous assistant / tool messages that followed it within the same turn; deleting a standalone assistant message leaves surrounding turns intact. Verifier to confirm against SRS intent.
- Regenerate semantics for multi-turn assistant outputs — if an assistant message is followed by further user turns, proposing regenerate only replaces the selected assistant message and leaves subsequent turns untouched (no truncate). Verifier to confirm.
- Edit-and-resend truncation extent — proposing truncation at the edited user message (drop it and everything after, enqueue the edited content as a fresh turn). Verifier to confirm against SRS expectation of "resend".
