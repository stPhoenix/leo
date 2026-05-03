# F19 — UI

## Layout

Confirmation prompt:

```
┌─ inline confirmation ─────────────────────────────────────┐
│ Run wiki lint? scope: all                                 │
│                                                           │
│ [Run wiki lint]   [Deny]                                  │
└───────────────────────────────────────────────────────────┘
```

CONFIRMING phase inside live block:

```
┌─ wiki live block · CONFIRMING ───────────────────────────┐
│ Wiki lint · runId 20260428-110201-ef45gh · 12 findings   │
│                                                          │
│ [Accept all]  [Reject all]  [Apply selected]   [Cancel]  │
│                                                          │
│ ☑ #1 contradiction · pages/foo.md          (warn)        │
│   "claim X conflicts with claim Y"                       │
│   [view patch]                                           │
│                                                          │
│ ☐ #2 missing-xref · pages/bar.md           (info)        │
│   "page mentions [[pages/baz]] but never links"          │
│   [view patch]                                           │
│                                                          │
│ ☐ #3 schema-drift · SCHEMA.md              (warn)        │
│   "proposed: add `aliases` field convention"             │
│   [Confirm schema patch]                                 │
│                                                          │
│ … 9 more                                                 │
└──────────────────────────────────────────────────────────┘
```

Per-schema-patch confirmation overlay:

```
┌─ inline confirmation overlay ────────────────────────────┐
│ Apply schema patch?                                      │
│ diff:                                                    │
│   + aliases: string[]                                    │
│ rationale:                                               │
│   "five pages already use aliases inline; codify"        │
│ [Apply schema patch]   [Cancel]                          │
└──────────────────────────────────────────────────────────┘
```

Slash picker:

```
┌─ slash picker ─────────────────────────┐
│ /wiki-ingest   Wiki ingest             │
│ /wiki-lint     Wiki lint        ← here │
│ /wiki-status   Wiki status             │
└────────────────────────────────────────┘
```

## State machine

```
idle
  → confirm-pending
        → deny → idle
        → run
              → busy → idle (mutex held; user-visible message)
              → mounted-widget
                    → scanning → checking → proposing
                    → awaiting_confirm
                          (per-finding toggle ↻ awaiting_confirm)
                          (Accept all → all-toggled → awaiting_confirm)
                          (Reject all → none-toggled → awaiting_confirm)
                          (schema-patch confirm overlay
                              → confirmed | dismissed → awaiting_confirm)
                          → Apply selected → writing
                    → writing
                          (cancel-mid-write completes current file)
                          → done | cancelled | error
                    → done | cancelled | error → terminal-summary → idle
```

Cancel is allowed at every active phase; ≤ 2 s wall-clock per FR-42 / FR-43.

## Event flow

1. Main agent calls `delegate_wiki_lint(scope)` → `InlineConfirmation` rendered with **Run wiki lint** / **Deny**.
2. **Deny** → `{ok:false, denied:true}` → main agent continues.
3. **Run wiki lint** → mutex acquire → busy short-circuit returns busy result; happy path mounts F06 live block.
4. SCANNING/CHECKING/PROPOSING transitions feed view-model — block re-renders progress.
5. CONFIRMING phase: controller exposes `findings: LintFinding[]`, `selected: Set<id>`, action handlers `toggleFinding(id)`, `acceptAll()`, `rejectAll()`, `applySelected()`, `confirmSchemaPatch(id)`.
6. Schema-drift findings: clicking **Confirm schema patch** opens an `InlineConfirmation` overlay; only confirmed schema patches are applied in WRITING.
7. **Apply selected** → controller calls `confirmFindings(acceptedPatchIds, schemaPatchConfirmed)` → CONFIRMING `interrupt()` resolves → WRITING runs.
8. WRITING reuses F10 writer; `SCHEMA.md` patch handled by a dedicated path; one `log.md` entry recording accepted/rejected counts.
9. Terminal DONE → tool resumes with documented payload → live block replaced by terminal block.
10. `/wiki-lint` slash entry → composer fires the tool with default args.

## Component mapping

| Block | Component | Source |
|---|---|---|
| Confirmation prompt | `InlineConfirmation` (existing) | `src/ui/chat/InlineConfirmation.tsx` per [project-structure.md](../../../../standards/project-structure.md) |
| Live block (CONFIRMING variant) | `WikiLiveBlock` (F06) + new child `LintConfirmList.tsx` co-located under `src/agent/wiki/widget/` | per [project-structure.md](../../../../standards/project-structure.md) |
| Schema-patch confirm overlay | `InlineConfirmation` reused | per [project-structure.md](../../../../standards/project-structure.md) |
| Terminal block | F06 `WikiTerminalBlock` | per [project-structure.md](../../../../standards/project-structure.md) |
| Slash entry | `SlashPicker` | per [project-structure.md](../../../../standards/project-structure.md) |

UI primitives per [tech-stack.md `UI Layer`](../../../../standards/tech-stack.md). React 18 + `useSyncExternalStore` per [code-style.md `React 18`](../../../../standards/code-style.md). Tailwind utilities scoped under `.leo-root` per [code-style.md `Styling (Tailwind + Obsidian)`](../../../../standards/code-style.md).

## Storybook

| component | story file | variants | mocks |
|---|---|---|---|
| `LintConfirmList` | `src/agent/wiki/widget/LintConfirmList.stories.tsx` | empty, single-finding, multi-finding-mixed-severity, with-research-gap (`severity:'info'` + `suggestedQueries`), with-schema-drift, after-accept-all, after-reject-all, mid-apply | new `lintFindingsMocks.ts` under `src/ui/chat/__stories__/mocks/` |
| `WikiLiveBlock` lint variants (extend F06) | `src/agent/wiki/widget/WikiLiveBlock.stories.tsx` | scanning, checking, proposing, awaiting_confirm, writing, cancelled, error | reuse F06 mocks |
| `InlineConfirmation` (extend) | `src/ui/chat/InlineConfirmation.stories.tsx` | wiki-lint-pending (scope=all), wiki-lint-pending (scope=pages), wiki-lint-pending (scope=orphans), schema-patch-confirm | existing confirmation fixtures + `lintFindingsMocks.ts` |
| `SlashPicker` (extend) | `src/ui/chat/SlashPicker.stories.tsx` | `/wiki-lint` entry visible, entry selected | existing slash-commands fixtures |
| `WikiTerminalBlock` lint variants (extend F06) | `src/agent/wiki/widget/WikiTerminalBlock.stories.tsx` | lint-done-collapsed, lint-done-expanded, lint-error-collapsed, lint-cancelled-collapsed, schema-edited-true, schema-edited-false | reuse F06 mocks |

Every state in `## State machine` is covered by at least one variant: confirm-pending (3 scopes), after-deny (existing F12-shared), busy (F12-shared), scanning, checking, proposing, awaiting_confirm (empty / single / multi / with-schema-drift / after-accept-all / after-reject-all / mid-apply), schema-patch-confirm overlay, writing, done, cancelled, error.

## Back-link

[./feature.md](./feature.md)
