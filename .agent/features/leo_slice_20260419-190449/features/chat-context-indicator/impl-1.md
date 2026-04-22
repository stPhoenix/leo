# Impl iteration 1 — F09 chat-context-indicator

## Summary

Replaced the placeholder `ContextIndicator` grid with a live chip subscribed to the F08 `FocusedContextChannel` via `useSyncExternalStore`. Chip renders the active note basename (extension stripped), viewport line range as `start–end` (1-indexed), and an optional selection-range badge when `FocusedContext.selection` is non-empty. Null payload hides the chip cleanly. Click dispatches a `revealFile(path)` callback that `ChatView` routes into `app.workspace.openLinkText`. Main plugin now injects the channel into `ChatView` so the existing chat sidebar picks it up with zero extra wiring.

## Files touched

- `src/ui/chat/ContextIndicator.tsx` — replaced placeholder grid; subscribes to `ContextIndicatorSource`, renders chip / summary / hidden states, exposes `onReveal` click handler, strips extension for basename (AC1/2/3/5/6).
- `src/ui/chat/ChatRoot.tsx` — threaded `contextIndicatorSource` + `onRevealContextFile` props into `ContextIndicator`.
- `src/ui/chatView.tsx` — built `focusedContextSource` adapter over `FocusedContextChannel` (current + subscribe), wired `onRevealContextFile` → `app.workspace.openLinkText(path, '', false)` (AC6).
- `src/main.ts` — passed `this.focusedContext` into `ChatView` deps via `registerView` factory.
- `styles.css` — added `.leo-context-chip` + child `.leo-context-chip-note` / `-range` / `-sel` classes using Obsidian CSS variables only; `.is-empty` resets chrome; collapsed summary gets ellipsis overflow.
- `tests/dom/contextIndicator.test.tsx` — 10 cases covering empty / full / selection-absent / selection-present / push update / flip back to null / click-reveal / subscribe-unsubscribe symmetry / collapsed-with-file / collapsed-empty / tooltip title.

## Tests added or updated

- `tests/dom/contextIndicator.test.tsx` — 10 new cases (above). Existing `tests/dom/chatRoot.test.tsx` (collapse-below-threshold still passes — summary class retained, grid removed) and `tests/unit/stylesAudit.test.ts` (new classes still use `var(--…)` only) both green without changes.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Feature's mention of an additional tooltip for long note paths is satisfied by a `title` attribute on the chip button (native tooltip) plus CSS `text-overflow: ellipsis` on `.leo-context-chip-note`. No custom tooltip component is introduced — aligns with "keeps its single-line footprint" and the "Styling" standard requiring Obsidian-vars-only.
- Feature's < 280px "responsive collapse contract" is inherited from F04's `collapsed` prop; collapsed mode renders the single-line summary containing the note basename, matching existing chat-root test expectations.

## Assumptions

- `FocusedContext.viewport.from` / `to` are 0-based line numbers (matches F08 `readFocusedContextFromView` which subtracts 1); display converts to 1-based for user-friendly `start–end`.
- Click-to-reveal uses `workspace.openLinkText(path, '', false)` — Obsidian routes this to the correct leaf whether the note is already open or not, satisfying AC6's "click is a no-op focus" edge case naturally.

## Open questions

None.
