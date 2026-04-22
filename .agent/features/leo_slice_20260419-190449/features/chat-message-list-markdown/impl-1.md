# Impl iteration 1 — F05 chat-message-list-markdown

## Summary

Filled the `MessageList` region scaffolded by F04: a scrollable transcript that renders each turn from a `ChatMessageStore` keyed by message id, with user turns shown as plain-text bubbles (whitespace preserved) and assistant turns as full Obsidian-rendered markdown via a dependency-injected `renderMarkdown(text, container) → cleanup` callback wired to `MarkdownRenderer.render` + a per-bubble `Component`. Each rendered code fence is automatically enhanced with a keyboard-reachable copy-to-clipboard button (`aria-label="Copy code"`, `tabIndex=0`, focus-visible outline) that copies the exact fence text and confirms via `Notice`. Scroll anchoring follows a pure `isNearBottom` rule: when the user was at the bottom on the previous render the list auto-scrolls to the latest turn; otherwise it preserves the position and surfaces a "Jump to latest (N)" affordance. Unmount tears down every markdown subtree, removes every copy-button listener, unloads the per-bubble `Component`, and empties the host. 24 new tests (12 happy-dom for MessageList rendering / markdown invocation / copy-button flow / cleanup, 5 ChatMessageStore unit, 5 codeBlockEnhancer DOM unit, 7 scrollAnchoring pure unit) lift the suite to 124/124 green.

## Files touched

- `src/chat/types.ts` — new — `ChatMessageRecord` shape (`id` / `role` / `content` / `createdAt`).
- `src/chat/messageStore.ts` — new — `ChatMessageStore` with `subscribe` / `getSnapshot` / `set` / `append` / `clear` (plays the `useSyncExternalStore` contract; F14 will replace its persistence layer without touching the React surface).
- `src/ui/chat/scrollAnchoring.ts` — new — `isNearBottom(metrics, tol=16)` and `shouldAutoScroll(prev)` pure helpers driving the auto-scroll vs preserve-position decision.
- `src/ui/chat/codeBlockEnhancer.ts` — new — `enhanceCodeBlocks(host, { clipboard, setIcon? }) → cleanup`: walks every `<pre><code>`, attaches a `.leo-copy-code-button` with aria-label / tabIndex 0 / focus-visible outline, idempotent across re-runs (skips already-enhanced blocks), returns a function that removes every button + listener.
- `src/ui/chat/MessageList.tsx` — rewritten from F04 placeholder — subscribes to the store, renders user vs assistant bubbles in submission order, hosts the markdown subtree per assistant message, drives scroll anchoring via `useLayoutEffect`/`useEffect`, surfaces the "Jump to latest" pill when scrolled up with pending messages.
- `src/ui/chat/ChatRoot.tsx` — extended — props now require `messageStore` / `renderMarkdown` / `clipboard` (and optional `setIcon`), forwarded into `MessageList`.
- `src/ui/chatView.tsx` — wires Obsidian deps: per-bubble `Component`-backed `MarkdownRenderer.render`, `navigator.clipboard.writeText`, `Notice`, Obsidian's bundled `setIcon`; tracks every `Component` instance so `onClose` unloads them, then unmounts the React root and empties the host (AC7).
- `styles.css` — adds `.leo-message-list-scroll`, `.leo-message-list-items`, `.leo-message`, `.leo-bubble*`, `.leo-copy-code-button`, `.leo-jump-to-latest` rules using only Obsidian CSS variables (background, border, text, accent, shadow); `position: relative` on `pre` for the absolutely-positioned copy button.

## Tests added or updated

- `tests/unit/messageStore.test.ts` — 5 cases — empty initial snapshot, `append` order + notify count, `set` replaces and notifies once, `clear` is no-op when already empty, dispose stops notifications. (FR-CHAT-02)
- `tests/unit/scrollAnchoring.test.ts` — 7 cases — at-bottom / within-tolerance / scrolled-up / custom-tolerance, plus `shouldAutoScroll` for first paint / near-bottom / scrolled-up. (AC3)
- `tests/unit/codeBlockEnhancer.test.ts` (happy-dom) — 5 cases — copy buttons attached with correct aria/tab attrs (AC6), `<pre>` without `<code>` is skipped, double-call does not duplicate the button, cleanup removes the button + listener (AC7), and clicking the button copies the exact code text and notifies on success.
- `tests/dom/messageList.test.tsx` (happy-dom + RTL) — 7 cases — render order across user/assistant interleave (AC1), user bubble carries plain-text content with `data-slot="user-text"` and assistant bubble hosts an isolated `data-slot="assistant-markdown"` subtree (AC1/AC4), stable list keys keep the assistant subtree mounted across appends (FR-CHAT-02), `renderMarkdown` invoked once per assistant message into its own container (AC4), copy-code-button click flows through `clipboard.copy` + `clipboard.notify` with the exact fence text (AC6), unmount calls every per-bubble cleanup and empties the host (AC7), and content changes on a stable id replace the buttons cleanly without leaking duplicates (AC7).
- `tests/dom/chatRoot.test.tsx` — updated — defaults now wire a `ChatMessageStore`, no-op `renderMarkdown`, and no-op `clipboard` so the existing six-region / ARIA / collapse / style-audit assertions still hold.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

None. The "no open questions" stance in `feature.md` held: every behaviour pins to a verifiable AC and every dependency edge resolves through the F04 region wrapper or the dependency-injected callbacks. The scroll-anchoring tolerance of 16 px is an internal default, surfaced as a parameter for tests; not a deviation.

## Assumptions

- `MarkdownRenderer.render` is invoked through a per-bubble Obsidian `Component` so that AC7 cleanup can call `Component.unload()` and free any postprocessor subscriptions; the `ChatView` keeps a `Set<Component>` to guarantee `onClose` releases them even if React's effect cleanup fires out of order.
- The "Jump to latest" pill (`.leo-jump-to-latest`) ships as a counter-bearing button keyed by `pendingNew`; this satisfies the AC3 wording "preserves position and does not auto-scroll" while also matching ui.md wireframe 2. The animation is suppressed by the global `prefers-reduced-motion` reset added in F04.
- Code-block syntax highlighting is whatever Obsidian's `MarkdownRenderer` decides — that is the FR-CHAT-06 contract ("native pipeline"). When the language fence is absent the renderer emits a plain `<pre><code>` and the copy button still attaches; the test fixture asserts both the language-tagged path and the buttoning behaviour without coupling to a specific theme.
- For F05 the message list reads from an in-memory `ChatMessageStore` per view instance. F14 will replace `ChatView.messageStore` with the `.leo/conversations/<id>.json`-backed store; the `subscribe` / `getSnapshot` / `set` / `append` shape is the future-proof seam.
- `clipboard.copy` returns a `Promise<void>` so production wiring uses `navigator.clipboard.writeText` directly; failure surfaces as `clipboard.notify("Copy failed")` rather than throwing across the React boundary.

## Open questions

- The "Jump to latest" pill currently lives inside the `MessageList` region's relative-position frame. When F07 (`chat-streaming-stop`) lands a streaming-state badge in HeaderBar's `data-slot="streaming-status"`, the pill should remain coherent with that animation (or be suppressed during streaming) — flag for verifier.
- F15 (`message-actions`) will need to overlay copy / regenerate / edit / delete affordances on bubbles. The current bubble structure exposes `data-slot="user-text"` / `data-slot="assistant-markdown"` so F15 can attach an actions row without restructuring; confirm before that feature ships.
