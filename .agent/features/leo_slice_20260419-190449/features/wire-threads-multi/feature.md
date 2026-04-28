# F63 — Wire multi-thread management

## Purpose

Close the integration gap left by F37. `ThreadsStore` ships as a domain module with full CRUD (create / switch / rename / delete / restore), title metadata, and a soft-delete trash with configurable undo window, but is not constructed, not connected to `ConversationStore`, not surfaced in `HeaderBar`, and not exposed as a command. Today the plugin hard-codes `DEFAULT_THREAD_ID`. This feature wires a `ThreadsStore` in `onload`, replaces the hard-coded default with the currently-active thread, mounts a thread picker dropdown in `HeaderBar`, adds "Leo: New thread" to the command palette, and shows a `Notice` with Undo on delete.

## Scope

### In scope

- Construct `ThreadsStore` rooted at `.leo/conversations/` (via the existing `VaultAdapter`) with the default undo window and a `Notice`-based onNotify channel that surfaces an `Undo` link fragment.
- Call `threadsStore.init()` on plugin load so the default thread folder exists and `activeId` resolves.
- Register `Leo: New thread` palette command that calls `create()` + `switch(id)`.
- `ThreadsStore` is reachable from `main.ts` (closes the F37 orphan).

### Out of scope

- HeaderBar dropdown UI for switching threads — belongs to a downstream HeaderBar-extension slice; requires refactoring `streamStarter` / `analyzeContextForChat` / `resolveActiveSkill` / `buildSkillPickerSource` to read the active thread id from `ThreadsStore` rather than `DEFAULT_THREAD_ID`.
- `Leo: Rename thread` + `Leo: Delete thread` palette commands — hinge on picking a target thread, which wants the HeaderBar UI to be mature first.
- Cross-thread search or global history view.
- Renaming history with full edit log.
- Per-thread skill isolation differences (F22 already handles this).

## Acceptance criteria

1. Orphan `storage/threadsStore.ts` becomes reachable from `src/main.ts`; §5.4 audit removes it.
2. `LeoPlugin.threadsStore` is a `ThreadsStore` instance after `onload`; `init()` creates the default thread folder and returns the active id.
3. Command `Leo: New thread` creates a new thread, switches to it, and emits a `Notice` confirming the action.
4. `onNotify` wires the Obsidian `Notice` API with an inline `Undo` link fragment for delete flows (ready for a future `Leo: Delete thread` command).
5. All existing tests stay green.

## Dependencies

F14 (conversation persistence) · F22 (skills picker — per-thread skill) · F37 (threads store). `F63` runs after the earlier wire-up slices that extend `HeaderBar` are not required; HeaderBar is already shipped in F04.

## Implementation notes

- [Architecture §5 Lifecycle — Thread switch](../../../../architecture/architecture.md#5-lifecycle) — switching the active thread triggers reload; no mid-turn switch allowed.
- [Architecture §6 State Ownership — Conversations](../../../../architecture/architecture.md#6-state-ownership) — per-thread folders under `.leo/conversations/<id>/`; trash at `.leo/conversations/.trash/`.
- F37 compliance-1 calls out "HeaderBar UI + command palette + Notice buttons parked to main.ts".
- Notice with Undo: use `new Notice(fragment, timeout)` where `fragment` contains a clickable element; Obsidian supports this via the `DocumentFragment` constructor.
- For rename prompt, reuse the existing `SettingsTab` modal pattern or a light custom `Modal` subclass.

## Open questions

- Switching threads while a turn is in flight: reject or force-cancel? Default: reject with a `Notice` "Wait for the current turn to finish."
- Default title for a new thread: timestamp or "Untitled"? Default: `Untitled` with timestamp as tooltip.
