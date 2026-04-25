# F05 — UI: tool-result panel

## Layout

Success (collapsed):

```
● Read(README.md)                                ← from F04
└─ result · 1.2 KB · text                ▸ show more
```

Success (expanded):

```
● Read(README.md)
└─ result · 1.2 KB · text                ▾ show less
   ┌──────────────────────────────────────────┐
   │ # Leo                                    │
   │ Companion for Obsidian.                  │
   │ …                                        │
   └──────────────────────────────────────────┘
```

Errored:

```
● Bash(cmd: "missing-cmd")                       ← red glyph from F04
└─ ⚠ Tool error
   ┌──────────────────────────────────────────┐ red border
   │ /bin/sh: missing-cmd: not found          │
   └──────────────────────────────────────────┘
```

Rejected:

```
● editNote(path: "x.md")                          ← yellow glyph from F04
└─ Rejected by user · "user denied editNote"
```

Canceled:

```
● Bash(cmd: "sleep 600")                          ← gray strike-through glyph
└~~ Canceled · ⎋
```

## State machine

```
mounted ──statusOf=success──▶ collapsed   (toggle ▸/▾) ──▶ expanded
mounted ──statusOf=errored──▶ expanded-fixed
mounted ──statusOf=rejected──▶ inline-message
mounted ──statusOf=canceled──▶ inline-strike
```

User toggle is local component state; never persisted.

## Event flow

```
1. tool_result block arrives via F02 → committed to message.content[i+1] (or later).
2. ToolResultBlockView mounts via the result-panel slot of the matching ToolUseBlockView.
3. Subscribes to runStateStore.subscribeToolUse(tool_use_id) — needed because canceled is run-state-driven, not a tool_result block.
4. statusOf maps to layout; layout chooses collapsed/expanded default.
5. Tool-specific renderer (F12 diff) hijacks the body if registered.
```

## Component mapping

| UI region | Component | Source |
|---|---|---|
| Panel container | `ToolResultBlockView` | this feature |
| Default body | `MonospaceContent` (internal) | this feature |
| Collapse toggle | `<ShowMoreToggle>` | this feature |
| File-edit body | `DiffView` (custom via `toolDef.renderResult`) | F12 |
| Color tokens | Obsidian CSS vars per [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer) | — |

### Storybook

`src/ui/chat/blocks/ToolResultBlockView.stories.tsx`. Stories:

- `SuccessShort` — < 200 chars, expanded by default.
- `SuccessLongCollapsed` — 5 KB, collapsed.
- `SuccessLongExpanded` — same content, opened.
- `Errored` — red panel.
- `Rejected` — gray inline message.
- `Canceled` — strike-through.
- `OrphanResult` — no matching tool-use, system warning visible.

Mocks reuse `runStateStore` fixture from F14.

## Back-link

[feature.md](./feature.md)
