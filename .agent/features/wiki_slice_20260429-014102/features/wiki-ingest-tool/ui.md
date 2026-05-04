# F12 — UI

## Layout

Confirmation prompt (idle):

```
┌─ inline confirmation ─────────────────────────────────────┐
│ Prepare wiki ingest from URL                              │
│ https://example.com/article?                              │
│                                                           │
│ [Prepare wiki ingest]   [Deny]                            │
└───────────────────────────────────────────────────────────┘
```

After Prepare → mounted F06 live block (see F06 layout).

Busy result (mutex held):

```
┌─ chat assistant text ─────────────────────────────────────┐
│ Wiki is busy with run 20260428-101433-ab12cd (ingest) —   │
│ try again when it finishes.                               │
└───────────────────────────────────────────────────────────┘
```

Slash picker:

```
┌─ slash picker ─────────────────────────┐
│ /wiki-ingest   Wiki ingest      ← here │
│ /wiki-lint     Wiki lint               │
│ /wiki-status   Wiki status             │
└────────────────────────────────────────┘
```

## State machine

```
idle
  → confirm-pending
        → deny → idle
        → prepare
              → busy → idle (mutex held; user-visible message)
              → mounted-widget (F06) → terminal-summary → idle
```

## Event flow

1. Main agent calls `delegate_wiki_ingest(input)` → `confirmationController.present({prompt, actions: [Prepare, Deny]})` → `InlineConfirmation` rendered.
2. **Deny** → tool returns `{ok:false, denied:true}` → confirmation dismissed → main agent continues.
3. **Prepare** → orchestrator attempts `WikiMutex.acquire('ingest', runId)`.
   - **busy** → tool returns `{ok:false, error:'busy', activeRunId, activeOp}` → main agent surfaces a user-visible message via plain assistant text → no live block mounted.
   - **acquired** → live block mounted (F06) → tool suspends until subgraph terminal.
4. On subgraph terminal → tool resumes with the documented payload → live block replaced by terminal block (F06).
5. `/wiki-ingest` slash entry → composer fires the tool with default args.

## Component mapping

| Block | Component | Source |
|---|---|---|
| Confirmation | `InlineConfirmation` (existing) | `src/ui/chat/InlineConfirmation.tsx` per [project-structure.md](../../../../standards/project-structure.md) |
| Live + terminal blocks | F06 components | per [project-structure.md](../../../../standards/project-structure.md) |
| Slash entry | `SlashPicker` (existing) | per [project-structure.md](../../../../standards/project-structure.md) |
| Busy text | `AssistantBlocks` text block (existing) | per [project-structure.md](../../../../standards/project-structure.md) |
| Tool wiring | `confirmationController` + ToolRegistry | per [project-structure.md](../../../../standards/project-structure.md) |

UI primitives per [tech-stack.md `UI Layer`](../../../../standards/tech-stack.md). React 18 + `useSyncExternalStore` per [code-style.md `React 18`](../../../../standards/code-style.md).

## Storybook

| component | story file | variants | mocks |
|---|---|---|---|
| `InlineConfirmation` (extend) | `src/ui/chat/InlineConfirmation.stories.tsx` | wiki-ingest-pending (URL), wiki-ingest-pending-with-note, wiki-ingest-pending (vaultPath), wiki-ingest-pending (attachment), after-prepare, after-deny | reuse existing confirmation fixtures |
| `SlashPicker` (extend) | `src/ui/chat/SlashPicker.stories.tsx` | `/wiki-ingest` entry visible, entry selected | existing slash-commands fixtures |
| `AssistantBlocks` (extend) | `src/ui/chat/blocks/AssistantBlocks.stories.tsx` | busy-result rendering | new `wikiBusyResultMocks.ts` under `src/ui/chat/__stories__/mocks/` |

Every interactive state in `## State machine` is covered by at least one variant: confirm-pending (variants a-d), after-prepare, after-deny, busy-result, terminal-summary (handled by F06's stories).

## Back-link

[./feature.md](./feature.md)
