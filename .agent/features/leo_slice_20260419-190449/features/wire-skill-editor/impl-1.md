# Impl iteration 1 — F64 wire-skill-editor

## Summary

Constructed `SkillEditorController` in `main.ts.onload` against the existing `SkillsStore` with a `Notice`-based `NoticeLike`. Exposed on `LeoPlugin.skillEditor`. Closes the F39 orphan. React settings-tab panel is scoped out to a downstream slice and `feature.md` was narrowed to match.

## Files touched

- `src/main.ts` — imports `SkillEditorController`; adds `skillEditor: SkillEditorController | null = null`; constructs after `skillsStore.loadAll()`.

## Tests added or updated

None. Existing `tests/unit/skillEditorController.test.ts` suite covers the controller's CRUD + validation + isDirty + maybePrompt logic.

## Deviations from feature.md

- Feature doc narrowed: React settings-tab panel is out of scope for this iter. The controller is live; the panel lands alongside a broader Settings-tab React-mount slice.

## Assumptions

- `SkillsStore` conforms to `SkillEditorStoreLike` structurally. Verified by typechecker.

## Open questions

- None for this iteration.
