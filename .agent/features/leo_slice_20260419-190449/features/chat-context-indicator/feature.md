# F09 — Context indicator chip

## Purpose

Turn the empty `ContextIndicator` slot left by the chat shell into a live, at-a-glance chip that tells the user exactly which note, viewport, and selection Leo currently considers "in context" per [FR-CHAT-09](../../context.md#fr-chat-09). The chip subscribes to the Focused Context stream emitted by [F08 editor-bridge-focused-context](../editor-bridge-focused-context/feature.md), renders the active note's display name, its visible viewport line range, and — when non-empty — the selection range, and updates in lockstep with the bridge's 300ms debounce so the chip never lags or flickers. Clicking the chip reveals the referenced note in the workspace (`workspace.getLeaf` + `openLinkText`), and when no markdown editor is focused the chip collapses to a hidden state so the header stays clean per [FR-CHAT-09](../../context.md#fr-chat-09).

## Scope

### In scope

- Inline chip rendered inside the `ContextIndicator` region of [F04 chat-sidebar-view](../chat-sidebar-view/feature.md), showing: active note path (truncated basename), viewport `start–end` line range, and selection `start–end` range when a non-empty selection is present.
- Subscription to the `FocusedContext` push channel emitted by [F08 editor-bridge-focused-context](../editor-bridge-focused-context/feature.md); re-renders on each tick with no additional debounce beyond the bridge's own.
- Click-to-reveal behaviour: clicking the chip resolves the `FocusedContext.file` and opens / focuses that note via Obsidian's native leaf API.
- Graceful hidden / empty state when the stream emits a null payload (no active markdown editor).
- Truncation + tooltip for long note paths so the chip keeps its single-line footprint at widths ≥ 280px and collapses cleanly at widths < 280px (consumed from the shell's responsive contract).
- Unit coverage for: subscribe/unsubscribe symmetry on mount/unmount, rendered fields against stream payloads, hidden state on null payload, and click-to-reveal dispatch.

### Out of scope

- Token / context-window usage display (input / output / total counts, cost) — ships with F12 `token-usage-indicator`.
- Active skill name + skill picker affordance in the header — ship with F22 `skills-picker-active-skill`.
- Full context breakdown UI (which files, chunks, and tools are actually assembled into the LLM prompt) — ships with F47 `context-breakdown-inspector`.
- Producing the `FocusedContext` itself (CM6 extension, debounce, workspace listeners) — owned by [F08 editor-bridge-focused-context](../editor-bridge-focused-context/feature.md).
- Styling tokens, z-index layering, and the six-region scaffold — owned by [F04 chat-sidebar-view](../chat-sidebar-view/feature.md); this feature only fills the `ContextIndicator` slot.

## Acceptance criteria

1. When a markdown editor is focused, the chip renders the active note's name derived from `FocusedContext.file` (basename, extension stripped) inside the `ContextIndicator` slot of the chat shell (FR-CHAT-09).
2. The chip renders the viewport as a `start–end` line-range badge taken from `FocusedContext.viewport`, updating on every Focused Context emission (FR-CHAT-09).
3. When `FocusedContext.selection` is a non-empty range, the chip shows an additional `sel start–end` badge; when the selection is empty, the badge is omitted (FR-CHAT-09).
4. The chip re-renders within one Focused Context debounce tick (≤ 300ms trailing, inherited from F08) of any editor cursor / selection / viewport / active-leaf change, with no double-fire against the same payload (FR-CHAT-09).
5. When the Focused Context stream emits a null payload (no active markdown editor), the chip hides gracefully — no placeholder text, no residual stale range — and reappears automatically when a markdown editor regains focus (FR-CHAT-09).
6. Clicking the chip opens / focuses the referenced note via Obsidian's native workspace leaf API; if the note is already the active leaf, the click is a no-op focus (FR-CHAT-09).

## Dependencies

- [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) — supplies the `ContextIndicator` region, the responsive < 280px collapse contract, the Obsidian-CSS-variable theming baseline, and the ARIA structure this chip mounts into.
- [F08 editor-bridge-focused-context](../editor-bridge-focused-context/feature.md) — supplies the `FocusedContext` payload (`file` / `cursor` / `selection` / `viewport`) and the 300ms debounced push channel this chip subscribes to.
- Drives requirement [FR-CHAT-09](../../context.md#fr-chat-09).

## Implementation notes

- [Architecture §3.1 UI Layer — ChatView / ContextIndicator](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) — places `ContextIndicator` inside the `ChatView` runtime; this feature fills that row.
- [Architecture §4 Key Contracts — FocusedContext](../../../../architecture/architecture.md#4-key-contracts) — pins the `{file, cursor, selection, viewport}` shape the chip reads.
- [Architecture §11 SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules) — maps FR-CHAT-09 onto `ContextIndicator`.
- [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) — React 18 + Obsidian CSS variables host the chip's rendering surface.
- [Code style — React 18](../../../../standards/code-style.md#react-18) — mount-time subscribe, unmount-time unsubscribe symmetry for the Focused Context stream.
- [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) — chip uses Obsidian CSS variables only; no hardcoded colours.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — observable UI surface for the always-on Focused Context signal.

## Open questions

- None. Acceptance criteria and implementation notes exhaust this feature's scope; no decisions are deferred at this slice.
