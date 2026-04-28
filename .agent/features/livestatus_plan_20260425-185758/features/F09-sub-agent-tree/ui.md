# F09 — UI: sub-agent progress tree

## Layout

Active sub-agent:

```
● Task(launch: "explore-codebase")
   └─ Explore · 7 tools · 4.2k tokens
      └─ Read src/main.ts
```

Multiple agents (mixed):

```
● Task(launch: "review-pr")
   ├─ Plan · 2 tools · 800 tokens
   │  └─ Initializing…
   ├─ Code · 5 tools · 3.1k tokens
   │  └─ Edit src/foo.ts
   └─ Test · done · 1.4k tokens
      └─ Done
```

Background:

```
● Task(launch: "indexer-warm")
   └─ Indexer · 18 tools · 12k tokens
      └─ Running in the background
```

## State machine

Per agentId snapshot:

```
init ──first event──▶ Initializing…
Initializing… ──event with lastToolInfo──▶ active
active ──event update──▶ active'
active ──isResolved && !isError──▶ Done
active ──isResolved && async──▶ Running in the background
active ──isResolved && isError──▶ Done (error pill)
```

## Event flow

```
1. F08 receives StreamEvent.progress with kind:'agent'.
2. runStateStore.appendProgress(toolUseId, event).
3. AgentProgressTree subscribes via subscribeToolUse(toolUseId).
4. aggregateAgentProgress(events) → Map<agentId, snapshot>.
5. Render rows in insertion order (Map preserves it).
```

## Component mapping

| UI region | Component | Source |
|---|---|---|
| Tree container | `AgentProgressTree` | this feature |
| Row | `<AgentRow snapshot connector>` | this feature |
| Aggregator | `aggregateAgentProgress(events)` (pure helper) | this feature |
| Color/tree glyphs | Obsidian vars + Unicode `└─` / `├─` per [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer) | — |

### Storybook

`src/ui/chat/blocks/AgentProgressTree.stories.tsx`. Stories:

- `SingleInitializing`.
- `SingleActive`.
- `SingleDone`.
- `ThreeAgentsMixed`.
- `BackgroundResolved`.
- `ErroredAgent`.

Mocks: `mockAgentProgressEvents` array in F14's shared mocks.

## Back-link

[feature.md](./feature.md)
