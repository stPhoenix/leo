# F67 — Wire UI helpers (visual states, tool icons, notifications)

## Purpose

Close the integration gap left by F13. `ui/visualStates.ts` (`VisualState`, `applyVisualState`, `ariaHintFor`), `ui/toolIcons.ts` (`iconFor`, `renderToolIcon`), and `ui/notifications.ts` (tri-channel Notice / status-bar / inline-modal policy) ship as domain modules but are not referenced from any reachable file. This feature plumbs all three into the live `ChatView` + `MessageList` + `ConfirmationController` / `AcceptRejectController` + plugin status-bar seam so visual states actually drive the DOM, tool icons render next to tool invocations, and the notification tri-channel dispatches through a central policy instead of ad-hoc `new Notice` calls.

## Scope

Scope narrowed following the F62–F64 precedent: this slice closes the three ui/* orphans by standing up a `wireUiHelpers` seam on plugin load and constructing a `Notifications` hub with Obsidian-backed channels. DOM migration (replacing every `new Notice` callsite, applying `applyVisualState` against the ChatView root, rendering tool icons in MessageList) is deferred to a follow-up slice per rule §7.

### In scope

- New `src/ui/wireUiHelpers.ts` helper that constructs a `Notifications` instance with Obsidian-backed `NoticeChannel` / `StatusBarFactory` / `InlineDialogHost` / `InlineConfirmationHost` seams and re-exports `applyVisualState`, `ariaHintFor`, `iconFor`, `renderToolIcon` so downstream consumers import from one place.
- `main.ts.onload` constructs the wiring and holds it as `this.uiHelpers`; `onunload` calls `notifications.dispose()` so outstanding status-bar items + dialog handles are released.
- Unit tests: hub dispatches `notice` / `status` / `blockingError` / `requestToolConfirmation` through the injected channels; `dispose()` clears status items and active dismissers.

### Out of scope

- Replacing existing `new Notice` callsites in wired subsystems — deferred.
- Mounting `applyVisualState(el, state)` against the live ChatView root — deferred.
- Rendering `renderToolIcon` in `MessageList` — deferred.
- New visual states beyond those F13 codifies.
- Custom icon art.
- i18n of notice strings.

## Acceptance criteria

1. Orphans `ui/visualStates.ts`, `ui/toolIcons.ts`, `ui/notifications.ts` become reachable from `src/main.ts`; §5.4 audit removes them.
2. `wireUiHelpers` constructs a `Notifications` instance with the four Obsidian-backed channels and exposes it as `hub` on the return value.
3. `wireUiHelpers.dispose()` calls `Notifications.dispose()` and is idempotent.
4. `wireUiHelpers` re-exports `applyVisualState`, `ariaHintFor`, `iconFor`, `renderToolIcon` for downstream callers.
5. All existing tests stay green; new tests added per §Scope.

## Dependencies

F04 (ChatView shell) · F05 (MessageList) · F13 (UI visual states / notifications / tool icons) · F17 (confirmation controller). All `feature-complete`. Likely runs after the other wire-up features so the `new Notice` callsites to migrate exist first.

## Implementation notes

- [Architecture §3.2 UI — States](../../../../architecture/architecture.md#32-ui) — visual-state dispatch lives on `ChatView` root, not on each component.
- F13 compliance-1 documents the tri-channel policy and the per-state class table.
- Migrating `new Notice` callsites: do it last so we catch every one, including those introduced by the other wire-up features.

## Open questions

- Should `NotificationsHub` own a toast history panel (like a log of recent Notices)? Default: no, just routing.
- Inline-dialog queueing when two high-severity errors arrive in the same tick? Default: latest wins; previous is dismissed with a `Logger.warn("notifications.hub.dismissed", { reason: 'preempted' })`.
