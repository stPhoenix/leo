# F13 — Visual states & notifications policy

## Purpose

Establish the shared visual-state vocabulary and the notification-placement policy that every later chat feature consumes, so that the six-region shell scaffolded in [F04](../chat-sidebar-view/feature.md) can surface consistent signals without each feature reinventing its own chrome. This feature defines the unified visual-state set — `idle`, `streaming`, `tool-running`, `awaiting-confirmation`, `error`, `cancelled`, `edit-locked` — per [FR-UI-06](../../context.md#fr-ui-06), the per-tool icon registry for the built-in `read`, `write`, `search`, and `edit` tool families plus the generic MCP icon + server-name label placeholder used for future MCP tools per [FR-UI-05](../../context.md#fr-ui-05), and the notification-placement rule that transient success / info uses Obsidian `Notice`, persistent provider / index / MCP connectivity uses the status bar, blocking errors use an inline modal inside `ChatView`, and tool confirmation is always an inline dialog in the chat surface (never a native Obsidian modal) per [FR-UI-08](../../context.md#fr-ui-08). The deliverable is a typed state + icon + notification API — not any specific visual flow — so that [F07](../chat-streaming-stop/feature.md), F17, F18, F25, and F51+ all attach into the same contract without redefining glyphs or notification channels.

## Scope

### In scope

- Unified `VisualState` union covering `idle`, `streaming`, `tool-running`, `awaiting-confirmation`, `error`, `cancelled`, `edit-locked`, each with: a canonical data attribute (e.g. `data-visual-state="streaming"`) applied to the active region, an Obsidian-CSS-variable palette (e.g. amber for `awaiting-confirmation`, red for `error`, muted for `cancelled`), and an ARIA hint (`role="status"` / `aria-busy="true"` where appropriate) per [FR-UI-06](../../context.md#fr-ui-06).
- Per-tool icon registry exposing a stable `iconFor(toolId)` API that resolves built-in read / write / search / edit tool families to icons from Obsidian's built-in Lucide set via `setIcon` per [FR-UI-05](../../context.md#fr-ui-05); consumed by confirmation prompts (F17) and message tool-use blocks (F16+).
- MCP placeholder entry in the icon registry: any `toolId` prefixed `mcp.<serverId>.*` resolves to a generic MCP icon plus a `<server-name>` label slot per [FR-UI-05](../../context.md#fr-ui-05) (label content populated by F51+).
- `Notifications` policy helper with three channels — `Notice` (transient success / info), status bar (`addStatusBarItem`, persistent connectivity / indexing state), and inline modal mounted into the `InlineDialog` region from [F04](../chat-sidebar-view/feature.md) (blocking errors) — and a hard constraint that tool confirmations are routed to the inline `InlineConfirmation` slot, never to Obsidian's native modal API per [FR-UI-08](../../context.md#fr-ui-08).
- CSS-variable tokens for each visual state (so [F07](../chat-streaming-stop/feature.md) streaming cursor, F17 awaiting-confirmation amber, F18 edit-locked highlight, and future error banners share one palette), with `prefers-reduced-motion` disabling state-change animations.
- Unit coverage: icon registry returns expected icon for each built-in tool family and the MCP generic icon for `mcp.*` ids; visual-state class / data attribute applied per state; `Notifications.notice` calls Obsidian `Notice`; `Notifications.status` writes to the status bar; `Notifications.blockingError` mounts the inline modal and does not call Obsidian `Modal`; tool-confirmation channel asserts no native modal path exists.

### Out of scope

- Streaming render pipeline and animated cursor implementation — ships with [F07](../chat-streaming-stop/feature.md) (this feature only defines the `streaming` state token and cursor palette).
- Edit-lock CM6 decoration, readonly range, 3-second highlight, release-on-failure logic — ships with F18 (this feature only defines the `edit-locked` state token and highlight palette).
- Tool-confirmation inline dialog content (tool name, arguments pretty-print, Allow once / Allow for thread / Deny buttons, thread-scoped allowlist) — ships with F17 (this feature only owns the inline-channel routing rule).
- Plan approval dialog content and `Approve / Edit / Reject` buttons — ships with F25 (this feature only owns the inline-modal channel).
- Resolving MCP `<server-name>` labels and per-server metadata — ships with F51+ (this feature ships the placeholder slot only).
- Any specific status-bar contents (provider connectivity indicator, index progress, MCP status) — each ships with its owning feature (F02, F29, F51+) and calls into this feature's `Notifications.status` channel.

## Acceptance criteria

1. A typed `VisualState` union is exported covering exactly `idle`, `streaming`, `tool-running`, `awaiting-confirmation`, `error`, `cancelled`, `edit-locked`; applying a state to a region writes a stable `data-visual-state="<name>"` attribute and resolves colors through Obsidian CSS variables (amber for `awaiting-confirmation`, red for `error`, muted for `cancelled`) with zero hardcoded hex / rgb literals. (FR-UI-06)
2. State-change animations (e.g. streaming cursor pulse, awaiting-confirmation glow) are suppressed when `prefers-reduced-motion: reduce` is set, while the underlying `data-visual-state` attribute still updates. (FR-UI-06)
3. An `iconFor(toolId)` registry resolves built-in tool families to icons from Obsidian's built-in icon set via `setIcon`: `read_note` → read icon, `create_note` / `edit_note` / `append_to_note` → write / edit icons, `search_vault` → search icon; no external icon font is requested at runtime. (FR-UI-05)
4. For any `toolId` matching the pattern `mcp.<serverId>.<tool>`, `iconFor` returns a generic MCP icon plus an adjacent `<server-name>` label slot (label content sourced from a consumer-supplied lookup, populated later by F51+). (FR-UI-05)
5. A `Notifications` helper exposes three channels — `notice(message)` → Obsidian `Notice` for transient success / info; `status(key, message)` → `addStatusBarItem` entry for persistent state; `blockingError(content)` → inline modal mounted into the [F04](../chat-sidebar-view/feature.md) `InlineDialog` region — and wiring asserts each channel reaches the expected Obsidian surface. (FR-UI-08)
6. Tool-confirmation requests are routed exclusively to the inline `InlineConfirmation` region scaffolded by [F04](../chat-sidebar-view/feature.md); a unit test asserts the confirmation path never invokes Obsidian's native `Modal` API, preserving the "never native modals for tool confirmation" rule. (FR-UI-08, FR-UI-05)
7. Unmounting `ChatView` (pane close, plugin disable) tears down any active visual-state subscription, removes status-bar items added via `Notifications.status`, and dismisses any inline modal, leaving no dangling DOM or listeners. (FR-UI-06, FR-UI-08)

## Dependencies

- [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) — supplies the six-region shell (`HeaderBar` / `ContextIndicator` / `MessageList` / `ComposerInput` / `InlineConfirmation` / `InlineDialog`), the CSS-variable baseline, the z-index stacking contract, and the ARIA wrapper roles this feature reads and attaches state / notification targets into.
- Drives requirements [FR-UI-05](../../context.md#fr-ui-05), [FR-UI-06](../../context.md#fr-ui-06), [FR-UI-08](../../context.md#fr-ui-08).
- Downstream consumers tracked in [features-index.md](../../features-index.md): [F07](../chat-streaming-stop/feature.md) uses the `streaming` state + cursor palette; F17 uses the `awaiting-confirmation` state + inline-confirmation channel + per-tool icons; F18 uses the `edit-locked` state + highlight palette; F25 uses the inline-modal channel for plan approval; F29 / F51+ use the status-bar channel for index / MCP connectivity; the MCP-icon registry entry is populated by F51+.

## Implementation notes

- [Architecture §3.1 UI Layer — ChatView](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) names `ChatView` as the host of the Assistant UI runtime, confirmation prompts, and context indicator — the regions visual state and inline notifications attach to.
- [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) fixes the `StreamEvent` / `ToolSpec` shapes whose `tool_confirmation`, `tool_call`, and `error` cases drive the state transitions this feature encodes.
- [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy) — anchors the `Notice` vs status-bar vs inline-modal split encoded by `Notifications`.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — requires clean teardown on unmount, which AC7 enforces for status-bar items and inline modals.
- [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) selects React 18 + `lucide-react` and Obsidian CSS variables; [Platform APIs](../../../../standards/tech-stack.md#platform-apis) names `setIcon`, `Notice`, `addStatusBarItem` as the surfaces used here.
- [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) requires Obsidian CSS variables over hardcoded colors for every state palette; [Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) forbids private-API use and mandates cleanup registration for status-bar items.
- [Code style — React 18](../../../../standards/code-style.md#react-18) governs mount / unmount symmetry for the visual-state provider and inline modal portal.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) governs the unit tests called out in the Scope (icon registry, state data-attribute, `Notifications` channel wiring, no-native-modal assertion).
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — single source of truth for visual states and notification placement across later features.

## Open questions

- None. Acceptance criteria and implementation notes exhaust this feature's scope; no decisions are deferred at this slice.
