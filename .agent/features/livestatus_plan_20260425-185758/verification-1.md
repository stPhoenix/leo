# Verification — iteration 1

## 1. Coverage forward (FR/NFR → features)

| Requirement | Covered by |
|---|---|
| FR-01 | F01 |
| FR-02 | F02 |
| FR-03 | F02 |
| FR-04 | F03 |
| FR-05 | F03 |
| FR-06 | F01, F04 |
| FR-07 | F01 |
| FR-08 | F04 |
| FR-09 | F04 |
| FR-10 | F06 |
| FR-11 | F05 |
| FR-12 | F07 |
| FR-13 | F08 |
| FR-14 | F09 |
| FR-15 | F10 |
| FR-16 | F12 |
| FR-17 | F11 |
| FR-18 | F13 |
| FR-19 | F13 |
| FR-20 | F14 |
| NFR-01 | F12 |
| NFR-02 | F02 |
| NFR-03 | F03 |
| NFR-04 | F01, F04, F09, F10 |
| NFR-05 | F04, F05, F06, F07, F11 |
| NFR-06 | F04, F05 |
| NFR-07 | F11 |
| NFR-08 | F13 |
| NFR-09 | F02, F03, F08 |
| NFR-10 | F08 |
| NFR-11 | F03, F11 |
| NFR-12 | F06 |
| NFR-13 | F14 |

PASS.

## 2. Coverage backward (features → covers ≥ 1)

Every feature in `features-index.md` rows 1..14 has a non-empty `covers` column. PASS.

## 3. Dependency graph

Edges (parent → child via `deps`):

```
F01 → F02, F03, F04, F07, F10, F13
F02 → F04, F07, F08, F11
F03 → F04, F05, F06, F08, F11, F13
F04 → F05, F06, F08, F09, F10
F05 → F10, F12
F06 → F13
F08 → F09
F11 → —
F12 → —
F13 → —
F14 ← consumes F01..F12 (no outgoing edges into F14 itself)
```

Topological sort exists (F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, F11, F12, F13, F14). No cycles. No dangling references. PASS.

## 4. UI docs present

`ui-needed = yes` features: F01, F04, F05, F06, F07, F08, F09, F10, F11, F12, F14. Each has a non-empty `features/<slug>/ui.md`. PASS.

## 5. Outline integrity

Every link in `outline.md` resolves to an existing file inside the workspace. Spot-checked: F01-message-blocks/feature.md, F01-message-blocks/ui.md, F02-stream-aggregator/feature.md (no ui), F13-persist-replay/feature.md (no ui), F14-storybook-mocks/feature.md, F14-storybook-mocks/ui.md. PASS.

## 6. Section completeness

Every `feature.md` contains the six required sections (Purpose, Scope, Acceptance criteria, Dependencies, Implementation notes, Open questions). Each `ui.md` contains Layout, State machine, Event flow, Component mapping, Back-link. PASS.

## 7. No duplication in Implementation notes

Spot-checked Implementation notes paragraphs across F01..F14: each bullet is a markdown link plus a single-sentence annotation. No paragraph exceeds 60 words. PASS.

## 8. External link resolution

`.agent/standards/*.md` and `.agent/architecture/architecture.md` and `.agent/srs/livestatus.md` all exist in the repo (verified at workspace setup). All Implementation-notes links resolve. PASS.

## Verdict: PASS
