# F05 — Message list with markdown rendering

## Purpose

Fill the `MessageList` region scaffolded by [F04](../chat-sidebar-view/feature.md) with a scrollable transcript that renders the conversation so far: user turns as plain-text bubbles and assistant turns as full markdown using Obsidian's `MarkdownRenderer.render`, with visually distinct user vs assistant styles driven exclusively by Obsidian CSS variables per [FR-CHAT-02](../../context.md#fr-chat-02); code fences inside assistant messages gain syntax highlighting and a copy-to-clipboard affordance per [FR-CHAT-06](../../context.md#fr-chat-06). The feature delivers the read-only rendering surface that later features (streaming, per-message actions, context chip, visual states) plug into.

## Scope

### In scope

- `MessageList` component rendering an ordered list of completed messages from the thread model, scroll-anchored to the latest turn on new content while preserving the user's manual scroll position when they scroll up.
- User-role bubble: plain-text content with whitespace preserved, visually distinct surface/border/alignment driven only by Obsidian CSS variables.
- Assistant-role bubble: full markdown rendered via Obsidian's `MarkdownRenderer.render` into an isolated DOM subtree, with React cleanup on unmount of each rendered block.
- Code fences inside assistant markdown: syntax highlighting through Obsidian's native code-block rendering pipeline, plus a per-block copy-to-clipboard button (Obsidian icon via `setIcon`, keyboard-reachable, announces success via `Notice`).
- Stable list keys per message id so reorder / append / partial updates do not remount the entire transcript.
- Unit coverage for: render ordering, user vs assistant styling branches, markdown render invocation per assistant message, code-fence copy button click path, CSS-variable-only style audit on bubbles.

### Out of scope

- Token-by-token streaming rendering and the stop control — ship with [F07 chat-streaming-stop](../chat-streaming-stop/feature.md).
- Per-message actions (copy whole message, regenerate, edit-and-resend, delete) — ship with [F15 message-actions](../message-actions/feature.md).
- Context indicator (active note / viewport / selection chip) — ships with [F09 chat-context-indicator](../chat-context-indicator/feature.md).
- Visual states (idle, streaming, tool-running, awaiting-confirmation, error, cancelled, edit-locked) and the global notification policy — ship with [F13 ui-visual-states-notifications](../ui-visual-states-notifications/feature.md).

## Acceptance criteria

1. Given a thread with an interleaved user and assistant message history, the `MessageList` renders each message in submission order inside the region provided by [F04](../chat-sidebar-view/feature.md), with user turns plain-text and assistant turns as rendered markdown. (FR-CHAT-02)
2. User and assistant bubbles are visually distinguishable (surface colour, border, alignment) using only Obsidian CSS variables — a style audit of the rendered DOM contains zero hardcoded colour literals and both roles remain distinguishable on Obsidian's default light theme, default dark theme, and a community theme. (FR-CHAT-02)
3. Appending a new message scrolls the view to the latest turn when the user was already at the bottom; when the user has scrolled up, the list preserves their position and does not auto-scroll. (FR-CHAT-02)
4. Every assistant message is rendered by invoking Obsidian's `MarkdownRenderer.render` into the bubble's container, with headings, lists, blockquotes, inline code, and links rendered as native Obsidian markdown output. (FR-CHAT-06)
5. Fenced code blocks inside an assistant message receive syntax highlighting through Obsidian's native code-block pipeline for the declared language and render a recognisable plain pre/code block when the language tag is absent or unknown. (FR-CHAT-06)
6. Each rendered code block exposes a copy-to-clipboard button (Obsidian icon via `setIcon`, keyboard-reachable via Tab with a visible focus ring) that copies the exact fence contents to the clipboard and confirms via `Notice`. (FR-CHAT-06)
7. Unmounting the `MessageList` (pane close, plugin disable, thread switch) tears down every `MarkdownRenderer.render` subtree and its copy-button listeners, leaving no dangling DOM, listeners, or observers. (FR-CHAT-02, FR-CHAT-06)

## Dependencies

- [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) — supplies the `ChatView` shell, the `MessageList` region wrapper with `role="log"`, the Obsidian-CSS-variable theming baseline, the minimum-width / collapse behaviour, and the z-index layering this feature renders inside.
- Drives requirements [FR-CHAT-02](../../context.md#fr-chat-02), [FR-CHAT-06](../../context.md#fr-chat-06).

## Implementation notes

- [Architecture §3.1 UI Layer — ChatView](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) — pins the Assistant UI runtime host where `MessageList` lives.
- [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools) — shows the completed-message path this feature renders.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — mandates React-root teardown that AC7 enforces on markdown subtrees.
- [Architecture §11 SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules) — maps FR-CHAT-* to `ChatRoot` / `ChatView`, where this component mounts.
- [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) — selects React 18, Obsidian CSS variables, and `lucide-react` icons used by the copy button.
- [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — names `MarkdownRenderer` and `Notice` used here.
- [Code style — React 18](../../../../standards/code-style.md#react-18) — governs stable keys, hook order, and cleanup for the markdown subtree.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — requires `Notice` for user feedback and forbids private API usage.
- [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) — forbids hardcoded colours in user/assistant bubble styling.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — governs the unit suite listed in Scope.

## Open questions

- None. Acceptance criteria and implementation notes exhaust this feature's scope; no decisions are deferred at this slice.
