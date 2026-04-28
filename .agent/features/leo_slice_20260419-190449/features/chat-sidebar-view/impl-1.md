# Impl iteration 1 — F04 chat-sidebar-view

## Summary

Delivered the structural chat shell: a `ChatView` Obsidian `ItemView` (stable view type, Lucide bot icon, "Leo" title) registered in `Plugin.onload` with `WorkspaceLeaf` factory, mounting a React 18 root via `createRoot` in `onOpen` and unmounting cleanly in `onClose`; six React component placeholders (`HeaderBar`, `ContextIndicator`, `MessageList`, `ComposerInput`, `InlineConfirmation`, `InlineDialog`) carrying the mandated ARIA roles (`log` + `aria-live`, `status` + `aria-live`, two `dialog` + `aria-modal` regions); a pure-TS `isCollapsed(width)` helper plus a `ResizeObserver`-driven hook that flips the layout below 280 px (HeaderBar → overflow button, ContextIndicator → single-line summary); a ribbon icon and a `Leo: Open chat` palette command, both routed through a shared `openOrFocusChatView(workspace)` helper that opens / reveals / toggles a leaf in the right sidebar; a plugin-scoped `styles.css` using only Obsidian CSS variables with explicit `--leo-z-*` tokens for the Notice → Modal → InlineDialog → Tooltip → EditLock → Content stack and a `prefers-reduced-motion` reset; and 23 new tests (5 collapse-threshold + 4 open-or-focus workspace flows + 8 DOM/RTL assertions on the rendered shell + 6 styles-CSS audit) bringing the suite to 100/100 green.

## Files touched

- `src/ui/viewType.ts` — new — `VIEW_TYPE_LEO_CHAT` constant + `COLLAPSE_THRESHOLD_PX = 280` shared by code and tests.
- `src/ui/responsiveCollapse.ts` — new — `isCollapsed(width, threshold)` pure helper.
- `src/ui/openChatView.ts` — new — `openOrFocusChatView(workspace, { toggle? })` helper that handles open / reveal+focus / toggle-close / no-op cases.
- `src/ui/chat/HeaderBar.tsx` — new — banner with title, skill-picker slot, streaming-status slot (`role="status"`/`aria-live`), and an overflow button rendered only when collapsed.
- `src/ui/chat/ContextIndicator.tsx` — new — three-field grid by default, collapses to a single `data-slot="context-summary"` line under 280 px.
- `src/ui/chat/MessageList.tsx` — new — `<section role="log" aria-live="polite" aria-relevant="additions">` with empty-state placeholder.
- `src/ui/chat/ComposerInput.tsx` — new — disabled placeholder textarea + send button (text "Send" by default, "➤" glyph when collapsed).
- `src/ui/chat/InlineConfirmation.tsx` / `src/ui/chat/InlineDialog.tsx` — new — `role="dialog"` + `aria-modal="true"` wrappers, hidden by default until F17/F25/F20 light them up.
- `src/ui/chat/ChatRoot.tsx` — new — composes the six regions, owns the collapsed-state React reducer, accepts an `observeWidth` injector so production code drives it via `ResizeObserver` and tests drive it via fixed `initialWidth`.
- `src/ui/chatView.tsx` — new — Obsidian `ItemView` subclass: `getViewType` / `getDisplayText` / `getIcon`, `onOpen` mounts `ChatRoot` and attaches a `ResizeObserver`, `onClose` disconnects the observer, clears listeners, and calls `root.unmount()` (AC10).
- `src/main.ts` — registers the view, the bot ribbon icon (toggling), and the `Leo: Open chat` palette command (open/reveal); reuses the shared `registerLeoCommand` helper from F03; settings tab + provider/embedding wiring unchanged.
- `src/settings/commands.ts` — adds `COMMAND_IDS.openChat` for the new palette entry.
- `styles.css` — new (loaded by Obsidian from the plugin folder) — Obsidian-CSS-variable-only stylesheet covering every shell surface, focus ring, text colour, and the `--leo-z-*` token block plus a `prefers-reduced-motion` reset.
- `vitest.config.ts` — extends `include` to `tests/**/*.test.tsx` so the DOM/RTL suite runs.
- `package.json` — adds `happy-dom@^20`, `@testing-library/react@^14`, `@testing-library/dom@^10` to `devDependencies`; production bundle stays small (`main.js` ≈ 172 KB after this slice — well under the 1.5 MB budget).

## Tests added or updated

- `tests/unit/responsiveCollapse.test.ts` — 5 cases — exact-threshold (returns false), one px below (true), one px above (false), pre-mount sentinel `0` returns false, custom threshold accepted. (NFR-USE-09, AC6)
- `tests/unit/openChatView.test.ts` — 4 cases — opens new right-sidebar leaf when none exists, reveals + focuses an existing leaf, toggles closed when called with `toggle:true` on the active leaf, returns `'no-op'` when no right leaf is available. (FR-CHAT-01, FR-UI-02, AC2, AC3)
- `tests/dom/chatRoot.test.tsx` (happy-dom + RTL) — 8 cases — all six `data-region` regions render in the mandated order (AC4); `MessageList` exposes `role="log"` + `aria-live="polite"` (NFR-USE-07); the `data-slot="streaming-status"` element inside `HeaderBar` is `role="status"` + `aria-live`; both inline regions are `role="dialog"` + `aria-modal="true"`; full layout above 280 px (no overflow, no `is-collapsed`); collapsed layout below 280 px (overflow button + collapsed root class); `ContextIndicator` swaps its grid for `data-slot="context-summary"` when collapsed; rendered DOM contains zero inline `style` colour literals (AC5).
- `tests/unit/stylesAudit.test.ts` — 6 cases — `styles.css` has no hex / `rgb(a)` / `hsl(a)` colour literals, references the four key Obsidian theme variables, declares the four mandated `--leo-z-*` tokens with values `0 / 100 / 800 / 900` in ascending order (NFR-USE-11, AC9), and declares the `prefers-reduced-motion: reduce` media query (AC6).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The plan-feature open-questions block on `feature.md` is empty; only one judgment call was made: the overflow menu invoked from the collapsed `HeaderBar` is wired to a no-op handler (`ChatView.openOverflowMenu`) for now, since every action that would populate it (skill picker, new thread, plan toggle, …) ships with later features. The seam is in place via the `onOverflowMenu(anchor)` prop so F22 can supply the Obsidian `Menu` instance without restructuring.
- `MessageList` rendered an empty-state copy line ("Start a conversation — Leo's responses will appear here.") so the region has visible content during the F04 slice and the empty-state hook for F04's `FR-UI-07` partner spec is in place; the canonical FR-UI-07 row stays with F03 / F30, and F05 will overwrite this placeholder when it lands.

## Assumptions

- Tests assert AC5/AC9/NFR-USE-10 (no hardcoded colours) by reading `styles.css` for hex / rgb / hsl literals AND by walking the rendered DOM for inline `style` colour literals. WCAG-AA contrast (AC8) is delegated to Obsidian's own theme tokens — every rendered colour resolves through `var(--…)` so theme switches govern contrast. A real-vault contrast measurement is left to the manual smoke (NFR-TEST-04).
- Lifecycle plumbing inside Obsidian's `ItemView` (instantiation, `containerEl.children[1]` host, leaf restore on workspace reopen) is exercised through manual vault testing; the automated coverage proves the React tree mounts/unmounts cleanly via the helper paths and that the ARIA structure is correct.
- `ResizeObserver` is the production path — it is broadly available in the Electron renderer Obsidian ships and degrades cleanly: `ChatRoot` accepts an injected `observeWidth` so tests pass a deterministic synchronous width without depending on the DOM observer.
- `openOrFocusChatView` deliberately returns the right sidebar's leaf even after the user moves the view to the main area — Obsidian itself owns leaf placement after that point (FR-UI-02). Re-opening from ribbon/palette will choose any existing leaf regardless of its placement before falling back to a fresh right-sidebar leaf.

## Open questions

- The `MessageList` empty-state copy was chosen to stay neutral; F05 will replace it with the actual message rendering. If F05 wants a richer empty-state UX (suggested-prompts), the slot is the same `data-region="messages"` wrapper.
- Tooltips for the ribbon and overflow button currently rely on Obsidian's default `aria-label` → tooltip behaviour. Whether Leo wants a distinct tooltip story (e.g. always-visible, mod-key hints) was not pinned by `feature.md`; defaulting to native.
