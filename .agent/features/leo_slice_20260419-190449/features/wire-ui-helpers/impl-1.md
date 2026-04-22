# Impl iteration 1 — F67 wire-ui-helpers

## Summary

Scope narrowed in `feature.md` following the F62–F64 precedent: this slice closes the three `ui/*` orphans (`visualStates.ts`, `toolIcons.ts`, `notifications.ts`) by standing up a `wireUiHelpers` factory on plugin load. The helper constructs a `Notifications` hub with Obsidian-backed `NoticeChannel` / `StatusBarFactory` and stub `InlineDialogHost` / `InlineConfirmationHost` seams (the inline hosts are replaced once a follow-up slice mounts them inside `ChatRoot`), and re-exports `applyVisualState` / `ariaHintFor` / `iconFor` / `renderToolIcon` so downstream callers import from one place. Replacing every `new Notice` callsite, applying `applyVisualState` against the live ChatView root, and rendering tool icons in `MessageList` are explicitly deferred to a follow-up slice per rule §7.

## Files touched

- `src/ui/wireUiHelpers.ts` — new, 56 lines.
- `src/main.ts` — import `wireUiHelpers` + `UiHelpersWiring`, add `uiHelpers` plugin field, construct after `wireAttachments`, dispose in `onunload`.
- `tests/unit/wireUiHelpers.test.ts` — new, 3 cases under happy-dom: re-exports, hub dispatch through channels, idempotent dispose.

## Tests added or updated

- `tests/unit/wireUiHelpers.test.ts`. 1057/1057 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Inline-dialog / inline-confirmation hosts in the Obsidian seam are currently no-op stubs (`mount: () => () => undefined`). They become real hooks when the follow-up slice wires `ChatRoot` into the hub. This is called out here so the next author does not mistake the stubs for finished wiring.

## Assumptions

- `this.addStatusBarItem()` returns an Obsidian `HTMLElement` with `setText` + `detach`; the status-bar adapter uses those APIs directly.
- Future follow-up slices will replace the stub inline hosts and migrate `new Notice` callsites.

## Open questions

None — the feature-md questions (toast history, preemption policy) are deferred along with the DOM migration.
