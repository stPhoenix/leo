# F12 — UI: diff result renderer

## Layout

Small diff (expanded):

```
● editNote(path: "notes/foo.md")
└─ result · 12 +, 4 −                             ▾ collapse
   ┌───────────────────────────────────────────────┐
   │  10 │  10 │   const x = 1;                    │
   │  11 │  -- │ - const y = 2;                    │
   │     │  11 │ + const y = 3;                    │
   │  12 │  12 │   const z = 4;                    │
   └───────────────────────────────────────────────┘
```

Large diff (collapsed):

```
● editNote(path: "notes/big.md")
└─ result · 124 +, 87 −                           ▸ Show diff
```

Identical (no change):

```
● editNote(path: "notes/foo.md")
└─ result · no changes
```

Create:

```
● createNote(path: "notes/new.md")
└─ result · 26 +                                  ▾
   ┌───────────────────────────────────────────────┐
   │     │   1 │ + # New note                      │
   │     │   2 │ +                                 │
   │     │   3 │ + body…                           │
   └───────────────────────────────────────────────┘
```

## State machine

```
mounted ──changed lines < 30──▶ expanded
mounted ──changed lines ≥ 30──▶ collapsed
collapsed ──user toggle──▶ expanded
expanded ──user toggle──▶ collapsed
identical ──(no toggle)──▶ "no changes"
```

## Event flow

```
1. Tool result block arrives with { before, after }.
2. F05 ToolResultBlockView checks toolDef.renderResult → routes to DiffView.
3. DiffView calls computeUnifiedDiff(before, after) once via useMemo.
4. Renders gutter + body; toggle local state collapses/expands.
```

## Component mapping

| UI region | Component | Source |
|---|---|---|
| Diff body | `DiffView` | this feature |
| Diff line | `<DiffLineRow side gutter content>` | this feature |
| Gutter pill | `<GutterPill kind="add"|"del"|"ctx">` | this feature |
| Toggle | reuses `ShowMoreToggle` from F05 | F05 |
| Diff math | `computeUnifiedDiff(before, after)` (pure) | this feature |
| Color tokens | Obsidian CSS vars (`var(--color-green)` add, `var(--color-red)` del) per [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer) | — |

### Storybook

`src/ui/chat/blocks/DiffView.stories.tsx`. Stories:

- `EditSmall` — 4 ± lines.
- `EditLargeCollapsed` — 200 ± lines.
- `EditLargeExpanded` — same, opened.
- `Create` — pure additions.
- `Append` — last-N additions only.
- `Identical` — no-change message.

Mocks: `mockEditResultBefore`/`mockEditResultAfter` strings from F14.

## Back-link

[feature.md](./feature.md)
