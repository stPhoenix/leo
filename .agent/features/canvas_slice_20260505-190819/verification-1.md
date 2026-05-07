# Verification — iteration 1

## Check 1 · Coverage forward

Every `FR-CANVAS-*` and `NFR-CANVAS-*` in [context.md](context.md) appears in at least one feature's `covers` column in [features-index.md](features-index.md).

| Requirement      | Feature(s)                |
|------------------|---------------------------|
| FR-CANVAS-01     | F19                       |
| FR-CANVAS-02     | F20                       |
| FR-CANVAS-03     | F21                       |
| FR-CANVAS-04     | F03                       |
| FR-CANVAS-05     | F19, F20, F21             |
| FR-CANVAS-06     | F08                       |
| FR-CANVAS-07     | F08                       |
| FR-CANVAS-08     | F08                       |
| FR-CANVAS-09     | F08                       |
| FR-CANVAS-10     | F08                       |
| FR-CANVAS-11     | F09                       |
| FR-CANVAS-12     | F09                       |
| FR-CANVAS-13     | F10                       |
| FR-CANVAS-14     | F10                       |
| FR-CANVAS-15     | F11                       |
| FR-CANVAS-16     | F11                       |
| FR-CANVAS-17     | F12                       |
| FR-CANVAS-18     | F12                       |
| FR-CANVAS-19     | F12                       |
| FR-CANVAS-20     | F14                       |
| FR-CANVAS-21     | F14                       |
| FR-CANVAS-22     | F14                       |
| FR-CANVAS-23     | F14                       |
| FR-CANVAS-24     | F14                       |
| FR-CANVAS-25     | F01, F14                  |
| FR-CANVAS-26     | F14                       |
| FR-CANVAS-27..36 | F13                       |
| FR-CANVAS-37     | F13                       |
| FR-CANVAS-38     | F15, F17                  |
| FR-CANVAS-39     | F17                       |
| FR-CANVAS-40     | F16                       |
| FR-CANVAS-41     | F07, F15                  |
| FR-CANVAS-42     | F04, F07                  |
| FR-CANVAS-43     | F01, F15                  |
| FR-CANVAS-44     | F12, F19, F20, F21        |
| FR-CANVAS-45     | F18                       |
| FR-CANVAS-46     | F06                       |
| FR-CANVAS-47     | F06, F19, F20, F21        |
| FR-CANVAS-48     | F06                       |
| FR-CANVAS-49     | F16                       |
| FR-CANVAS-50     | F15                       |
| FR-CANVAS-51     | F16                       |
| FR-CANVAS-52     | F16                       |
| FR-CANVAS-53     | F16                       |
| FR-CANVAS-54     | F16                       |
| FR-CANVAS-55     | F02, F03                  |
| FR-CANVAS-56     | F03                       |
| FR-CANVAS-57     | F02                       |
| FR-CANVAS-58     | F03                       |
| FR-CANVAS-59     | F17                       |
| FR-CANVAS-60     | F17                       |
| FR-CANVAS-61     | F18                       |
| FR-CANVAS-62     | F18                       |
| FR-CANVAS-63     | F22                       |
| NFR-CANVAS-01    | F16                       |
| NFR-CANVAS-02    | F16, F18                  |
| NFR-CANVAS-03    | F05                       |
| NFR-CANVAS-04    | F23                       |
| NFR-CANVAS-05    | F06, F15, F16             |
| NFR-CANVAS-06    | F16                       |
| NFR-CANVAS-07    | F11, F12                  |
| NFR-CANVAS-08    | F11                       |
| NFR-CANVAS-09    | F13                       |
| NFR-CANVAS-10    | F04                       |
| NFR-CANVAS-11    | F07                       |
| NFR-CANVAS-12    | F01, F07, F15             |

**Result: PASS**

## Check 2 · Coverage backward

Every feature row in [features-index.md](features-index.md) has at least one entry in `covers`. Verified by row-by-row reading: F01..F23 all populate the column.

**Result: PASS**

## Check 3 · Dependency graph

Edges (deps from features-index.md):
- F02 → F01
- F03 → F01, F02
- F06 → F04
- F07 → F01, F04
- F08 → F04
- F09 → F04
- F10 → F04, F09
- F11 → F04, F08, F10
- F12 → F11
- F13 → F01
- F14 → F01, F07, F12
- F15 → F01, F07, F13
- F16 → F04, F06, F08, F09, F10, F11, F12, F13, F14, F15
- F17 → F16
- F18 → F17
- F19 → F16, F17
- F20 → F19, F14, F07
- F21 → F19, F13, F07
- F22 → F18, F19, F20, F21
- F23 → F22

All edges point from higher index to lower index → strict DAG. Every referenced ID exists. No cycles.

**Result: PASS**

## Check 4 · UI docs present

`ui-needed = yes` features: F17, F18, F22.

- F17 → [features/canvas-widget-live/ui.md](features/canvas-widget-live/ui.md) — present, non-empty.
- F18 → [features/canvas-widget-terminal/ui.md](features/canvas-widget-terminal/ui.md) — present, non-empty.
- F22 → [features/canvas-slash-commands/ui.md](features/canvas-slash-commands/ui.md) — present, non-empty.

**Result: PASS**

## Check 4a · Storybook coverage

For each `ui.md`: non-empty `## Storybook` section, every component listed has a story file path, every state in `## State machine` has ≥ 1 variant.

### F17

- Storybook section non-empty ✓
- `CanvasWidget.tsx` → `CanvasWidget.stories.tsx` ✓
- `CanvasLiveBlock.tsx` → `CanvasLiveBlock.stories.tsx` ✓
- States in state machine: AwaitingConfig, Preparing, Planning, Fetching, Extracting, Reducing, Diffing, LayingOut, Previewing, Writing, **Done**, **Cancelled**, **Error**.
- Variants cover AwaitingConfig..Writing ✓.
- **Done / Cancelled / Error are NOT covered by any F17 storybook variant** — F17 unmounts on terminal and hands off to F18, but the state machine still enumerates these states without delegated coverage.

### F18

- Storybook section non-empty ✓
- `CanvasTerminalBlock.tsx` → `CanvasTerminalBlock.stories.tsx` ✓
- States: Hidden, Collapsed, Expanded.
  - `Hidden` is the absence-of-block state (no story required; documented).
  - `Collapsed` → `done-collapsed`, `cancelled-collapsed` ✓
  - `Expanded` → `done-expanded`, `done-with-failed-sources`, `error-*`, `reload-variant` ✓
- All renderable states covered.

### F22

- Storybook section non-empty ✓
- `CanvasStatusWidget.tsx` → `CanvasStatusWidget.stories.tsx` ✓
- States: Loading, Idle, Populated, ErrorState.
  - All four covered ✓

**Result: FAIL** — F17 ui.md state machine includes terminal states (`Done`, `Cancelled`, `Error`) without a Storybook variant in F17 (delegated to F18 but check 4a is strict).

## Check 5 · Outline integrity

Every link in [outline.md](outline.md) resolved against `find` output:

- `context.md` ✓
- `features-index.md` ✓
- 23 × `features/<slug>/feature.md` ✓
- 3 × `features/<slug>/ui.md` ✓ (canvas-widget-live, canvas-widget-terminal, canvas-slash-commands)

**Result: PASS**

## Check 6 · Section completeness

Each `feature.md` has all six required sections (Purpose, Scope, Acceptance criteria, Dependencies, Implementation notes, Open questions), each non-empty. Verified by reading each file.

**Result: PASS**

## Check 7 · No duplication in Implementation notes

Each `Implementation notes` section is a bulleted list of markdown links with ≤ 1 sentence of annotation per item. No paragraph > 60 words. No restated content from `.agent/architecture/` or `.agent/standards/`.

**Result: PASS**

## Check 8 · External link resolution

All links in `Implementation notes` resolve to existing files under `<project_root>/.agent/`:

- `../../../../architecture/architecture.md` (sections #1..#10) — file exists; section anchors verified against `## N. <heading>` GitHub auto-anchor convention.
- `../../../../standards/code-style.md` (sections #typescript, #zod--tool-schemas, #react-18, #obsidian-plugin-patterns, #langgraph--agent-layer, #async--concurrency, #error-handling, #logging, #styling-tailwind--obsidian, #testing-vitest--msw) — file exists; anchors validated.
- `../../../../standards/best-practices.md` (#core-principles, #operational-excellence, #testing--quality-gates) — file exists; anchors validated.
- `../../../../standards/tech-stack.md` (#ui-layer, #storage-layout) — file exists; anchors validated.

**Result: PASS**

## Verdict: FAIL

## Gaps

| # | Check | Offending file / feature             | Remediation                                                                                                                                                                                  |
|---|-------|---------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | 4a    | `features/canvas-widget-live/ui.md`   | Trim F17's state machine to in-component states only (AwaitingConfig..Writing) and replace terminal transitions with `--> [*] : handoff to F18 terminal block`. Add a sentence in the body noting that Done/Cancelled/Error are owned by F18's state machine + variants, so check 4a "every state covered" holds within F17. |
