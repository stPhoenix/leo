# CM6 manual-integration checklist

Verifies NFR-TEST-03 ("CM6 code validated via manual integration in dev vault"). The releaser opens a
freshly-built Leo plugin inside a dev Obsidian vault, performs each reproduction, and ticks every box below
before signing `tests/smoke/RELEASE.md`.

## Edit lock + readonly decoration ([FR-EDIT-06](../../.agent/features/leo_slice_20260419-190449/context.md#fr-edit-06))

- [ ] **Readonly decoration blocks keystrokes on locked range**
  - Repro: open a markdown note, trigger an agent-driven `edit_note` that locks lines 2–5, then type inside the locked range.
  - Expected: cursor is prevented from mutating lines 2–5; no characters appear; Notice "This range is locked by Leo" surfaces.

- [ ] **Blocked-keystroke Notice appears once per burst**
  - Repro: hold any letter while the lock is active.
  - Expected: one Notice per distinct keystroke burst; no Notice spam at the native key-repeat rate.

## Grouped EditorTransaction single-hop undo ([FR-EDIT-05](../../.agent/features/leo_slice_20260419-190449/context.md#fr-edit-05), [FR-EDIT-09](../../.agent/features/leo_slice_20260419-190449/context.md#fr-edit-09))

- [ ] **Single Ctrl/Cmd-Z reverses an entire agent edit**
  - Repro: accept an `edit_note` turn (spans multiple lines), press Ctrl/Cmd-Z once.
  - Expected: the entire agent mutation reverses in one native undo hop (not per-line).

## Post-edit highlight ([FR-EDIT-08](../../.agent/features/leo_slice_20260419-190449/context.md#fr-edit-08))

- [ ] **3-second highlight flashes and clears**
  - Repro: accept an `edit_note` turn; watch the edited range.
  - Expected: range is highlighted via a CSS theme variable for ~3 s, then the decoration auto-clears.

## Focused Context recompute ([FR-EDIT-01](../../.agent/features/leo_slice_20260419-190449/context.md#fr-edit-01) / [FR-EDIT-02](../../.agent/features/leo_slice_20260419-190449/context.md#fr-edit-02) / [FR-EDIT-03](../../.agent/features/leo_slice_20260419-190449/context.md#fr-edit-03))

- [ ] **Cursor move updates Context indicator within 300 ms**
  - Repro: with the chat view open, move the cursor within the active markdown note.
  - Expected: the Focused Context chip updates (cursor line / char) within 300 ms.

- [ ] **Selection updates Context indicator**
  - Repro: make a multi-line selection.
  - Expected: chip shows selection anchor/head + length.

- [ ] **Viewport scroll updates Context indicator**
  - Repro: scroll the editor viewport.
  - Expected: chip's viewport `{from, to}` range updates within 300 ms.

## Lock release on every exit path ([FR-EDIT-07](../../.agent/features/leo_slice_20260419-190449/context.md#fr-edit-07), [NFR-REL-04](../../.agent/features/leo_slice_20260419-190449/context.md#nfr-rel-04))

- [ ] **Lock clears on Accept**
  - Repro: accept an `edit_note`; try typing anywhere in the note.
  - Expected: typing works everywhere; no residual readonly decoration.

- [ ] **Lock clears on Reject**
  - Repro: reject an `edit_note`; try typing in the (unchanged) range.
  - Expected: typing works everywhere.

- [ ] **Lock clears on cancel mid-stream**
  - Repro: press Stop while the agent is mid-turn and the lock is pending.
  - Expected: lock releases, buffer is unchanged, no stuck decoration.

- [ ] **Lock clears on Obsidian reload**
  - Repro: reload the plugin (Ctrl/Cmd-R) while a lock is active.
  - Expected: on re-open, the note has no readonly decoration and no stale highlight.

## Sign-off

- [ ] All boxes above checked against a fresh `pnpm build` + dev vault.
- [ ] `pnpm smoke` exited green in the same release run.

Signed-off-by: _(releaser)_
Date: _(YYYY-MM-DD)_
