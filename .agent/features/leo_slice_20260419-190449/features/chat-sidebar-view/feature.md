# F04 — Chat sidebar ItemView shell

## Purpose

Deliver the structural shell of Leo's chat UI: an Obsidian `ItemView` registered as a sidebar view per [FR-CHAT-01](../../context.md#fr-chat-01), opened and toggled from both a ribbon icon (using Obsidian's built-in icon set) and from a "Leo: Open chat" command palette entry per [FR-UI-04](../../context.md#fr-ui-04) and [FR-UI-11](../../context.md#fr-ui-11), mounted in the right sidebar by default and relocatable via Obsidian's native leaf APIs per [FR-UI-02](../../context.md#fr-ui-02), themed entirely through Obsidian CSS variables so light / dark / community themes apply without hardcoded colors per [FR-UI-03](../../context.md#fr-ui-03), and decomposed into the six placeholder regions `HeaderBar` / `ContextIndicator` / `MessageList` / `ComposerInput` / `InlineConfirmation` / `InlineDialog` per [FR-UI-01](../../context.md#fr-ui-01) so later features mount into a stable frame. The shell sets the accessibility baseline with ARIA roles (`log` on the message region, `status` on the streaming slot, `dialog` + `aria-modal` on the inline confirmation/dialog regions) per [NFR-USE-07](../../context.md#nfr-use-07), enforces a minimum width with collapse behaviour (`HeaderBar` → overflow menu, `ContextIndicator` → single-line summary) below 280px per [NFR-USE-09](../../context.md#nfr-use-09), maintains WCAG AA contrast against Obsidian's default light and dark themes per [NFR-USE-10](../../context.md#nfr-use-10), and honours the mandated z-index layering (Notices → modals → inline dialogs → tooltips → edit-lock decorations → message content) per [NFR-USE-11](../../context.md#nfr-use-11).

## Scope

### In scope

- `ChatView` class extending Obsidian `ItemView` with a stable `VIEW_TYPE`, title, and icon, registered in `Plugin.onload` with a `WorkspaceLeaf` factory and torn down in `onunload`.
- React 18 mount via `createRoot` inside `ItemView.onOpen`, unmount in `onClose`, following the host-app lifecycle contract.
- Ribbon icon (Obsidian ribbon API) that toggles the view open/close and "Leo: Open chat" command palette entry that focuses or opens the view; both use `setIcon` with an icon from Obsidian's built-in Lucide set.
- Default placement in the right sidebar leaf; honours drag / move to left sidebar or main workspace leaf via Obsidian's native view APIs without custom code.
- Component decomposition scaffolded as empty placeholders for the six regions (`HeaderBar`, `ContextIndicator`, `MessageList`, `ComposerInput`, `InlineConfirmation`, `InlineDialog`) with semantic wrappers so later features fill them without restructuring.
- Themeable styling sourced from Obsidian CSS variables (`--background-primary`, `--text-normal`, `--interactive-accent`, etc.) on every surface, text, border, and focus ring; no hardcoded hex / rgb colours in this feature.
- Responsive container observer: at widths `< 280px`, collapse `HeaderBar` into an overflow menu button and `ContextIndicator` into a single-line summary; widths above restore full layout.
- Baseline ARIA structure: `role="log"` on the `MessageList` wrapper, `role="status"` on the streaming-indicator slot inside `HeaderBar`, `role="dialog"` + `aria-modal="true"` on `InlineConfirmation` and `InlineDialog` wrappers.
- Plugin-scoped CSS stacking context with z-index tokens for Notices → modals → inline dialogs → tooltips → edit-lock decorations → message content consumed by later features.
- Unit coverage for: view registration/unregistration lifecycle, React mount/unmount symmetry, ribbon + palette toggle state, CSS-variable-only style audit on the shell, breakpoint collapse at 280px, ARIA role presence.

### Out of scope

- Message list rendering (user/assistant bubbles, markdown, syntax highlighting, copy) — ships with F05 `chat-message-list-markdown`.
- Composer input (multi-line textarea, Enter / Shift+Enter / Esc / Cmd-K behaviour) — ships with F06 `chat-composer-input`.
- Streaming rendering and `AbortController`-driven stop control — ship with F07 `chat-streaming-stop`.
- `ContextIndicator` data (active note, viewport range, selection) — ships with F09 `chat-context-indicator` (this feature ships only the empty slot).
- Visual states (idle / streaming / tool-running / awaiting-confirmation / error / cancelled / edit-locked) and the Notice vs status-bar vs inline-modal notification policy — ship with F13 `ui-visual-states-notifications`.
- Skill picker dropdown inside `HeaderBar` — ships with F22 `skills-picker-active-skill`.
- Token usage indicator — ships with F12 `token-usage-indicator`.
- Tool-confirmation content, plan-approval dialog content, and inline diff UI — ship with F17 / F25 / F20 respectively; this feature ships only the empty wrappers.
- Additional command palette entries beyond "Leo: Open chat" (e.g. "New thread", "Toggle plan mode", "Re-index vault", "Show context") — each ships with its owning feature.

## Acceptance criteria

1. Reloading the plugin on a fresh vault registers a `ChatView` `ItemView` with a stable view type and, on first launch, opens it in the right sidebar; the view survives workspace save/restore and is reopened in its last location after Obsidian restart. (FR-CHAT-01, FR-UI-02)
2. A ribbon icon rendered with `setIcon` from Obsidian's built-in icon set toggles the `ChatView` open/closed, and a "Leo: Open chat" command palette entry focuses the view if already open or opens it if closed; no external icon font is requested at runtime. (FR-UI-04, FR-UI-11)
3. The user can move `ChatView` to the left sidebar or to a main workspace leaf via Obsidian's native "Move" / drag UI without any plugin code blocking relocation, and the view re-mounts cleanly after the move. (FR-UI-02)
4. The view DOM decomposes into exactly six named regions (`HeaderBar`, `ContextIndicator`, `MessageList`, `ComposerInput`, `InlineConfirmation`, `InlineDialog`) with stable CSS class / data attributes so later features mount into them without restructuring. (FR-UI-01)
5. A style audit of the shell's rendered DOM contains zero hardcoded colour literals; every colour, border, background, and focus outline resolves to an Obsidian CSS variable so switching light → dark → a community theme updates the view live. (FR-UI-03)
6. Reducing the view's width below 280px collapses `HeaderBar` into an overflow menu button and reduces `ContextIndicator` to a single-line summary; widening past 280px restores the full layout, with the transition respecting `prefers-reduced-motion`. (NFR-USE-09)
7. Automated ARIA inspection of the rendered shell confirms `role="log"` on the `MessageList` container, `role="status"` on the streaming slot inside `HeaderBar`, and `role="dialog"` + `aria-modal="true"` on both `InlineConfirmation` and `InlineDialog`. (NFR-USE-07)
8. Contrast measurements for the shell's text, borders, and focus ring against Obsidian's default light theme and default dark theme meet WCAG AA (≥ 4.5:1 for body text, ≥ 3:1 for large text and non-text UI). (NFR-USE-10)
9. Stacking verification (programmatic z-index read or visual test) confirms the ordering Notices → modals → inline dialogs → tooltips → edit-lock decorations → message content, with inline dialogs layered above tooltips and below Obsidian modals/Notices. (NFR-USE-11)
10. Unmounting the view (pane close, plugin disable, Obsidian quit) runs the React `createRoot` unmount, removes event listeners, and leaves no dangling `workspace` subscription; reopening remounts without duplicated DOM. (FR-CHAT-01, FR-UI-02)

## Dependencies

- [F01 plugin-bootstrap-logging](../plugin-bootstrap-logging/feature.md) — supplies the `Plugin.onload` / `onunload` scaffold, the `Logger` used by this view's lifecycle events, and the `.leo/` directory creation guarantees; this feature registers the `ChatView` inside that lifecycle.
- Drives requirements [FR-CHAT-01](../../context.md#fr-chat-01), [FR-UI-01](../../context.md#fr-ui-01), [FR-UI-02](../../context.md#fr-ui-02), [FR-UI-03](../../context.md#fr-ui-03), [FR-UI-04](../../context.md#fr-ui-04), [FR-UI-11](../../context.md#fr-ui-11), [NFR-USE-07](../../context.md#nfr-use-07), [NFR-USE-09](../../context.md#nfr-use-09), [NFR-USE-10](../../context.md#nfr-use-10), [NFR-USE-11](../../context.md#nfr-use-11).
- Downstream consumers tracked in [features-index.md](../../features-index.md): F05 (message list), F06 (composer), F07 (streaming/stop), F09 (context indicator data), F11 (message queue UI), F12 (token indicator), F13 (visual states), F17 (tool confirmation), F22 (skill picker), F25 (plan approval), and F53 (MCP resource picker) all mount into the regions this feature scaffolds.

## Implementation notes

- [Architecture §3.1 UI Layer — ChatView](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) — names `ChatView` as the `ItemView` hosting the Assistant UI runtime, the skill picker, tool-confirmation prompts, and the context indicator; this feature implements the outer shell of that row.
- [Architecture §5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup) — shows `Plug->>UI: register view, ribbon icon`; this feature wires that step.
- [Architecture §8 Extension Points](../../../../architecture/architecture.md#8-extension-points) — later features register into the existing sections rather than restructuring, justifying the six-region scaffold.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — requires React roots unmounted on plugin unload; AC10 enforces that contract for this view.
- [Architecture §11 SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules) — pins FR-CHAT-* to `ChatView`, `ChatRoot`, `ToolConfirm`, `SkillPicker`, `ContextIndicator`; this feature ships the `ChatView` + placeholder subtree.
- [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) — selects React 18 + Tailwind + Obsidian CSS variables + `lucide-react`; the shell follows this row.
- [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — names `ItemView`, `WorkspaceLeaf`, `Notice`, `addStatusBarItem` as the Obsidian surfaces used here.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — requires `addCommand` for palette entries, forbids private API usage, and mandates cleanup registration; the ribbon + palette + unmount paths follow it.
- [Code style — React 18](../../../../standards/code-style.md#react-18) — fixes `createRoot` mount / unmount symmetry, hook ordering, and cleanup, governing the React subtree mounted inside `onOpen` / `onClose`.
- [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) — requires Obsidian CSS variables over hardcoded colours; applies to every surface in the shell.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — governs the unit tests called out in the Scope (lifecycle, mount symmetry, style audit, breakpoint, ARIA).
- [Best practices — Planning & Design](../../../../standards/best-practices.md#planning--design) — vertical-slice guidance supports shipping the shell + six regions as one observable slice so later features can land independently.

## Open questions

- None. Acceptance criteria and implementation notes exhaust this feature's scope; no decisions are deferred at this slice.
