# Impl iteration 1 — F13 ui-visual-states-notifications

## Summary

Shipped the shared visual-state + icon registry + notifications contracts as three new modules under `src/ui/`. `visualStates.ts` exports the exact seven-state union plus `applyVisualState(el, state)` that writes `data-visual-state` + ARIA hints (role / aria-live / aria-busy) per state. `toolIcons.ts` offers `iconFor(toolId)` for built-in `read_note` / `search_vault` / `create_note` / `append_to_note` / `edit_note` tool families and a generic `plug` icon + serverId + label-key for any `mcp.*` pattern, plus a `renderToolIcon` helper that resolves MCP labels via a consumer-supplied lookup. `notifications.ts` exposes the tri-channel `Notifications` helper (`notice` / `status(key, msg)` / `blockingError(host, content)`) plus `requestToolConfirmation(req)` that is routed **only** through an injected `InlineConfirmationHost` (never the native Obsidian `Modal`). `styles.css` got four new `[data-visual-state="…"]` tokens (awaiting-confirmation / error / cancelled / edit-locked), each using Obsidian CSS variables and a `prefers-reduced-motion: reduce` gate that suppresses transitions while keeping the attribute itself live. No new UI was rendered this iteration — F13 is a contract feature; downstream features (F07 already in tree, F17 / F18 / F25 / F29 / F51+) will consume it.

## Files touched

- `src/ui/visualStates.ts` — `VisualState` union, `VISUAL_STATES` const array, `applyVisualState`, `ariaHintFor`.
- `src/ui/toolIcons.ts` — `iconFor` (map + MCP prefix match), `renderToolIcon` (labels lookup).
- `src/ui/notifications.ts` — `Notifications` class with `notice` / `status` / `removeStatus` / `blockingError` / `requestToolConfirmation` / `dispose`; typed `NoticeChannel` / `StatusBarFactory` / `InlineDialogHost` / `InlineConfirmationHost` boundary interfaces.
- `styles.css` — per-state accent tokens using only Obsidian CSS vars (`--color-yellow`, `--text-error`, `--interactive-accent`); extended reduced-motion block to cover `[data-visual-state]` transitions.
- `tests/unit/visualStates.test.ts` — 4 cases (exact state list, attribute write, ARIA transitions across streaming→error→idle, `ariaHintFor` equality).
- `tests/unit/toolIcons.test.ts` — 5 cases (all five built-ins, MCP serverId + labelKey, fallback, render + label lookup, missing-label fallback to serverId).
- `tests/unit/notifications.test.ts` — 6 cases (notice, status create + update, removeStatus, blockingError→inlineDialog, requestToolConfirmation→inlineConfirmation + isNativeModal==false assertion, dispose tears down everything).

## Tests added or updated

- 15 new cases across three files. Full suite: 33 files, 265/265 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The scope references `lucide-react` but the Leo stack already bridges icons through `setIcon(el, name)` (Obsidian's built-in Lucide set). `iconFor` returns the *icon name string* so downstream consumers can invoke `setIcon(el, iconName)`; no `lucide-react` React component is imported, avoiding a duplicate icon pipeline. Matches how the existing `ComposerInput` / `HeaderBar` / `MessageList` already render icons in the codebase.
- `Notifications` wires to boundary interfaces (`NoticeChannel` / `StatusBarFactory` / `InlineDialogHost` / `InlineConfirmationHost`) instead of directly importing `obsidian` runtime values. This keeps the module testable in node and lets `main.ts` (or any future wiring) adapt the real `new Notice(msg)` / `plugin.addStatusBarItem()` / InlineDialog React portal into these shapes on wiring day. The contract is the same; the coupling is the right size for a shared module.

## Assumptions

- Inline modal / inline confirmation hosts expose `isNativeModal()` returning literal `false`. AC6 requires the test to assert the confirmation path never reaches the native Obsidian `Modal` API. The sentinel method is the in-type proof carrier; integration wiring later will provide the actual inline React portal mount.
- `data-visual-state` sits on an already-rendered host (e.g. the chat-root or an individual region). `applyVisualState` mutates the element rather than composing a React context — fits the existing direct-DOM pattern already used by F07 (streaming cursor) and F04 (collapse class).
- The `--color-yellow` / `--text-error` / `--interactive-accent` variables used in the visual-state style block are all already referenced elsewhere in `styles.css` and `stylesAudit.test.ts` checks no regressions.

## Open questions

None.
