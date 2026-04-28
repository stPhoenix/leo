# F10 — UI: grouped read-only tool-uses

## Layout

Collapsed:

```
○ Read 4 files: README.md, foo.md, bar.md, +1     ▸
```

Expanded:

```
○ Read 4 files: README.md, foo.md, bar.md, +1     ▾
   ● Read(README.md)
     └─ result · 1.2 KB         ▸ show more
   ● Read(foo.md)
     └─ result · 380 B          ▸ show more
   ● Read(bar.md)
     └─ result · 940 B          ▸ show more
   ● Read(notes/baz.md)
     └─ result · 220 B          ▸ show more
```

Mixed (running breaks group):

```
● Read(README.md)                ← runs separately
   └─ ← still streaming, no group
● Read(foo.md)
   └─ result · 380 B
```

## State machine

```
detectGroups output ──▶ Single  → render <ToolUseBlockView block />
                    ──▶ Group   → render <GroupedToolUses members />

Group.collapsed ──user click──▶ Group.expanded
Group.expanded  ──user click──▶ Group.collapsed
```

## Event flow

```
1. AssistantBlocks (F01) iterates content[].
2. Calls detectGroups(blocks, runState) → list of segments.
3. For each segment: render Single or Group.
4. If any block status changes, runState version bumps → detectGroups re-runs.
5. While one member runs, grouping suspended → individual blocks again.
6. Once every member is success → collapsed group surfaces.
```

## Component mapping

| UI region | Component | Source |
|---|---|---|
| Group container | `GroupedToolUses` | this feature |
| Summary button | `<GroupSummary toolName count paths>` | this feature |
| Expanded list | `<ul>` of `<ToolUseBlockView>` | F04 |
| Detector | `detectGroups(blocks, runState)` (pure) | this feature |
| Color tokens | Obsidian CSS vars per [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer) | — |

### Storybook

`src/ui/chat/blocks/GroupedToolUses.stories.tsx`. Stories:

- `GroupedFourReads` — collapsed.
- `GroupedFourReadsExpanded`.
- `MixedSearchVault`.
- `RunningMemberPreventsGroup`.
- `ErrorMemberSplits`.
- `MultiNameNoGroup` — adjacent reads with different names → no group.

Mocks: `mockMixedReadBlocks` from F14 with controllable status overrides.

## Back-link

[feature.md](./feature.md)
