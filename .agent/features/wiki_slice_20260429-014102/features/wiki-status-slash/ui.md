# F03 — UI

## Layout

```
┌─ slash picker ─────────────────────────┐
│ /wiki-ingest   Wiki ingest             │
│ /wiki-lint     Wiki lint               │
│ /wiki-status   Wiki status      ← here │
└────────────────────────────────────────┘

After invoke, chat assistant block:

┌─ assistant message ────────────────────┐
│ Wiki status                            │
│ - index: 12 pages (3.4 KB)             │
│ - last lint: 2026-04-27T10:14:33Z (2d) │
│ - orphans: 2 pages, 1 raw              │
│ - mutex: idle                          │
└────────────────────────────────────────┘
```

## State machine

```
idle → invoked → result-rendered
```

No interactive states. No retries. No live updates.

## Event flow

1. User types `/wiki-status` → `SlashPicker` matches → user picks → composer fires the tool with default args.
2. Tool reads `wiki/index.md` size, the most recent lint entry from `wiki/log.md`, computes orphan counts via the F16 scan helper, reads `WikiMutex.active()`.
3. Tool returns a markdown body; chat renders it via the existing `AssistantBlocks` text path.

## Component mapping

| Block | Component |
|---|---|
| Slash picker entry | `SlashPicker` (existing, `src/ui/chat/SlashPicker.tsx` per [project-structure.md](../../../../standards/project-structure.md)) |
| Result rendering | `AssistantBlocks` text block (existing) |

UI primitives per [tech-stack.md `UI Layer`](../../../../standards/tech-stack.md).

## Storybook

| component | story file | variants | mocks |
|---|---|---|---|
| `SlashPicker` (extend) | `src/ui/chat/SlashPicker.stories.tsx` | (a) `/wiki-status` entry visible, (b) entry selected, (c) result rendered as plain markdown | reuse existing slash-commands fixtures |

Existing Obsidian theme decorator from `.storybook/preview.ts`; no new globals.

## Back-link

[./feature.md](./feature.md)
