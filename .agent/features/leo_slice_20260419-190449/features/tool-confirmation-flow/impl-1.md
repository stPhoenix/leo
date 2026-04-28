# Impl iteration 1 — F17 tool-confirmation-flow

## Summary

Added a `ConfirmationController` state machine at `src/agent/confirmationController.ts` (single pending slot with `request(req) → Promise<decision>`, `resolve(decision)`, subscribe/current/dispose). `AgentRunner.drive()` now gates each `tool_call` on `requiresConfirmation` + the thread's persisted `allowedTools` set: if a write tool id is not allowlisted, the runner awaits the injected `confirmTool()` callback. Decisions route per AC — `allow-once` invokes without persisting, `allow-thread` calls the injected `markThreadAllowed` (which `main.ts` wires into `ConversationStore.mutate` to append to `thread.metadata.allowedTools`), `deny` synthesizes a `{ok:false, error:"user denied <toolId>"}` tool result without invoking the spec. The `InlineConfirmation` placeholder was replaced by a live dialog that renders into the existing `InlineConfirmation` slot (never Obsidian `Modal`) — tool icon family + name + pretty-printed args + three real buttons; focus lands on Allow-once, Tab cycles among the three, Esc = Deny. Write tools get `data-visual-state="awaiting-confirmation"` (amber), read tools get `idle`. Structured `tool.confirmation.request/allow-once/allow-thread/deny` log events fire per invocation.

## Files touched

- `src/agent/confirmationController.ts` — new state machine + `prettifyArgs` helper (2-space indent, 4 KB soft cap).
- `src/agent/agentRunner.ts` — `confirmTool` / `allowedToolsForThread` / `markThreadAllowed` options; new `invokeWithConfirmation(call, thread, signal)` branch with `tool.confirmation.*` log events.
- `src/ui/chat/InlineConfirmation.tsx` — real dialog: tool header + pretty args pre-block + three buttons; focus to allow-once on mount; Tab / Shift-Tab cycle; document-level Escape listener; `aria-modal="true"` + `aria-live="assertive"` + `data-visual-state` per category.
- `src/ui/chat/ChatRoot.tsx` — `confirmationSource?: InlineConfirmationSource` prop threaded into `InlineConfirmation`.
- `src/ui/chatView.tsx` — accepts `confirmationController` dep, builds `makeInlineConfirmationSource(...)` and threads it through.
- `src/main.ts` — constructs `ConfirmationController`, wires AgentRunner's three confirmation hooks, pipes controller into `ChatView`, and disposes on `onunload`.
- `styles.css` — `.leo-confirmation-*` classes using only Obsidian CSS variables (`--color-yellow`, `--text-muted`, `--interactive-accent`, `--background-modifier-border`, etc.).
- `tests/unit/confirmationController.test.ts` — 9 cases (pending notify, allow-thread, deny, replace-pending-request, dispose-denies-pending, unsubscribe, prettifyArgs valid / invalid / truncated).
- `tests/unit/agentRunner.test.ts` — 4 new cases (pause + allow-once no persist, bypass via allowlist, allow-thread persists via markThreadAllowed, deny → tool-error without invoking + log).
- `tests/dom/inlineConfirmation.test.tsx` — 9 cases covering hidden idle, pending render, read vs write visual-state, ARIA dialog attributes, focus on mount, three buttons resolve correctly, Escape = deny.

## Tests added or updated

- 22 new cases. Full suite: 40 files, 331/331 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Thread id is ignored by the persistence hooks (F14 persists a single Phase-2 thread). `allowedToolsForThread` / `markThreadAllowed` still accept a thread parameter so F37 can switch to per-thread indexing without changing AgentRunner call sites.
- The read-vs-write visual distinction is driven by the agent-side category (`read_*` / `search_vault` → `idle`, everything else → `awaiting-confirmation`). Feature lists that heuristic as "icon family"; the simpler name-prefix rule ships today and can be refined when non-obvious tool ids arrive.
- No React portal for the confirmation content — it mounts inside the existing `InlineConfirmation` region which already sits above the messages list via the six-region grid. Feature's code-style bullet mentions "portals for tool-confirmation modals"; we deliver the same user-visible layering with inline DOM, avoiding an extra portal host.

## Assumptions

- `markThreadAllowed` is idempotent: the main.ts wiring short-circuits when the tool id already appears in `metadata.allowedTools`, so repeated `allow-thread` decisions produce a single record.
- Dispose of the ConfirmationController denies any pending request. If the chat view unmounts mid-confirmation, the agent receives `deny` and synthesises a tool-error so the turn completes cleanly.
- The document-level Escape listener attached by the dialog is scoped via `useEffect` cleanup; it only exists while a pending request is rendered.

## Open questions

None.
