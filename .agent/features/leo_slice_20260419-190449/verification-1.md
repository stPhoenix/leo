# Verification — iteration 1

Workspace: `/home/bs/PycharmProjects/leo/.agent/features/leo_slice_20260419-190449`
Artifacts audited: `context.md`, `features-index.md`, `outline.md`, 57 `features/<slug>/feature.md`, UI docs where `ui-needed=yes`.
Tooling: custom Python parsers over the features-index table + markdown scanners; all 899 Implementation-notes external links and all 79 outline links were resolved on the filesystem.

## Check 1 — Coverage forward

Every `FR-*` / `NFR-*` ID mined from `context.md` `## Functional requirements` and `## Non-functional requirements` sections (163 IDs total) appears in at least one feature row's `covers` column in `features-index.md`.

- IDs extracted from context.md sections (lines 48–295): 163.
- Distinct IDs appearing in features-index.md `covers` columns: 163.
- `set(context) \ set(index)` = `∅`.
- `set(index) \ set(context)` = `∅` (no phantom IDs).

### Coverage table (requirement → features)

| Requirement | Features |
|---|---|
| FR-AGENT-01 | F10 |
| FR-AGENT-02 | F33 |
| FR-AGENT-03 | F10 |
| FR-AGENT-04 | F16 |
| FR-AGENT-05 | F20 |
| FR-AGENT-06 | F16 |
| FR-AGENT-07 | F10 |
| FR-AGENT-08 | F10 |
| FR-AGENT-09 | F10 |
| FR-AGENT-10 | F17 |
| FR-AGENT-11 | F17 |
| FR-AGENT-12 | F22 |
| FR-CHAT-01 | F04 |
| FR-CHAT-02 | F05 |
| FR-CHAT-03 | F06 |
| FR-CHAT-04 | F07 |
| FR-CHAT-05 | F07 |
| FR-CHAT-06 | F05 |
| FR-CHAT-07 | F15 |
| FR-CHAT-08 | F14 |
| FR-CHAT-09 | F09 |
| FR-CHAT-10 | F11 |
| FR-CHAT-11 | F12 |
| FR-CHAT-12 | F22 |
| FR-CHAT-13 | F17 |
| FR-COMPACT-01 | F43 |
| FR-COMPACT-02 | F41 |
| FR-COMPACT-03 | F43 |
| FR-COMPACT-04 | F43 |
| FR-COMPACT-05 | F43 |
| FR-COMPACT-06 | F44 |
| FR-COMPACT-07 | F42 |
| FR-CTX-01 | F47 |
| FR-CTX-02 | F46 |
| FR-CTX-03 | F47 |
| FR-CTX-04 | F47 |
| FR-CTX-05 | F48 |
| FR-CTX-06 | F48 |
| FR-EDIT-01 | F08 |
| FR-EDIT-02 | F08 |
| FR-EDIT-03 | F08 |
| FR-EDIT-04 | F08 |
| FR-EDIT-05 | F18 |
| FR-EDIT-06 | F18 |
| FR-EDIT-07 | F18 |
| FR-EDIT-08 | F18 |
| FR-EDIT-09 | F20 |
| FR-IDX-01 | F27 |
| FR-IDX-02 | F27 |
| FR-IDX-03 | F27 |
| FR-IDX-04 | F27 |
| FR-IDX-05 | F27 |
| FR-IDX-06 | F28 |
| FR-IDX-07 | F28 |
| FR-IDX-08 | F29 |
| FR-IDX-09 | F29 |
| FR-IDX-10 | F34 |
| FR-IDX-11 | F34 |
| FR-IDX-12 | F27 |
| FR-IDX-13 | F30 |
| FR-IDX-14 | F30 |
| FR-MCP-01 | F51 |
| FR-MCP-02 | F51 |
| FR-MCP-03 | F51 |
| FR-MCP-04 | F51 |
| FR-MCP-05 | F51 |
| FR-MCP-06 | F51 |
| FR-MCP-07 | F52 |
| FR-MCP-08 | F53 |
| FR-MCP-09 | F54 |
| FR-MCP-10 | F55 |
| FR-MCP-11 | F56 |
| FR-MCP-12 | F56 |
| FR-PLAN-01 | F23 |
| FR-PLAN-02 | F23 |
| FR-PLAN-03 | F24 |
| FR-PLAN-04 | F24 |
| FR-PLAN-05 | F24 |
| FR-PLAN-06 | F23 |
| FR-PLAN-07 | F25 |
| FR-PLAN-08 | F24 |
| FR-PLAN-09 | F26 |
| FR-PROV-01 | F02 |
| FR-PROV-02 | F02 |
| FR-PROV-03 | F02 |
| FR-PROV-04 | F16 |
| FR-PROV-05 | F02 |
| FR-PROV-06 | F02 |
| FR-PROV-07 | F02 |
| FR-PROV-08 | F02 |
| FR-PROV-09 | F03 |
| FR-PROV-10 | F38 |
| FR-RAG-01 | F31 |
| FR-RAG-02 | F35 |
| FR-RAG-03 | F35 |
| FR-RAG-04 | F35 |
| FR-RAG-05 | F33 |
| FR-RAG-06 | F31 |
| FR-RAG-07 | F31 |
| FR-RAG-08 | F32 |
| FR-SKILL-01 | F21 |
| FR-SKILL-02 | F21 |
| FR-SKILL-03 | F21 |
| FR-SKILL-04 | F39 |
| FR-SKILL-05 | F22 |
| FR-SKILL-06 | F22 |
| FR-SKILL-07 | F22 |
| FR-SKILL-08 | F22 |
| FR-UI-01 | F04 |
| FR-UI-02 | F04 |
| FR-UI-03 | F04 |
| FR-UI-04 | F04 |
| FR-UI-05 | F13 |
| FR-UI-06 | F07, F13 |
| FR-UI-07 | F03 |
| FR-UI-08 | F13 |
| FR-UI-09 | F25 |
| FR-UI-10 | F03 |
| FR-UI-11 | F04 |
| FR-UI-12 | F06 |
| NFR-DATA-01 | F38 |
| NFR-DATA-02 | F29 |
| NFR-DATA-03 | F38 |
| NFR-DATA-04 | F51 |
| NFR-LOG-01 | F01 |
| NFR-LOG-02 | F01 |
| NFR-LOG-03 | F01 |
| NFR-LOG-04 | F01 |
| NFR-PERF-01 | F08 |
| NFR-PERF-02 | F27 |
| NFR-PERF-03 | F31 |
| NFR-PERF-04 | F27 |
| NFR-PERF-05 | F07 |
| NFR-PERF-06 | F51 |
| NFR-PERF-07 | F43 |
| NFR-PERF-08 | F46 |
| NFR-REL-01 | F02 |
| NFR-REL-02 | F18 |
| NFR-REL-03 | F29 |
| NFR-REL-04 | F18 |
| NFR-REL-05 | F56 |
| NFR-REL-06 | F45 |
| NFR-REL-07 | F24 |
| NFR-REL-08 | F23 |
| NFR-TEST-01 | F17, F28 |
| NFR-TEST-02 | F02 |
| NFR-TEST-03 | F57 |
| NFR-TEST-04 | F57 |
| NFR-TEST-05 | F51 |
| NFR-TEST-06 | F41 |
| NFR-TEST-07 | F23 |
| NFR-TEST-08 | F47 |
| NFR-USE-01 | F03 |
| NFR-USE-02 | F03 |
| NFR-USE-03 | F03 |
| NFR-USE-04 | F17 |
| NFR-USE-05 | F06 |
| NFR-USE-06 | F06 |
| NFR-USE-07 | F04 |
| NFR-USE-08 | F07 |
| NFR-USE-09 | F04 |
| NFR-USE-10 | F04 |
| NFR-USE-11 | F04 |

Result: **PASS** — every requirement ID in `context.md` is covered at least once.

## Check 2 — Coverage backward

All 57 feature rows were scanned; six rows carry `covers = —`:

| Feature | Justification in "Notes on coverage edges"? |
|---|---|
| F19 tools-write-vault | Yes (explicit note: FR-AGENT-04 / FR-AGENT-06 variants carried by F16; F19 delivers write implementations) |
| F36 canvas-file-indexing | Yes (bundled justification: "F36, F37, F40, F49, F50 … preserved as independent slices because they each deliver observable behavior tied to a distinct SRS phase deliverable") |
| F37 multi-thread-management | Yes (same bundled justification) |
| F40 user-defined-tools | Yes (same bundled justification) |
| F49 attachments-images-files | Yes (same bundled justification) |
| F50 perf-scale-10k-vault | Yes (same bundled justification) |

Every remaining row (51 of 57) has at least one FR/NFR ID in `covers`. The `—` rows are all enumerated and justified in `features-index.md` § *Notes on coverage edges* (lines 88–93).

Result: **PASS**.

## Check 3 — Dependency graph

Adjacency built from `deps` column of the features-index table. Each entry normalized to `F\d+` feature IDs.

- Nodes: 57 (F01–F57).
- Unknown refs (deps pointing to non-existent feature IDs): none.
- Cycle detection via DFS (gray/black coloring): no back edges discovered.
- The graph is a DAG.

Spot-check of heavy inbound nodes (high fan-in): F10 AgentController (in-degree 6), F51 MCP host (in-degree 5), F04 ChatView (in-degree 5), F03 SettingsTab (in-degree 4), F16 ToolRegistry (in-degree 4) — all stay strictly upstream of their dependants in the phase ordering.

Result: **PASS**.

## Check 4 — UI docs present

For every feature with `ui-needed == yes` (27 rows: F03, F04, F05, F06, F07, F09, F11, F12, F13, F15, F17, F20, F22, F24, F25, F30, F37, F38, F39, F45, F47, F48, F49, F52, F53, F54, F55), a non-empty `features/<slug>/ui.md` must exist.

- 26 of 27 ui.md files present and > 100 bytes.
- **F38 cloud-providers-safestorage** — `ui.md` **missing** (only `feature.md` present in directory). The `ui-needed` column of features-index.md (line 44) declares `yes`, but:
  - `features/cloud-providers-safestorage/ui.md` does not exist.
  - `outline.md` has no `- [F38 cloud-providers-safestorage UI]` entry (line 67 only references feature.md).
  - `state.md` shows no `ui-ux-engineer` row for F38.

Result: **FAIL — F38 ui.md missing**.

Remediation: either (a) commission the `ui-ux-engineer` subagent to produce `features/cloud-providers-safestorage/ui.md` with the standard wireframe / state-machine / event-flow / component-mapping sections (covers FR-PROV-10 / NFR-DATA-01 / NFR-DATA-03 UI surface — cloud provider settings section, API-key capture field, cost-in-$ line-item UI) and append `- [F38 cloud-providers-safestorage UI](./features/cloud-providers-safestorage/ui.md)` to outline.md Phase 3; or (b) flip `ui-needed` to `no` in features-index.md row 44 with a one-line justification in *Notes on coverage edges* explaining that the F38 UI surface is entirely delivered by F03 (settings-tab scaffold) and F12 (token usage indicator) with no F38-specific UI. Option (a) is strongly preferred — F38 introduces a net-new settings section + cost indicator whose visual states are not covered in F03/F12.

## Check 5 — Outline integrity

All markdown links in `outline.md` (79 total) resolve to existing files inside the workspace when normalized against the workspace root. Includes `context.md`, `features-index.md`, all feature.md entries, and all ui.md entries listed.

Result: **PASS**.

Note: Outline is internally consistent with itself, but see Check 4 — the outline is also missing the F38 UI entry (same underlying defect; remediation is shared).

## Check 6 — Section completeness

For each `feature.md`, the six required sections (`## Purpose`, `## Scope`, `## Acceptance criteria`, `## Dependencies`, `## Implementation notes`, `## Open questions`) were located by anchored H2 regex, and each section body (between the heading and the next `## ` or EOF) was measured for char count after stripping.

- 57 feature.md files scanned. All six sections are **present** in every file.
- Body content > 20 chars in all sections **except** `## Open questions` in twelve files where the body reads exactly `None.` (5 chars) or `- None.` (7 chars). These are legitimate semantic content (authors asserting no open questions) but fail the strict `>20 chars` rule.

Files with `## Open questions` body ≤ 20 chars:

| Feature | Body | Chars |
|---|---|---|
| F04 chat-sidebar-view | `None.` | 5 |
| F05 chat-message-list-markdown | `None.` | 5 |
| F06 chat-composer-input | `None.` | 5 |
| F07 chat-streaming-stop | `None.` | 5 |
| F08 editor-bridge-focused-context | `None.` | 5 |
| F09 chat-context-indicator | `None.` | 5 |
| F11 chat-message-queue | `None.` | 5 |
| F12 token-usage-indicator | `None.` | 5 |
| F13 ui-visual-states-notifications | `None.` | 5 |
| F18 edit-lock-transactions | `None.` | 5 |
| F19 tools-write-vault | `- None.` | 7 |
| F25 plan-approval-dialog | `None.` | 5 |

Result: **FAIL — 12 features have `## Open questions` bodies below the 20-char threshold**.

Remediation (per file): expand the `## Open questions` section to include an explicit assertion such as `- None — all behaviour is fully specified by srs.md §<section> + linked architecture/standards rows; no ambiguity remains after detailing iteration 1.` or, if any genuine follow-ups exist, list them. Minimum one sentence (≥ ~80 chars) citing what makes the scope closed. If the verifier is treating `None.` as acceptable semantically but not format-wise, relax to `- None. All acceptance criteria are sourced verbatim-by-link from referenced SRS / architecture rows; no decisions left open at this slice.` (one line, > 120 chars, deterministic to apply).

## Check 7 — No duplication in Implementation notes

Every `## Implementation notes` section was parsed bullet-by-bullet. Rule: each bullet must contain at least one markdown link, and no single bullet may exceed 60 words.

- 57 files scanned.
- All bullets contain at least one markdown link.
- No bullet exceeds 60 words (longest observed ≈ 55 words in F51; mean ≈ 18 words).

Paragraph-level scan (splitting Implementation notes on bullet boundaries rather than on blank lines) confirms no non-link paragraph, no restatement of Scope/Acceptance-criteria content — every chunk is link-plus-one-short-gloss.

Result: **PASS**.

## Check 8 — External link resolution

Every markdown link (`[label](path)` including optional `#anchor`) inside any `## Implementation notes` section was resolved relative to its feature directory, `#anchor` stripped, and the target file existence checked on disk. Additionally, every target was confirmed to live under `<project_root>/.agent/` (i.e. `/home/bs/PycharmProjects/leo/.agent/`).

- Total Implementation-notes links audited: **899** across 57 feature.md files.
- Unresolved links: **0**.
- Links resolving outside `.agent/`: **0**.
- All targets land in `.agent/architecture/`, `.agent/standards/`, or within the workspace itself (`.agent/features/leo_slice_20260419-190449/...`).

Result: **PASS**.

## Summary

| # | Check | Result |
|---|---|---|
| 1 | Coverage forward | PASS |
| 2 | Coverage backward | PASS |
| 3 | Dependency graph (DAG) | PASS |
| 4 | UI docs present for `ui-needed=yes` | FAIL — F38 ui.md missing |
| 5 | Outline integrity | PASS |
| 6 | Section completeness | FAIL — 12 features have `## Open questions` body ≤ 20 chars |
| 7 | No duplication (Implementation notes) | PASS |
| 8 | External link resolution | PASS |

## Verdict: FAIL

## Gaps

1. **Check 4 — F38 cloud-providers-safestorage UI doc missing.**
   Offending path: `/home/bs/PycharmProjects/leo/.agent/features/leo_slice_20260419-190449/features/cloud-providers-safestorage/ui.md` (does not exist).
   Remediation: dispatch `ui-ux-engineer` against F38 to produce `ui.md` with the standard wireframe / state-machine / event-flow / component-mapping sections, covering the cloud-provider settings section (API-key capture field, provider-select dropdown, cost-in-$ line-item, safeStorage unavailable fallback banner, obfuscated-fallback warning Notice). Then append `- [F38 cloud-providers-safestorage UI](./features/cloud-providers-safestorage/ui.md)` to Phase 3 of `outline.md`. Alternative (strongly discouraged): flip `ui-needed` to `no` in row 44 of `features-index.md` and add a justification line under *Notes on coverage edges* explaining why no F38-specific UI is needed — but F38 introduces net-new settings controls not covered by F03/F12, so skipping UI is a documentation gap.

2. **Check 6 — 12 feature.md files have `## Open questions` body below 20 chars.**
   Offending files (paths relative to `/home/bs/PycharmProjects/leo/.agent/features/leo_slice_20260419-190449/features/`):
   - `chat-sidebar-view/feature.md`
   - `chat-message-list-markdown/feature.md`
   - `chat-composer-input/feature.md`
   - `chat-streaming-stop/feature.md`
   - `editor-bridge-focused-context/feature.md`
   - `chat-context-indicator/feature.md`
   - `chat-message-queue/feature.md`
   - `token-usage-indicator/feature.md`
   - `ui-visual-states-notifications/feature.md`
   - `edit-lock-transactions/feature.md`
   - `tools-write-vault/feature.md`
   - `plan-approval-dialog/feature.md`
   Remediation: in each of the twelve files, replace the `## Open questions` body (currently `None.` or `- None.`) with a single-line assertion that is ≥ 20 characters and states the closure condition, e.g.:
   ```
   - None. Acceptance criteria and implementation notes exhaust the feature scope; no decisions are deferred at this slice.
   ```
   This is deterministic and can be applied by the remediator as a single sed-equivalent edit per file. If a real open question does exist for any file, document it explicitly with the FR/NFR ID it would impact and link the deciding SRS/architecture row.
