# Verification — iteration 1

## 1. Coverage forward — every requirement appears in `features-index.md`'s `covers`

| Requirement | Feature(s) covering | Status |
|---|---|---|
| FR-OF-01 | F02 | PASS |
| FR-OF-02 | F02 | PASS |
| FR-OF-03 | F02, F05 | PASS |
| FR-OF-04 | F03 | PASS |
| FR-OF-05 | F03 | PASS |
| FR-OF-06 | F03 | PASS |
| FR-OF-07 | F03 | PASS |
| FR-OF-08 | F05 | PASS |
| FR-OF-09 | F04 | PASS |
| FR-OF-10 | F04 | PASS |
| FR-OF-11 | F04 | PASS |
| FR-OF-12 | F04 | PASS |
| FR-OF-13 | F02, F05 | PASS |
| FR-OF-14 | F05 | PASS |
| FR-OF-15 | F05 | PASS |
| FR-OF-16 | F05 | PASS |
| FR-OF-17 | F05 | PASS |
| FR-OF-18 | F05 | PASS |
| FR-OF-19 | F03, F05 | PASS |
| FR-OF-20 | F03, F05 | PASS |
| FR-OF-21 | F02 | PASS |
| FR-OF-22 | F05 | PASS |
| FR-OF-23 | F01, F07 | PASS |
| FR-OF-24 | F01, F07 | PASS |
| FR-OF-25 | F06 | PASS |
| FR-OF-26 | F06 | PASS |
| FR-OF-27 | F04, F05 | PASS |
| FR-OF-28 | F04 | PASS |
| FR-OF-29 | F05 | PASS |
| FR-OF-30 | F02, F05 | PASS |
| NFR-OF-01 | F03, F05 | PASS |
| NFR-OF-02 | F05 | PASS |
| NFR-OF-03 | F05 | PASS |
| NFR-OF-04 | F02 | PASS |
| NFR-OF-05 | F02, F05 | PASS |
| NFR-OF-06 | F06 | PASS |
| NFR-OF-07 | F02, F03, F04, F05, F08 | PASS |
| NFR-OF-08 | F02, F03 | PASS |
| NFR-OF-09 | F02, F05 | PASS |
| NFR-OF-10 | F01, F02 | PASS |

All 30 FRs and all 10 NFRs from `context.md` map to ≥ 1 feature.

**Result:** PASS.

## 2. Coverage backward — every feature row has at least one `covers` entry

| Feature | covers (non-empty) |
|---|---|
| F01 openfang-config-schema | FR-OF-23, FR-OF-24, NFR-OF-10 |
| F02 openfang-http-client | FR-OF-01, FR-OF-02, FR-OF-03, FR-OF-13, FR-OF-21, FR-OF-30, NFR-OF-04, NFR-OF-05, NFR-OF-08, NFR-OF-09, NFR-OF-10 |
| F03 openfang-polling | FR-OF-04, FR-OF-05, FR-OF-06, FR-OF-07, FR-OF-19, FR-OF-20, NFR-OF-01, NFR-OF-08 |
| F04 openfang-artifacts | FR-OF-09, FR-OF-10, FR-OF-11, FR-OF-12, FR-OF-27, FR-OF-28 |
| F05 openfang-adapter | FR-OF-08, FR-OF-13, FR-OF-14, FR-OF-15, FR-OF-16, FR-OF-17, FR-OF-18, FR-OF-19, FR-OF-22, FR-OF-27, FR-OF-29, FR-OF-30, NFR-OF-01, NFR-OF-02, NFR-OF-03, NFR-OF-05, NFR-OF-09 |
| F06 openfang-registration | FR-OF-25, FR-OF-26, NFR-OF-06 |
| F07 openfang-settings-stories | FR-OF-23, FR-OF-24 |
| F08 openfang-integration-test | NFR-OF-07 |

**Result:** PASS.

## 3. Dependency graph — DAG, no cycles, no dangling refs

```
F01 ─► F02 ─┬─► F03 ─┐
            ├─► F04 ─┤
            │        │
            └────────┴─► F05 ─► F06 ─► F08
                              │
                              └─► F07
```

- All `deps` references (F01, F02, F03, F04, F05, F06) point to features that exist in the index.
- Topological linearization F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08 matches the index `#` ordering.
- No back-edges; no cycles.

**Result:** PASS.

## 4. UI docs present — every `ui-needed=yes` feature has a non-empty `ui.md`

| Feature | ui-needed | ui.md present |
|---|---|---|
| F01 openfang-config-schema | no | n/a |
| F02 openfang-http-client | no | n/a |
| F03 openfang-polling | no | n/a |
| F04 openfang-artifacts | no | n/a |
| F05 openfang-adapter | no | n/a |
| F06 openfang-registration | no | n/a |
| F07 openfang-settings-stories | yes | `features/openfang-settings-stories/ui.md` (6 H2 sections, non-empty) |
| F08 openfang-integration-test | no | n/a |

**Result:** PASS.

## 4a. Storybook coverage — every `ui.md` has a non-empty `## Storybook` section; every state in `## State machine` is covered by ≥ 1 variant

`features/openfang-settings-stories/ui.md`:
- `## Storybook` section is non-empty: 4-row story matrix (`OpenfangConfigured`, `OpenfangSecretRevealed`, `OpenfangDisabled`, `OpenfangInvalidBaseUrl`).
- Every component listed has a story-file path: `src/settings/ExternalAgentsSection.stories.tsx` (existing, additive).
- State-machine coverage table at end of §Storybook:
  - `Loaded (populated)` → `OpenfangConfigured`
  - `Revealed` → `OpenfangSecretRevealed`
  - `Loaded (disabled-default fallback)` → `OpenfangDisabled`
  - `Editing → Loaded (validation reject)` → `OpenfangInvalidBaseUrl`
- All four states map to ≥ 1 variant.

**Result:** PASS.

## 5. Outline integrity — every link in `outline.md` resolves to an existing file inside the workspace

Verified by python `os.path.isfile` against every relative target:

```
OK context.md
OK features-index.md
OK features/openfang-config-schema/feature.md
OK features/openfang-http-client/feature.md
OK features/openfang-polling/feature.md
OK features/openfang-artifacts/feature.md
OK features/openfang-adapter/feature.md
OK features/openfang-registration/feature.md
OK features/openfang-settings-stories/feature.md
OK features/openfang-settings-stories/ui.md
OK features/openfang-integration-test/feature.md
```

11 / 11 links resolve.

**Result:** PASS.

## 6. Section completeness — every `feature.md` has all six required sections filled

`grep -c '^## '` ran against every `feature.md` returned `6`; all six section headings are present in each file:

| File | Sections |
|---|---|
| F01 feature.md | Purpose / Scope / Acceptance criteria / Dependencies / Implementation notes / Open questions |
| F02 feature.md | same six |
| F03 feature.md | same six |
| F04 feature.md | same six |
| F05 feature.md | same six |
| F06 feature.md | same six |
| F07 feature.md | same six |
| F08 feature.md | same six |

Each section body is non-empty (verified by spot-reading during authoring; no stub headings without content).

**Result:** PASS.

## 7. No duplication — `Implementation notes` sections contain links, not restated content

Programmatic check: split each `Implementation notes` section into double-newline-separated paragraphs; flag any non-list-item paragraph > 60 words. Result: zero flagged paragraphs across all 8 feature.md files. Every entry under `Implementation notes` is either a bullet item with one short annotation + a markdown link or a similarly bounded reference — no restated content from `.agent/architecture/architecture.md` or `.agent/standards/*.md`.

**Result:** PASS.

## 8. External link resolution — every link in any `Implementation notes` section resolves to an existing file under the project

Programmatic check: for every link in `Implementation notes`, resolve relative to the feature.md's directory and check `os.path.exists`. Anchor-only links are skipped; cross-doc links are resolved against the file path. Result: zero misses.

Targets that resolved (deduplicated):
- `../../../../standards/code-style.md`
- `../../../../standards/tech-stack.md`
- `../../../../standards/project-structure.md`
- `../../../../architecture/architecture.md`
- `../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md`
- `../../../external-agent_slice_20260427-022536/features/run-phase/feature.md`
- `../../../external-agent_slice_20260427-022536/features/settings-ui/feature.md`
- `../../../external-agent_slice_20260427-022536/features/settings-ui/ui.md`
- `../../../external-agent_slice_20260427-022536/features/logging-bundle/feature.md`
- in-slice cross-feature links (e.g. `../openfang-config-schema/feature.md`) — all resolve

**Result:** PASS.

## Verdict: PASS
