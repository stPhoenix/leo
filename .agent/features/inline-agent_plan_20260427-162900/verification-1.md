# Verification — iteration 1

## 1. Coverage forward — every FR-IA-* / NFR-IA-* in [context.md](./context.md) appears in at least one feature's `covers`

PASS.

| Requirement | Feature(s) |
|---|---|
| FR-IA-01 | F01 |
| FR-IA-02 | F01 |
| FR-IA-03 | F02 |
| FR-IA-04 | F01 |
| FR-IA-05 | F02 |
| FR-IA-05a | F01 |
| FR-IA-06 | F02 |
| FR-IA-07 | F02 |
| FR-IA-08 | F02 |
| FR-IA-09 | F03 |
| FR-IA-10 | F03 |
| FR-IA-11 | F03 |
| FR-IA-12 | F03 |
| FR-IA-13 | F06 |
| FR-IA-14 | F06 |
| FR-IA-15 | F06 |
| FR-IA-16 | F06 |
| FR-IA-17 | F07 |
| FR-IA-18 | F07 |
| FR-IA-19 | F07 |
| FR-IA-20 | F07 |
| FR-IA-21 | F07 |
| FR-IA-22 | F07 |
| FR-IA-23 | F07 |
| FR-IA-24 | F08 |
| FR-IA-25 | F08 |
| FR-IA-26 | F08 |
| FR-IA-27 | F08 |
| FR-IA-28 | F09 |
| FR-IA-29 | F09 |
| FR-IA-30 | F09 |
| FR-IA-31 | F09 |
| FR-IA-32 | F11 |
| FR-IA-33 | F11 |
| FR-IA-34 | F11 |
| FR-IA-35 | F12 |
| FR-IA-36 | F12 |
| FR-IA-37 | F13 |
| FR-IA-38 | F14 |
| FR-IA-39 | F10 (mech), F14 (orchestration) |
| FR-IA-40 | F15 |
| FR-IA-41 | F04 (helper), F14 (orchestration) |
| FR-IA-42 | F04 |
| FR-IA-43 | F04 |
| FR-IA-44 | F04 |
| FR-IA-45 | F05 |
| FR-IA-46 | F05 |
| FR-IA-47 | F05 |
| FR-IA-48 | F05 |
| FR-IA-49 | F16 |
| FR-IA-50 | F16 |
| FR-IA-51 | F16 |
| NFR-IA-01 | F02 |
| NFR-IA-02 | F06 (boundary referenced; F07/F08/F10 also enforce locally) |
| NFR-IA-03 | F17 |
| NFR-IA-04 | F03 |
| NFR-IA-05 | F05 |
| NFR-IA-06 | F18 |
| NFR-IA-07 | F18 |

## 2. Coverage backward — every feature in [features-index.md](./features-index.md) has at least one entry in `covers`

PASS. F01..F18 all have non-empty `covers` columns; no orphan features.

## 3. Dependency graph — DAG (no cycles, all referenced ids exist)

PASS. Adjacency list (parsed from features-index.md):

- F01 → ∅
- F02 → F01
- F03 → F01
- F04 → F01
- F05 → F01
- F06 → F03, F05
- F07 → F03, F05
- F08 → F03, F05
- F09 → F03, F05
- F10 → F04, F05
- F11 → F01, F02, F04, F05
- F12 → F04, F05, F06, F07, F08, F09
- F13 → F04, F05, F11
- F14 → F04, F05, F06, F07, F08, F10, F13
- F15 → F04, F05, F09, F14
- F16 → F11, F12, F15
- F17 → F16
- F18 → F16

Each edge points to a feature with a strictly lower id; the graph is therefore acyclic. All referenced ids exist in the index.

## 4. UI docs present — every feature with `ui-needed: yes` has a non-empty `features/<slug>/ui.md`

PASS. Only F18 has `ui-needed: yes`. [features/test-fixtures-stories/ui.md](./features/test-fixtures-stories/ui.md) exists with five sections (Layout, State machine, Event flow, Component mapping, Back-link).

## 5. Outline integrity — every markdown link in [outline.md](./outline.md) resolves to an existing file inside the workspace

PASS.
- [context.md](./context.md) — exists.
- [features-index.md](./features-index.md) — exists.
- 18 × `features/<slug>/feature.md` — all exist.
- [features/test-fixtures-stories/ui.md](./features/test-fixtures-stories/ui.md) — exists.

## 6. Section completeness — every `feature.md` has all six required sections filled

PASS. Each of F01–F18 contains: `## Purpose`, `## Scope`, `## Acceptance criteria`, `## Dependencies`, `## Implementation notes`, `## Open questions` — non-empty, prose + bullets, not just headings.

## 7. No duplication — Implementation notes contain links + one-sentence annotations, not restated content

PASS. Every `Implementation notes` section is a bulleted list of links each followed by a single sentence (≤ 60 words). No restated paragraphs from `.agent/architecture/` or `.agent/standards/` were detected in any feature doc.

## 8. External link resolution — every link in any Implementation notes section resolves to an existing file under the project tree

PASS. Verified via filesystem check (see verification log under §"verify" phase entry):
- `.agent/standards/{code-style,tech-stack,best-practices,project-structure}.md` — exist.
- `.agent/srs/external-agent.md` — exists.
- `.agent/budgets/bundle-baseline.json` — exists.
- `scripts/checkBundle.mjs` — exists.
- `src/agent/externalAgent/adapters/base.ts`, `adapterRegistry.ts`, `loggingNamespaces.ts`, `state.ts`, `resultWriter.ts` — exist.
- `src/main.ts`, `.eslintrc.cjs` — exist.
- `src/settings/externalAgentResolver.ts`, `ExternalAgentsSection.tsx` — exist.
- `src/storage/safeStorage.ts`, `src/providers/registry.ts`, `src/providers/openAICompatibleProvider.ts` — exist.
- `src/platform/Logger.ts`, `src/agent/tokenEstimator.ts`, `src/agent/agentRunner.ts` — exist.
- `src/tools/builtin/readFileShared.ts` — exists.
- `src/ui/chat/blocks/{ExternalAgentWidget,ExternalAgentTerminalBlock,AgentProgressTree,TextBlockView,ToolUseBlockView,ToolResultBlockView,ExternalAgentWidget.stories}.tsx` — exist.
- `src/ui/chat/__stories__/mocks/sources.ts`, `.storybook/preview-obsidian-vars.css` — exist.
- `tests/unit/externalAgent/` — exists.

## Verdict: PASS
