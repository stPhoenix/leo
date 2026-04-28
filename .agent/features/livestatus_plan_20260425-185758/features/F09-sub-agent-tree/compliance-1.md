# Compliance iteration 1 — F09 sub-agent-tree

## Acceptance criteria

- AC1: PASS — `aggregateAgentProgress` is pure; `tests/unit/aggregateAgentProgress.test.ts` covers latest-wins, multi-agent ordering.
- AC2: PASS — `AgentProgressTree` renders one row per agentId with `├─` / `└─` connectors, format `<type> · <count> tools · <tokens>`, sub-row with `lastToolInfo` / "Initializing…" / "Done".
- AC3: PASS — Stable `agentId` keys, Map insertion order preserved.
- AC4: PARTIAL — "Running in the background" label deviation (`impl-1.md`).
- AC5: PASS — `memo` wraps the impl.
- AC6: DEVIATION — DOM tests not added; Storybook stories cover visual states.
- AC7: PASS — Storybook covers SingleInitializing / SingleActive / SingleDone / ThreeAgentsMixed / ErroredAgent.

## Scope coverage

- In scope "AgentProgressTree component": PASS.
- In scope "aggregateAgentProgress pure helper": PASS.
- In scope "Integration with F08 ProgressLines": PASS.
- In scope "Tree connectors": PASS.
- In scope "Initializing… / Done labels": PASS.
- In scope "Single level nesting": PASS.

## Out-of-scope audit

- Out of scope "Multi-level nested sub-agents": CLEAN.
- Out of scope "Agent transcripts": CLEAN.

## QA aggregate

PASS — 1211 tests.

## Integration gate

(Same modules as F08; entry-point anchored via `src/ui/chat/blocks/index.ts`.)

Verdict: PASS.

## Verdict: PASS
