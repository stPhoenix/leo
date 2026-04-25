# F08 — UI: progress lines

## Layout

Bash example:

```
● Bash(cmd: "pnpm test")          ← header from F04 (running/blink)
   └─ Running 247 tests…
   └─ ✓ chat/messageStore.test.ts (12)
   └─ ✓ rag/scorer.test.ts (8)
   └─ …+22 more
```

Web search:

```
● WebSearch(query: "obsidian plugin api")
   └─ obsidian plugin api · 8 results
```

MCP:

```
● mcp.git.commit(message: "wip")
   └─ mcp.git · tools/call
   └─ mcp.git · staging files…
```

## State machine

```
empty ──appendProgress──▶ filled
filled ──appendProgress──▶ filled (capped at 5 visible + "+K more")
filled ──markResolved/Rejected/Canceled──▶ cleared
cleared ──unmount──▶ (gone)
```

## Event flow

```
1. Tool starts → markRunning(id) → ToolUseBlockView mounts ProgressLines slot.
2. Tool calls ctx.progress(event) → AgentRunner pushes StreamEvent.progress to channel.
3. StreamingTurnController.consume routes to runStateStore.appendProgress(id, event).
4. ProgressLines (subscribed via subscribeToolUse(id)) re-renders.
5. Tool resolves → store removes entries → slot empties.
```

## Component mapping

| UI region | Component | Source |
|---|---|---|
| Slot container | `ProgressLines` | this feature |
| Per-kind formatter | `formatProgress(event)` (pure helper) | this feature |
| Sub-agent tree | hands off to `AgentProgressTree` (F09) when `event.kind === 'agent'` | F09 |
| Color tokens | Obsidian CSS vars per [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer) | — |

### Storybook

`src/ui/chat/blocks/ProgressLines.stories.tsx`. Stories:

- `BashTailing` — appended stdout lines, growing.
- `BashWithExit` — exit code pill at end.
- `WebSearchProgress`.
- `McpToolCall`.
- `SkillProgress`.
- `OverflowTruncated` — 12 entries, only 5 visible + "+7 more".
- `ClearOnResolve` — story flips state from filled to empty.

Mocks: `mockProgressByToolUseId` from F14.

## Back-link

[feature.md](./feature.md)
