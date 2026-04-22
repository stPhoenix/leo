# Impl iteration 1 — F39 skill-editor-ui

## Summary

Added `SkillEditorController` at `src/skills/skillEditorController.ts` — a pure state controller wired through F21's existing `SkillsStore` seam — implementing every AC behaviour the settings-tab editor needs: list enumeration with `source` tagging, blank-draft creation with auto-kebab id + collision retry, read-only gating of built-ins via `isEditable(id)`, Zod-equivalent field validation (required id/name/systemPrompt, kebab id pattern, duplicate-id guard on create only, per-example shape validation), save routing through `SkillsStore.save` with `{source:'user'}` enforcement, delete routing through `SkillsStore.delete` with a bound-thread warning message computed from an injectable `ThreadBindingsLookup`, duplicate routing through `cloneBuiltin` (builtin source) or a fresh `save` (user source) with `baseId-copy` / `baseId-copy-N` collision avoidance, and a pure `isDirty(original, current)` diff for the unsaved-changes guard. Every mutation emits a structured `skills.editor.save|delete|duplicate` event via the injected Logger + fires a user-facing `Notice` via the injected `NoticeLike` channel; failures log `*-failed` variants and leave the store untouched. A sibling `maybePrompt` helper composes the controller with an `openPrompt` callback to implement the Save / Discard / Cancel three-way unsaved-changes flow.

## Files touched

- `src/skills/skillEditorController.ts` — new ~260-line module. Exports `SkillEditorController` class, `SkillDraft` / `SkillValidationError` / `SkillEditorStoreLike` / `SkillEditorOptions` / `ThreadBindingsLookup` / `NoticeLike` types, `UnsavedChangesDecision` type, `maybePrompt` helper.

## Tests added or updated

- `tests/unit/skillEditorController.test.ts` — 18 cases:
  - list returns built-ins + user skills (AC1).
  - `openDraftForNew` emits fresh kebab id w/ collision-retry (AC4 create flow seed).
  - `isEditable` false for built-ins, true for user, false for unknown (AC3).
  - validate flags missing required fields (id / name / systemPrompt) (AC2).
  - validate flags non-kebab id (AC2 + F21 Zod parity).
  - validate flags duplicate id on create but not on edit (AC4).
  - save on valid draft persists + logs `skills.editor.save` (AC2, AC8).
  - save blocks on validation errors without calling store (AC2).
  - save blocks on duplicate id (AC4).
  - `deleteConfirmationMessage` includes bound-thread warning copy when threads > 0 (AC5).
  - `deleteConfirmationMessage` omits warning when threads === 0 (AC5).
  - `deleteUserSkill` rejects built-ins (AC3 invariant parity with store).
  - `deleteUserSkill` removes + logs `skills.editor.delete` (AC5, AC8).
  - `duplicate(builtin)` routes through `cloneBuiltin` + logs `skills.editor.duplicate` (AC6, AC8).
  - `duplicate(user)` saves a fresh copy via store.save (AC6).
  - duplicate avoids id collision on repeat duplicates (`general-copy` → `general-copy-2`) (AC6 + feature Open question §4).
  - `isDirty` detects differences across every editable field (AC7 seed).
  - save surfaces store errors as `Notice` + `*-failed` log + `ok:false` (AC8 error path).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **React DOM settings-tab view parked to the main.ts integration slice.** Feature § "A `SkillEditor` React surface mounted in the Skills section" describes a React component inside Obsidian's `PluginSettingTab`. Every F39 AC that is testable at the controller level is covered here; the React view is a thin binding that reads `controller.list()`, renders rows with source badges, binds form state to `controller.validate / save / deleteUserSkill / duplicate`, and wires the unsaved-changes `maybePrompt` to a three-button modal. The DOM tests for that view belong to a follow-up DOM test slice; the controller-level tests already exercise every data-flow contract.
- **Zod schema mirroring is done with hand-rolled predicates.** The project already replaced Zod with hand-rolled validators (see every prior feature since F16). F21's `parseSkillFile` / `validateSkill` continue to own the on-disk schema; this controller's `validate()` mirrors the field-required invariants (id / name / systemPrompt) + enforces kebab-id pattern + duplicate-id + per-example shape. The in-form validation is identical to F21's file-level validation in every assertable way.
- **Thread-bindings lookup is injected rather than coupled to F14.** Feature AC5 says "queried via F14 metadata". The controller takes a `ThreadBindingsLookup` adapter that the main.ts integration slice binds to a `F14 ConversationStore.iterateThreads()` or (post-F37) a `ThreadsStore.list()` call that counts `metadata.skillId === targetId`. This keeps the controller test-isolated from F14/F37 wiring.
- **`defaultModel` datalist suggestions parked.** Feature § "`defaultModel?` free-text with datalist suggestions from the provider" — datalist sourcing belongs to the DOM layer; the controller treats `defaultModel` as a plain optional string.

## Assumptions

- The settings-tab mount composes: (a) `const controller = new SkillEditorController({store: skillsStore, logger, threadBindings, notice});` (b) a React view subscribes to `store.list()` via the FS-watch refresh event F21 already emits (F21 exposes a `watch()` seam or re-calls `loadAll()` on debounce; either plugs into React via `useSyncExternalStore`).
- The unsaved-changes dialog uses Obsidian's modal primitive — `maybePrompt` accepts an `openPrompt(p)` callback so the DOM layer owns which UI primitive renders the Save/Discard/Cancel buttons.
- Every `{id}` emitted via log events + `notice.notify` payloads is the skill id, not the display name. Name is permitted in the Notice string but not in the structured log `fields` object (consistent with NFR-LOG-04 practice for user-facing strings vs telemetry).
- Built-in skill source is normatively `'builtin'`; the controller trusts `skill.source` from the store.

## Open questions

- Unsaved-changes dialog copy + Esc semantics (feature AC7) — `maybePrompt` emits `'save'|'discard'|'cancel'`; the DOM binding picks up the Esc behaviour.
- Repeat-duplicate naming (feature Open question §4) — shipped as `-copy`, `-copy-2`, `-copy-3`. Verifier to confirm vs `"Foo (copy) (copy)"` naming.
- `defaultModel` autocomplete source (feature Open question §5) — DOM-layer concern.
- Examples-editor UX (feature Open question §6) — DOM-layer concern; controller treats examples as an opaque `readonly {user,assistant}[]`.
