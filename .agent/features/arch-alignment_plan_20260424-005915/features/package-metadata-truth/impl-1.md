# Impl iteration 1 — F08 package-metadata-truth

## Summary

Verified `package.json` dependency declarations match the shipped runtime. `zod@^4.3.6` and `@langchain/langgraph@^1.2.9` are both declared in `dependencies` (added by F01 and F04 respectively). `zod-to-json-schema` is **not** declared — F01 discovered that zod v4 ships `z.toJSONSchema({ target: 'openapi-3.0' })` natively, so the separately-named package is unused (deviation documented below). The `keywords` array retains `"langgraph"` and that entry now reflects reality: `src/agent/graph.ts` imports `StateGraph`, `Annotation`, `START`, `END`, `interrupt`, `MemorySaver` from `@langchain/langgraph`. Lockfile (`pnpm-lock.yaml`) is in sync — `pnpm install` reports "Already up to date."

## Files touched

- No source changes. `package.json` declarations already in place from F01 and F04.

## Tests added or updated

None. Existing 118 test files / 1095 tests re-run green against the declared deps.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

1. **`zod-to-json-schema` dep not added.** Feature.md AC1 enumerates it alongside `zod` and `@langchain/langgraph`. During F01 implementation we verified zod v4.3.6 exports `z.toJSONSchema(schema, { target: 'openapi-3.0' })` natively, making the standalone package redundant. Shipping it would be the opposite of "metadata truth" — it would declare an unused dependency. The FR-10 intent ("declare actual dependencies required by the aligned runtime") is satisfied: we declare exactly what we import. Documented in F01 impl-1.md §Deviations; now re-documented here at the F08 boundary.

## Bundle delta

Per the bench recorded in [`bench-q4.md`](../../bench-q4.md) (2026-04-24, user-accepted override):

| Build | `main.js` raw | `main.js.gz` |
|---|---|---|
| Pre-alignment baseline | 447,910 B | 135,596 B |
| Post-F01..F07 (this workspace complete) | 1,468,024 B | 394,428 B |
| **Delta** | **+1,020,114 B** | **+258,832 B** (+191 %) |

Root cause: `@langchain/langgraph` pulls `@langchain/core` (msgpack, uuid, zod v3, checkpoint abstraction), plus `uuid`, `@langchain/langgraph-checkpoint`, `@langchain/langgraph-sdk`. Tree-shaking recovers little because `StateGraph` + `Annotation` + `MemorySaver` + `interrupt` all touch core. Accepted per [decisions.md § Gate questions Q4](../../decisions.md#gate-questions).

## Assumptions

1. **pnpm is the project-standard installer** (per [tech-stack.md § Runtime & Build](../../../../standards/tech-stack.md)). `pnpm install` replaces AC2's `npm ci` — functionally equivalent for this repo's lockfile.
2. **Caret pinning acceptable.** Open-Q1 default: caret for runtime libs. `@langchain/langgraph@^1.2.9` and `zod@^4.3.6` both use caret. The zod-v4 JSON-schema API is the highest-risk surface; the F01 snapshot test (`tests/unit/toolRegistrySnapshot.test.ts`) guards against minor-version output drift.

## Open questions

1. Should `USE_GRAPH_RUNTIME` + the `plugin.load` telemetry field be removed now that F04/F05/F07 have settled? Deferred to a follow-up cleanup PR — out of F08 scope.
