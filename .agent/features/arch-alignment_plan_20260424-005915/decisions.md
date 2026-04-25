# Decisions — arch-alignment plan

Resolutions to all open questions from [context.md](context.md) and per-feature docs. Accepted 2026-04-24 by user via `ok` to defaults.

## Gate questions

| # | Question | Decision | Impact |
|---|----------|----------|--------|
| Q1 | LangGraph TS API variant | **Graph API** (`StateGraph` from `@langchain/langgraph`). | Drives F04 node/edge layout; enables F05 `interrupt()`. |
| Q4 | Zod adoption cost | **Bench ran 2026-04-24 → FAIL (+261 KB gz, 6.5× threshold). User overrode gate with option (b): accept bundle cost, proceed with full F01–F08 as planned.** See [bench-q4.md](bench-q4.md). | No longer gates. F01 + F04 + F08 proceed normally. |

## Design defaults

| # | Question | Decision |
|---|----------|----------|
| Q2 | Interrupt vs ConfirmationController | Graph `interrupt()` is the single source. [`src/agent/confirmationController.ts`](../../../src/agent/confirmationController.ts) reduces to a UI-facing adapter. |
| Q3 | File casing (PascalCase arch vs lowerCamel code) | Keep existing lowerCamel in code. Only create missing files (e.g. `src/agent/graph.ts`). Doc-side casing fix deferred to a later arch.md refresh. |
| Q6 | `EventChannel` fate | Keep internal, not exported. Delete in a later cleanup pass once unused. |
| Q7 | Autocompact position | Inside graph as pre-node; participates in cancellation. |
| Q8 | Graph cache vs per-turn rebuild | Per-turn rebuild. Profile only if shown hot. |

## Low-stakes

| # | Question | Decision |
|---|----------|----------|
| Q5 | Tool layout codemod | Single PR moves all built-in tools with `git mv`. |
| Q9 | `appendToNote` split | Split into its own file in `src/tools/builtin/`. |
| Q10 | `tool_result` event payload | Raw `ToolResult<T>`. UI stringifies. |

## Pre-impl action (gate on Q4)

Before F01 or F04 starts:

1. Install `zod` + `zod-to-json-schema` locally.
2. Build with `esbuild` (prod config).
3. Record gz delta vs current baseline.
4. Record bundle deltas in F08 PR description.
5. If > 40 KB gz: pause, escalate to user, revisit counter-proposal.

## Revisit triggers

- Q4 — if bundle delta unacceptable.
- Q8 — if graph-compile cost shows in turn latency benchmarks.
- Q6 — once F07 ships and no remaining EventChannel consumers.
