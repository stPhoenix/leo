# F04 — UI: tool-use block renderer

## Layout

Single tool-use block layout (collapsed result):

```
┌── leo-tool-use ──────────────────────────────────────────────┐
│ ● Bash(cmd: "ls -la /tmp")                                   │  ← header
│ │  └─ permission prompt slot         (only when pending)     │
│ │  └─ progress lines slot            (running only)          │
│ └─ result panel slot                 (resolved+)             │
└──────────────────────────────────────────────────────────────┘
```

Multi-line custom args renderer (e.g. file edit teaser):

```
● editNote(path: "notes/foo.md", lines: 12–18)
   ╭─ args (custom) ───────────────╮
   │ + new content line 1          │
   │ + new content line 2          │
   ╰───────────────────────────────╯
   └─ result panel slot
```

## State machine

Per tool-use block:

```
queued ──markRunning──▶ running ──markResolved(ok)──▶ success
   │                       │
   │                       ├──markResolved(err)─────▶ errored
   │                       └──markCanceled──────────▶ canceled
   │
   ├──user denies (F06)──────────────────────────────▶ rejected
   └──disposeThread───────────────────────────────────▶ (unmount)
```

The view is fully derived from `(block, runState)` via `statusOf` — no internal state besides blink interval handle.

## Event flow

```
1. New block_stop arrives for tool_use index i (F02).
2. ChatMessageStore commits parsed input.
3. AgentRunner enqueues tool dispatch → calls runStateStore.markRunning(id).
4. ToolUseBlockView (subscribed via subscribeToolUse(id)) re-renders.
5. useBlink(active=running) toggles glyph every 500ms.
6. Tool emits progress events → F08 renderer mounts under the header.
7. Tool resolves → markResolved(id, isError) → glyph color flips, blink stops.
8. F05 renderer mounts the result panel.
```

User-cancellation flow (Esc from F11 live indicator):

```
1. F11 calls streamingController.stop()
2. stop() iterates runStateStore.inProgressToolUseIds and markCanceled each
3. Every ToolUseBlockView re-renders to canceled state (gray strikethrough)
```

## Component mapping

| UI region | Component | Source |
|---|---|---|
| Block container | `ToolUseBlockView` | this feature |
| Status glyph | `StatusGlyph` (internal) using `useBlink` | this feature |
| Args one-liner | `ArgsLine` (internal) | this feature |
| Args custom (per tool) | `ToolDef.renderToolUse(ctx)` | extends [`src/tools/toolRegistry.ts`](../../../../../src/tools/toolRegistry.ts) |
| Permission prompt slot | `<PermissionPromptSlot toolUseId>` | F06 fills |
| Progress lines slot | `<ProgressLinesSlot toolUseId>` | F08 fills |
| Result panel slot | `<ResultPanelSlot toolUseId>` | F05 fills |
| Color tokens | Obsidian CSS vars per [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer) | — |

### Storybook

`src/ui/chat/blocks/ToolUseBlockView.stories.tsx`. Stories:

- `Queued` — glyph dim, no blink.
- `RunningBash` — blink active, args one-liner.
- `RunningEditNote` — custom renderer teaser.
- `Success` — green glyph, no progress slot.
- `Errored` — red glyph, error tooltip.
- `Rejected` — yellow glyph, "Rejected by user" hint.
- `Canceled` — gray strikethrough.
- `ParseFailureArgs` — `…` placeholder, raw JSON in popover.

Mocks pulled from `src/ui/chat/__stories__/mocks/sources.ts` extension done in F14.

## Back-link

[feature.md](./feature.md)
