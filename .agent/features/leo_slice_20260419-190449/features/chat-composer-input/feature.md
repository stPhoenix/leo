# F06 — Composer input with keyboard UX

## Purpose

Fill the `ComposerInput` region scaffolded by [F04](../chat-sidebar-view/feature.md) with a multi-line textarea that captures the user's next turn and enforces the chat input keyboard contract: Enter submits, Shift+Enter inserts a newline, and multi-line content reflows the input within the sidebar layout per [FR-CHAT-03](../../context.md#fr-chat-03); Cmd/Ctrl+K opens Obsidian's command palette scoped to the chat view and Esc stops a streaming response or closes the active inline confirmation per [NFR-USE-06](../../context.md#nfr-use-06); every interactive element (textarea, send button, inline affordances) is reachable via Tab/Shift-Tab and carries a visible focus ring rendered through Obsidian's native focus styles so keyboard users can drive the composer without a pointer per [NFR-USE-05](../../context.md#nfr-use-05); and the send button's submit animation (and any decorative motion introduced by this feature) is disabled when the host honours `prefers-reduced-motion` per [FR-UI-12](../../context.md#fr-ui-12).

## Scope

### In scope

- `ComposerInput` React component mounted into the region reserved by [F04](../chat-sidebar-view/feature.md), owning local draft state and emitting a `submit(text)` callback consumed by the agent-runner wiring of later features.
- Multi-line `<textarea>` (or equivalent `contentEditable` wrapper) that grows vertically up to a bounded max-height then scrolls internally, preserving whitespace and soft-wrap.
- Keyboard handler: Enter submits the current draft and clears the textarea; Shift+Enter (and Alt+Enter on platforms that emit it) inserts a literal newline without submitting.
- Esc handler with precedence: if an inline confirmation is open (slot wired by [F04](../chat-sidebar-view/feature.md)), Esc closes it; else if a streaming response is in flight, Esc triggers the stop signal; else Esc blurs the textarea. Exact streaming-stop wiring lands with F07.
- Cmd-K / Ctrl-K handler that opens Obsidian's command palette via the public command API while the chat view is focused, without leaking the shortcut to the editor behind.
- Send button rendered with a Lucide icon via `setIcon`, keyboard-reachable via Tab with a visible focus ring, disabled when the draft is empty or whitespace-only.
- Visible focus ring on every interactive element sourced from Obsidian's native focus-ring CSS variables — no custom outline colours.
- `prefers-reduced-motion` media-query gate: when set, the send-button submit animation and any composer-originated motion collapse to an instant state change; the decoration returns when the preference is cleared.
- Unit coverage for: Enter-send vs Shift+Enter-newline, Esc precedence across confirmation-open / streaming / idle states, Cmd-K palette open while chat view is focused, focus order through textarea → send button → surrounding slots, send-button disabled state on empty draft, style audit asserting Obsidian focus-ring variables and motion gating.

### Out of scope

- Streaming-cursor rendering and `AbortController`-driven stop mechanics — ship with F07 (this feature only forwards the Esc intent).
- FIFO queuing of user messages typed while a prior request is in flight — ships with F11.
- Message persistence to `.leo/conversations/` — ships with F14.
- Token / cost indicators in the composer — tracked by F12 and rendered in `HeaderBar`, not here.
- Attachments (image paste, file drop) — phase 5.
- Skill-picker affordance and thread-header controls — ship with F22 inside `HeaderBar`.
- Inline confirmation content and plan-approval dialog bodies — ship with F17 / F25; this feature only reads the open/closed state for Esc routing.

## Acceptance criteria

1. Typing text and pressing Enter submits the current draft to the component's `submit` callback and clears the textarea; pressing Shift+Enter at the same caret position inserts a literal newline without submitting, and subsequent characters continue on the new line. (FR-CHAT-03, NFR-USE-06)
2. The textarea supports multi-line content: Shift+Enter repeated N times produces N newline characters in the draft, the input reflows vertically up to its max-height, and beyond that it scrolls internally while remaining keyboard-navigable. (FR-CHAT-03)
3. Pressing Esc while an inline confirmation is open closes the confirmation; pressing Esc while a streaming response is in flight fires the stop intent (wired in F07); pressing Esc in the idle state blurs the textarea without submitting. (NFR-USE-06)
4. Pressing Cmd-K (macOS) / Ctrl-K (Windows/Linux) while the `ChatView` is focused opens Obsidian's command palette via the public command API, and the keystroke does not reach the editor pane behind the sidebar. (NFR-USE-06)
5. Tab and Shift-Tab traverse the composer's interactive elements (textarea, send button, and any composer-owned affordances) in a stable order, with a visible focus ring on each stop rendered through Obsidian's native focus-style CSS variables — a style audit finds zero custom outline colours. (NFR-USE-05)
6. With `prefers-reduced-motion: reduce` set at the OS/browser level, the send button's submit animation and any composer-originated motion are replaced by an instant state change; toggling the preference off restores the animation without a reload. (FR-UI-12)
7. Unmounting the composer (pane close, plugin disable, thread switch) removes its keyboard listeners and palette binding, leaving no dangling global handlers or focus traps. (FR-CHAT-03)

## Dependencies

- [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) — supplies the `ChatView` shell, the `ComposerInput` region wrapper, the `InlineConfirmation` slot state this feature reads for Esc routing, the Obsidian-CSS-variable theming baseline, and the minimum-width / collapse behaviour this composer lives inside.
- Drives requirements [FR-CHAT-03](../../context.md#fr-chat-03), [FR-UI-12](../../context.md#fr-ui-12), [NFR-USE-05](../../context.md#nfr-use-05), [NFR-USE-06](../../context.md#nfr-use-06).

## Implementation notes

- [Architecture §3.1 UI Layer — ChatView](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) — names `ChatView` as the host of the Assistant UI runtime where `ComposerInput` mounts.
- [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools) — shows the user-submission path this composer initiates.
- [Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation) — anchors the Esc-to-stop intent this composer forwards.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — requires teardown of listeners on unmount; AC7 enforces this.
- [Architecture §11 SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules) — pins FR-CHAT-* to `ChatView` and `ChatRoot`, where the composer lives.
- [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) — selects React 18, Obsidian CSS variables, and `lucide-react` for the send icon.
- [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — names the `Plugin` command API used for the Cmd-K palette route.
- [Code style — React 18](../../../../standards/code-style.md#react-18) — governs controlled-input patterns and effect cleanup.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — requires the public command API and cleanup registration for the palette shortcut.
- [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) — forbids hardcoded colours in focus rings and motion styling.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — governs the unit suite enumerated in Scope.
- [Best practices — Planning & Design](../../../../standards/best-practices.md#planning--design) — vertical-slice guidance supports shipping the composer UX independently of streaming and persistence.

## Open questions

- None. Acceptance criteria and implementation notes exhaust this feature's scope; no decisions are deferred at this slice.
