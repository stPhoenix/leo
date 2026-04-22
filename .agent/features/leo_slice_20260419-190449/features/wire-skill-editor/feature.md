# F64 — Wire skill editor into Settings tab

## Purpose

Close the integration gap left by F39. `SkillEditorController` ships as a domain module with validate / save / delete / duplicate / isDirty + maybePrompt helpers, but is not mounted into the Settings tab. This feature mounts a React-based skill editor pane inside `SettingsTab` "Skills" section so users can create, edit, delete, and duplicate skills through the UI and the changes land in `SkillsStore`.

## Scope

### In scope

- Construct `SkillEditorController` in `main.ts.onload` with the existing `SkillsStore` and a `Notice`-based `NoticeLike` adapter.
- `SkillEditorController` reachable from the entry point (closes the F39 orphan).
- `main.ts` field `skillEditor: SkillEditorController | null` exposed for a future settings-tab React panel to consume.

### Out of scope

- React DOM settings-tab panel (list + form) — ships in a downstream slice that also extends `SettingsTab` with mount points.
- Live preview of skill prompt against a model.
- Skill import/export via clipboard or JSON file.
- Sharing skills across vaults.

## Acceptance criteria

1. Orphan `skills/skillEditorController.ts` becomes reachable from `src/main.ts`; §5.4 audit removes it.
2. `LeoPlugin.skillEditor` is a `SkillEditorController` instance after `onload`, constructed against the live `SkillsStore` with a `Notice`-backed `NoticeLike`.
3. All existing tests stay green.

## Dependencies

F03 (settings tab scaffold) · F21 (skills loader) · F39 (skill editor controller). All `feature-complete`.

## Implementation notes

- [Architecture §3.2 UI](../../../../architecture/architecture.md#32-ui) — Settings-tab React panels attach via a small mount helper inside `SettingsTab`.
- [Code style — React](../../../../standards/code-style.md) — mount via `createRoot`, unmount via `root.unmount()` in `onunload`; no global state in the component.
- F39 compliance-1 calls out "React DOM settings-tab mount parked to main.ts".

## Open questions

- Editing the `allowedTools` field: comma-separated text or multi-select chip picker? Default: multi-select chips sourced from `toolRegistry.toOpenAITools(thread)` names.
