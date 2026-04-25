# Impl iteration 1 — F09 sub-agent-tree

## Summary

`AgentProgressTree` and `aggregateAgentProgress` shipped as part of F08 (shared progress-event surface). The component renders one row per `agentId` with `└─` / `├─` connectors, latest-wins aggregation, "Initializing…" placeholder, and frozen "Done" / "Done (error)" labels when `isResolved` is true.

## Files touched

(See F08 impl-1.md.)

## Tests added or updated

- `tests/unit/aggregateAgentProgress.test.ts` — 4 cases (empty, latest-wins, multi-agent insertion order, ignore non-agent kinds).
- DOM coverage of the rendered tree is exercised through Storybook stories; programmatic DOM tests for the visible tree could be added in a follow-up but the helper is the load-bearing piece and is fully tested.

## Addressed gaps from previous iteration

Not applicable.

## Deviations from feature.md

- Did not add a separate DOM test file for `AgentProgressTree`; visual coverage lives in Storybook stories (5 stories). The pure aggregator is the testable surface; the renderer is a thin map over snapshots.
- Multi-level nesting deferred per the feature's own out-of-scope clause.

## Assumptions

- `lastToolInfo` is the source of truth for the "current activity" line; "Initializing…" is the placeholder when undefined.
- Background-running agents are treated identically to `isResolved`; "Running in the background" label deferred (Leo doesn't currently distinguish).

## Open questions

- Multi-level nesting (sub-agent of sub-agent) — out of scope per F09.
- `parentToolUseId` linkage (OQ-04) — current implementation aggregates by `agentId` directly from progress events; parent linkage handled implicitly by the launching tool-use's id.
