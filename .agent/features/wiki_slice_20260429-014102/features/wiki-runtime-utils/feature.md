# F04 — Wiki budgets, logging namespaces, runId, live controller registry

## Purpose

Pure utility scaffolding shared by every later wiki feature: token caps, logging namespaces, `runId` generator, and the live-controller registry that bridges serialized widget block props to live controllers. Covers [context.md `Non-functional requirements`](../../context.md#non-functional-requirements) NFR-03, NFR-10.

## Scope

- In:
  - `src/agent/wiki/budgets.ts` exporting eight `as const` token caps (NFR-10).
  - `src/agent/wiki/loggingNamespaces.ts` exporting `wiki.ingest.*`, `wiki.lint.*`, `wiki.search.*` namespace constants (NFR-03).
  - `src/agent/wiki/runIdRegistry.ts` exporting `generateWikiRunId({ now, tail })` returning `YYYYMMDD-HHmmss-<6char>`.
  - `src/agent/wiki/liveControllerRegistry.ts` — `Map<runId, WikiWidgetController>` with `register/get/release` and a `WIKI_LIVE_KIND` constant.
- Out: subgraph code, widget UI code, tools.

## Acceptance criteria

1. `budgets.ts` exports `extractorInputCap=8000`, `extractorOutputCap=1500`, `reducerInputCap=6000`, `reducerOutputCap=2000`, `plannerInputCap=4000`, `plannerOutputCap=1500`, `checkerInputCap=6000`, `checkerOutputCap=1500` as `as const` (NFR-10).
2. `loggingNamespaces.ts` exports namespace constants and a sensitive-field key list mirroring the external-agent pattern (NFR-03).
3. `generateWikiRunId({ now, tail })` is deterministic given inputs and produces a 22-char string.
4. `liveControllerRegistry.register(runId, controller)` is idempotent; `release(runId)` is idempotent.
5. None of these modules import DOM, React, or LangGraph.
6. Each module has a unit test.

## Dependencies

- None (utility scaffolding).
- Anchors: [context.md `Non-functional requirements`](../../context.md#non-functional-requirements), [context.md `Constraints`](../../context.md#constraints).

## Implementation notes

- Pure utility scaffolding lives in the agent layer per [architecture.md §3.2](../../../../architecture/architecture.md#32-agent-layer) — modules import zero platform / UI APIs.
- Mirrors external-agent counterparts at `src/agent/externalAgent/{runId.ts, liveControllerRegistry.ts, loggingNamespaces.ts}` per [project-structure.md](../../../../standards/project-structure.md).
- `as const` literal unions, no `enum`, per [code-style.md `TypeScript`](../../../../standards/code-style.md).
- `Logger` is the only logging surface — no `console.log` — per [code-style.md `Logging`](../../../../standards/code-style.md) and [architecture.md §3.4](../../../../architecture/architecture.md#34-adapters).

## Open questions

- None.
