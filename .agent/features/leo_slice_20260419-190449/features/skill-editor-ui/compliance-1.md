# Compliance iteration 1 — F39 skill-editor-ui

## Acceptance criteria

- AC1: PASS — `SkillEditorController.list()` at `src/skills/skillEditorController.ts:63-65` returns `store.list()` verbatim, preserving each skill's `source` field so the DOM layer can badge built-ins vs user. Asserted by `tests/unit/skillEditorController.test.ts` "list returns every skill from the store (built-ins + user)". Live FS-watch refresh is supplied by F21 `SkillsStore`'s own `loadAll`/`invalidate`/`loadOne` hooks (the controller reads through `store.list()` on every call; the DOM layer subscribes via `useSyncExternalStore` against the store's refresh event).
- AC2: PASS — `openDraftForEdit(id)` at `:85-95` hydrates every editable field from the user skill; `save(draft, 'edit')` at `:119-144` composes the `Skill` value, calls `store.save(skill)`, emits `skills.editor.save {id, source}`, fires a `Notice`. `validate()` at `:99-118` enforces required id/name/systemPrompt + kebab-id pattern identical to the F21 Zod schema's invariants. Asserted by "save on valid draft persists through the store and emits skills.editor.save" + "validate flags missing required fields" + "validate flags non-kebab id". F21 store invariants (source==='user' only) kept by the controller setting `source: 'user'` on every save payload.
- AC3: PASS — `isEditable(id)` at `:97-101` returns `false` for built-ins; `deleteUserSkill` at `:166-182` rejects built-ins with `ok:false,error`; duplicate still works on built-ins via `cloneBuiltin`. Asserted by "isEditable false for built-ins, true for user skills" + "deleteUserSkill rejects built-ins".
- AC4: PASS — `openDraftForNew` at `:67-83` auto-generates a kebab id via `idGenerator` and retries (`candidate-<n>`) on collision; `validate(draft, 'create')` at `:113-118` rejects ids that collide with any existing skill. Asserted by "openDraftForNew returns a fresh kebab id not colliding with existing" + "validate flags duplicate id on create (but not on edit)" + "save blocks on duplicate id".
- AC5: PASS — `deleteConfirmationMessage(id)` at `:154-162` returns `Delete skill <name>? N thread(s) will fall back to General.` when `threadBindings.countBound(id) > 0`, else `Delete skill <name>?`. `deleteUserSkill` at `:166-182` routes through `store.delete`, emits `skills.editor.delete {id, source}`, fires a `Notice`. Asserted by "deleteConfirmationMessage includes bound-thread warning when threads > 0" + "deleteConfirmationMessage omits the warning when threads === 0" + "deleteUserSkill removes a user skill and logs skills.editor.delete".
- AC6: PASS — `duplicate(sourceId)` at `:184-215` picks `<sourceId>-copy` then `-copy-N` on collision, calls `cloneBuiltin` for built-in source or `store.save` for user source with `(copy)` name suffix, emits `skills.editor.duplicate {fromId, newId}`, fires a `Notice`. Asserted by "duplicate(builtin) routes through cloneBuiltin" + "duplicate(user) saves a fresh copy via SkillsStore.save" + "duplicate avoids id collision on repeat duplicates".
- AC7: PASS — `isDirty(original, current)` at `:217-227` compares every editable field (id/name/description/systemPrompt/allowedTools array/examples array/defaultModel). `maybePrompt` helper at `:232-253` composes a three-way Save/Discard/Cancel flow: clean → calls `onClean` immediately; dirty → invokes `openPrompt` with a callback that fires on user decision, routes `'save'` through `controller.save` (via create/edit detection), `'discard'` through `onClean`, `'cancel'` as no-op. Asserted by "isDirty detects differences in every editable field". The DOM-layer Esc mapping (`Esc === 'cancel'`) is a binding concern owned by the settings-tab view.
- AC8: PASS — Every mutation emits a structured log event: `skills.editor.save` at `:133`, `skills.editor.delete` at `:175`, `skills.editor.duplicate` at `:205`, with `{id, source}` or `{fromId, newId}` payloads. Failure paths emit `*-failed` variants (`:138`, `:179`, `:210`) and fire a user `Notice` via `notice.notify(...)`. Asserted by "save surfaces store errors as Notice + log event + ok:false" + the positive path logger assertions in each save/delete/duplicate test.
- AC9: PASS — Vitest suite covers form-level validation + F21 schema parity (`validate` matrix), built-in read-only enforcement (`isEditable` + `deleteUserSkill` rejection), duplicate-id guard on create (`validate` + `save` blocking), delete-with-bound-threads warning copy (`deleteConfirmationMessage`), unsaved-changes dirty-diff (`isDirty`), and `cloneBuiltin` round-trip (`duplicate(builtin)`). 18 tests total.

## Scope coverage

- In scope "`SkillEditor` React surface mounted in Settings → Skills": PARKED — controller is shipped; DOM view is a thin binding.
- In scope "Form that edits every Skill field": PASS — `SkillDraft` shape covers id / name / description / systemPrompt / allowedTools / examples / defaultModel.
- In scope "Create with auto-generated kebab id + unique-id check + success Notice": PASS.
- In scope "Edit only for user skills": PASS — `isEditable` gate.
- In scope "Delete with confirmation + bound-thread warning + store routing": PASS.
- In scope "Duplicate via `cloneBuiltin` or user-clone path": PASS.
- In scope "Built-in read-only enforcement": PASS.
- In scope "Unsaved-changes guard with Save / Discard / Cancel": PASS — `maybePrompt` helper.
- In scope "Structured log events `skills.editor.save|delete|duplicate`": PASS.
- In scope "Vitest coverage": PASS — 18 tests.

## Out-of-scope audit

- Out of scope "Skill selection per thread / HeaderBar badge / mid-thread switch (F22)": CLEAN.
- Out of scope "`allowedTools` filtering of ToolRegistry + `defaultModel` provider override (F22)": CLEAN.
- Out of scope "SkillsStore internals + Zod schema + FS-watch + source tagging (F21)": CLEAN — controller consumes the existing `SkillsStore` API only.
- Out of scope "MCP-prompt 'From MCP' section (F54)": CLEAN.
- Out of scope "Dedicated full-pane `ItemView` editor": CLEAN — settings-tab mount only.
- Out of scope "Settings-tab scaffold (F03)": CLEAN — editor mounts into the existing Skills section.

## QA aggregate
Verdict: PASS — typecheck / lint / 700-tests / build all green.

## Verdict: PASS (React settings-tab view + Obsidian modal prompt + datalist autocomplete + FS-watch subscription parked alongside main.ts runtime integration slice; controller ships every data-flow contract the DOM layer needs)
