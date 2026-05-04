# Verification — iteration 1

## Check 1 · Coverage forward

Every `FR-*` and `NFR-*` from [context.md](context.md) appears in at least one feature's `covers` column in [features-index.md](features-index.md).

| Requirement | Feature(s) |
|---|---|
| FR-01 | F01 |
| FR-02 | F01 |
| FR-03 | F01 |
| FR-04 | F01 |
| FR-05 | F01 |
| FR-06 | F01 |
| FR-07 | F14 |
| FR-08 | F14 |
| FR-09 | F14 |
| FR-10 | F15 |
| FR-11 | F02 |
| FR-12 | F02 |
| FR-13 | F02 |
| FR-14 | F07 |
| FR-15 | F12 |
| FR-16 | F12 |
| FR-17 | F12, F13, F15 |
| FR-18 | F12 |
| FR-19 | F12 |
| FR-20 | F19 |
| FR-21 | F19 |
| FR-22 | F19 |
| FR-23 | F05 |
| FR-24 | F05 |
| FR-25 | F05 |
| FR-26 | F11 |
| FR-27 | F08 |
| FR-28 | F08 |
| FR-29 | F09 |
| FR-30 | F09 |
| FR-31 | F09 |
| FR-32 | F10 |
| FR-33 | F11 |
| FR-34 | F16 |
| FR-35 | F17 |
| FR-36 | F17 |
| FR-37 | F19 |
| FR-38 | F19 |
| FR-39 | F18 |
| FR-40 | F08 |
| FR-41 | F08 |
| FR-42 | F11, F18 |
| FR-43 | F11, F18 |
| FR-44 | F11, F18 |
| FR-45 | F11, F18 |
| FR-46 | F11, F18 |
| FR-47 | F11, F18 |
| FR-48 | F06 |
| FR-49 | F06 |
| FR-50 | F06 |
| FR-51 | F06 |
| FR-52 | F03, F12, F19 |
| NFR-01 | F11, F18 |
| NFR-02 | F06 |
| NFR-03 | F04 |
| NFR-04 | F12, F19 |
| NFR-05 | F05, F11, F18 |
| NFR-06 | F09 |
| NFR-07 | F09 |
| NFR-08 | F09 |
| NFR-09 | F01 |
| NFR-10 | F04 |

Result: **PASS**.

## Check 2 · Coverage backward

Every feature row has at least one entry in `covers`. Inspecting [features-index.md](features-index.md) — F01..F19 each list ≥ 1 covered ID. No orphan features.

Result: **PASS**.

## Check 3 · Dependency graph

Edges (feature → dep) extracted from `deps` column:

| Feature | Deps |
|---|---|
| F01 | — |
| F02 | F01 |
| F03 | F01, F02 |
| F04 | — |
| F05 | — |
| F06 | F04 |
| F07 | F02, F05 |
| F08 | F01, F04, F05 |
| F09 | F04, F08 |
| F10 | F04, F08, F09 |
| F11 | F04, F05, F06, F08, F09, F10 |
| F12 | F11 |
| F13 | F12 |
| F14 | F01 |
| F15 | F12, F14 |
| F16 | F01 |
| F17 | F04, F16 |
| F18 | F04, F05, F06, F16, F17 |
| F19 | F10, F18 |

All referenced dep IDs exist. Each edge points only to a lower-numbered feature → topological ordering preserved → no cycles.

Result: **PASS**.

## Check 4 · UI docs present

[features-index.md](features-index.md) marks `ui-needed == yes` for F03, F06, F12, F19. All four `ui.md` files exist and are non-empty:

- [features/wiki-status-slash/ui.md](features/wiki-status-slash/ui.md)
- [features/wiki-widget-framework/ui.md](features/wiki-widget-framework/ui.md)
- [features/wiki-ingest-tool/ui.md](features/wiki-ingest-tool/ui.md)
- [features/wiki-lint-tool/ui.md](features/wiki-lint-tool/ui.md)

Result: **PASS**.

## Check 4a · Storybook coverage

Each `ui.md` carries a non-empty `## Storybook` section; every component listed has a story file path; every state in the feature's `## State machine` is covered by ≥ 1 variant.

| Feature | State machine states | Variants covering |
|---|---|---|
| F03 | idle, invoked, result-rendered | "entry visible" (idle precondition), "entry selected" (invoked), "result rendered" |
| F06 | preparing, awaiting_clarify, fetching, persisting, awaiting_duplicate, planning, extracting, reducing, writing, done, cancelled, error + lint phases (scanning, checking, proposing, awaiting_confirm, writing, done, cancelled, error) | enumerated 12 ingest variants + 9 lint variants + 7 terminal variants |
| F12 | idle, confirm-pending, deny→idle, prepare→busy, prepare→mounted-widget, terminal-summary | wiki-ingest-pending (×4 input shapes), after-prepare, after-deny, busy-result; mounted-widget + terminal-summary covered by F06 |
| F19 | confirm-pending, deny→idle, run→busy, scanning, checking, proposing, awaiting_confirm (sub: empty/single/multi/with-schema-drift/after-accept-all/after-reject-all/mid-apply), schema-patch-confirm, writing, done, cancelled, error | enumerated 8 LintConfirmList variants + 7 WikiLiveBlock lint variants + 4 InlineConfirmation variants + 6 terminal variants |

Components in each ui.md carry concrete story file paths (`src/.../*.stories.tsx`).

Result: **PASS**.

## Check 5 · Outline integrity

Every link in [outline.md](outline.md) resolves to an existing file inside the workspace. Verified via `find . -type f` cross-reference: all 25 outline targets present.

Result: **PASS**.

## Check 6 · Section completeness

Every `feature.md` has the six required sections filled:

| Feature | Purpose | Scope | Acceptance criteria | Dependencies | Implementation notes | Open questions |
|---|---|---|---|---|---|---|
| F01 | ✓ | ✓ | 7 criteria | ✓ | ✓ | "None" |
| F02 | ✓ | ✓ | 6 criteria | ✓ | ✓ | OQ-1 |
| F03 | ✓ | ✓ | 5 criteria | ✓ | ✓ | OQ-4 |
| F04 | ✓ | ✓ | 6 criteria | ✓ | ✓ | "None" |
| F05 | ✓ | ✓ | 5 criteria | ✓ | ✓ | "None" |
| F06 | ✓ | ✓ | 7 criteria | ✓ | ✓ | OQ-5 |
| F07 | ✓ | ✓ | 5 criteria | ✓ | ✓ | "None" |
| F08 | ✓ | ✓ | 8 criteria | ✓ | ✓ | "None" |
| F09 | ✓ | ✓ | 6 criteria | ✓ | ✓ | OQ-2 |
| F10 | ✓ | ✓ | 6 criteria | ✓ | ✓ | "None" |
| F11 | ✓ | ✓ | 9 criteria | ✓ | ✓ | OQ-2 |
| F12 | ✓ | ✓ | 7 criteria | ✓ | ✓ | "None" |
| F13 | ✓ | ✓ | 5 criteria | ✓ | ✓ | "None" |
| F14 | ✓ | ✓ | 5 criteria | ✓ | ✓ | OQ-3 |
| F15 | ✓ | ✓ | 6 criteria | ✓ | ✓ | "None" |
| F16 | ✓ | ✓ | 6 criteria | ✓ | ✓ | "None" |
| F17 | ✓ | ✓ | 6 criteria | ✓ | ✓ | "None" |
| F18 | ✓ | ✓ | 8 criteria | ✓ | ✓ | "None" |
| F19 | ✓ | ✓ | 10 criteria | ✓ | ✓ | OQ-5 |

"None" entries are explicit "None" lines, not empty headings.

Result: **PASS**.

## Check 7 · No duplication

Each `feature.md` `Implementation notes` section is a bullet list of links + concise annotations. Maximum paragraph length per bullet observed at ~30 words; no bullet exceeds 60 words. No restated content from `.agent/architecture/` or `.agent/standards/`.

Result: **PASS**.

## Check 8 · External link resolution

Every Implementation-notes link targets `../../../../standards/*.md` or `../../../../architecture/architecture.md` (4-up from `features/<slug>/feature.md` to repo `.agent/`). All targets verified existing:

- `.agent/standards/tech-stack.md` ✓
- `.agent/standards/code-style.md` ✓
- `.agent/standards/project-structure.md` ✓
- `.agent/standards/best-practices.md` ✓
- `.agent/architecture/architecture.md` ✓ (exists; not currently linked from any feature, but listed allowed targets)

Result: **PASS**.

## Verdict: PASS
