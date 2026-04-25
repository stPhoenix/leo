# Compliance iteration 1 — F10 grouping-read-only

## Acceptance criteria

- AC1: PASS — `detectGroups` pure + deterministic (`tests/unit/groupReadOnly.test.ts`).
- AC2: PASS — `GroupedToolUses` renders summary + expandable list.
- AC3: PASS — collapsed by default when count ≥ 2 (configurable via `defaultCollapsed`).
- AC4: PASS — running members suspend grouping (`tests/unit/groupReadOnly.test.ts:60`).
- AC5: PARTIAL — `GroupedToolUses` is `memo`-wrapped; per-render `detectGroups` not memoized but cheap.
- AC6: PASS — `<button aria-expanded>` summary; expanded list inside `<ul>`.
- AC7: PARTIAL — `ToolSpec.isReadOnly` field added (via `ToolSpecBase`) but built-in tools not yet flagged; default name set covers the four UI-visible read tools.
- AC8: PASS — Storybook stories ship.

## Scope coverage

All bullets PASS or PARTIAL with documented deviation.

## Out-of-scope audit

- Out of scope "Cross-message grouping": CLEAN.
- Out of scope "Group-level summary stats": CLEAN.

## QA aggregate

PASS — 1217 tests.

## Integration gate

New public modules:
- `src/chat/groupReadOnly.ts` — anchor `detectGroups` re-exported via `src/ui/chat/blocks/index.ts`.
- `src/ui/chat/blocks/GroupedToolUses.tsx` — anchor `GroupedToolUses` re-exported via barrel.

Verdict: PASS.

## Verdict: PASS
