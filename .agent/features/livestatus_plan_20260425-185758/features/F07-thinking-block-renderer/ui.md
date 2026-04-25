# F07 — UI: thinking block renderer

## Layout

Streaming (expanded):

```
┌── thinking ───────────────────────────────────────────┐  ← italic dim border
│ Thinking                                              │
│                                                       │
│ I should read the file first, then look at the diff…  │
│ The user wants me to handle the edge case where…   ▍  │  ← live cursor (text)
└───────────────────────────────────────────────────────┘
```

Finalised (collapsed):

```
┌── thinking · 612 chars ─────────────────────── [ ▸ ] ─┐
└───────────────────────────────────────────────────────┘
```

Redacted:

```
┌── thinking · redacted · 1.2 KB ────────────── locked ─┐
└───────────────────────────────────────────────────────┘
```

## State machine

```
init ── parent.streaming && lastBlock===this ──▶ expanded-streaming
expanded-streaming ──block_stop──▶ collapsed
collapsed ──user toggle──▶ expanded-user
expanded-user ──user toggle──▶ collapsed

redacted ──(no toggles)──▶ locked-summary
```

## Event flow

```
1. content_block_start{type:'thinking'} → message.content[i] = {type:'thinking', thinking:''}
2. thinking_delta deltas append to .thinking
3. ThinkingBlockView (mounted for block i) checks parent.status & lastBlockIndex
4. While both true → expanded
5. block_stop → block stops growing; ThinkingBlockView re-renders to collapsed
```

## Component mapping

| UI region | Component | Source |
|---|---|---|
| Block container | `ThinkingBlockView` | this feature |
| Toggle | `<CollapseToggle aria-expanded>` | this feature |
| Label header | `<ThinkingHeader length>` | this feature |
| Redacted summary | `<RedactedSummary bytes>` | this feature |
| Color tokens | Obsidian CSS vars per [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer) | — |

### Storybook

`src/ui/chat/blocks/ThinkingBlockView.stories.tsx`. Stories:

- `ExpandedStreaming` — short thinking text, parent streaming.
- `CollapsedFinalised` — long thinking text, parent done.
- `ExpandedUser` — collapsed-by-default, toggled open.
- `Redacted` — bytes-only summary.

## Back-link

[feature.md](./feature.md)
