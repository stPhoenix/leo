# F09 — Sub-agent progress tree

## Purpose

Aggregate `agent`-kind progress events into a per-`agentId` view rendered as a tree under the launching tool-use block. Replaces "in place": each tick overrides the prior aggregate state. Covers [FR-14](../../context.md#functional-requirements), [NFR-04](../../context.md#non-functional-requirements).

## Scope

In scope:
- New component `AgentProgressTree` under `src/ui/chat/blocks/AgentProgressTree.tsx`.
- New pure helper `aggregateAgentProgress(events: ProgressEvent[]): Map<agentId, AgentSnapshot>` — picks the latest event per agentId.
- Integration with F08's `ProgressLines`: when an event has `kind:'agent'`, route it to `AgentProgressTree` slot rather than the bash-style line list.
- Tree connectors `└─` for last child, `├─` otherwise — Unicode glyphs per [`livestatus.md` §16](../../../../srs/livestatus.md).
- Replace `Initializing…` placeholder once first `lastToolInfo` arrives.
- Freeze with "Done" or "Running in the background" once `isResolved=true`.
- Visual nesting: only one level deep (parent tool-use → agent rows). Multi-level nesting (sub-agent of sub-agent) deferred.

Out of scope:
- Multi-level nested sub-agents.
- Agent transcripts (live indicator may surface that later).

## Acceptance criteria

1. `aggregateAgentProgress` is pure: same events array → same map. Vitest covers latest-wins per agentId. (NFR-09 transitive)
2. `AgentProgressTree` renders one row per agentId with connector glyphs and the format `<agentType> · <toolUseCount> tools · <tokens>`. Sub-row shows `lastToolInfo` or "Initializing…" or "Done". (FR-14)
3. Updates in place when new events arrive — no flicker, stable React keys (`agentId`).
4. Async / background agents (per [`livestatus.md` §7.5](../../../../srs/livestatus.md)) render "Running in the background" frozen label once `isResolved=true`.
5. Memoised with `React.memo` keyed by `(agentId, snapshotHash)`. (NFR-04)
6. DOM tests cover: single agent initializing → progressing → done; multi-agent ordering; background-resolved label.
7. Storybook covers: single agent running, three agents (mixed states), all done, background-running.

## Dependencies

- Upstream: [F08](../F08-progress-events/feature.md).
- Touches: new `src/ui/chat/blocks/AgentProgressTree.tsx`, F08's `ProgressLines` component (to delegate).

## Implementation notes

- Per-tick replacement semantics, tree-connector glyphs, "Done" / "Running in the background" labels: see [`livestatus.md` §5](../../../../srs/livestatus.md) and [`livestatus.md` §7.5](../../../../srs/livestatus.md).
- Pure-helper rule (`aggregateAgentProgress`): domain/core layer per [`architecture.md` §3.3](../../../../architecture/architecture.md#33-domain--core-pure).
- React memoization rule: see [`code-style.md` § React 18](../../../../standards/code-style.md#react-18).
- Theming: Obsidian vars per [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer).

## Open questions

- Whether sub-agents launched outside a tool context (e.g. background sweepers) render here at all. Default: only attached to tool-use blocks; orphans go to the bottom-of-chat indicator (F11).
- Multi-level nesting design — defer, captured as follow-up. Reference [OQ-04](../../context.md#open-questions).
