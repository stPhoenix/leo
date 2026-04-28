# F13 — Planner node

## Purpose

Build the `planner` node for the multistep branch: accepts `initialPlan` from the classifier when present, otherwise issues one structured-output LLM call for `{ plan: string[] }`. Clamps plan length to `[1, planMaxSteps]` (default 8, max 16). On empty / unparsable plan: fall back to simple branch with `log warn`. Covers FR-IA-37.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/multistep/planner.ts` exporting:
  - `async planSteps({ providerFactory, config, refinedAsk, initialPlan, signal, runState, logger }): Promise<{ ok: true; plan: string[] } | { ok: false; reason: 'empty' | 'unparsable' | 'llm_error' }>`.
  - When `initialPlan?.length > 0`: clamp to `[1, planMaxSteps]`, return as `plan`.
  - Otherwise: structured-output LLM call (single attempt — same retry-then-warn pattern as F11), schema `{ plan: z.array(z.string().min(1)).min(1).max(planMaxSteps) }`.
  - Empty / unparsable / LLM error → return `{ ok: false, reason }`; caller (F16) routes back to simple branch with `log warn`.
  - Tick `runState.iterations` and `cumulativeTokens` only when LLM is invoked.
  - Emits one `log info { node: 'planner', planLength, durationMs }` (no `text`).

Out of scope:
- Per-step research execution — F14.
- Synthesize node — F15.
- Re-planning mid-run — out of v1.

## Acceptance criteria

1. `initialPlan` non-empty → clamp to `[1, planMaxSteps]`, return without LLM call ([context.md#fr-ia-37](../../context.md#functional-requirements)).
2. `initialPlan` absent / empty → one structured-output LLM call with `{ plan: string[] }` schema, clamp result to `[1, planMaxSteps]` ([context.md#fr-ia-37](../../context.md#functional-requirements)).
3. Empty (`plan: []`) or unparsable response → `{ ok: false, reason }`; downstream caller emits `log warn` and falls back to simple ([context.md#fr-ia-37](../../context.md#functional-requirements)).
4. `planMaxSteps` clamps at config value (default 8) and at hard max 16.
5. One `log info` event on completion, no `text` events ([context.md#fr-ia-45](../../context.md#functional-requirements)).
6. Iteration + token counters incremented only on LLM-invocation path.

## Dependencies

- [F02 — config schema](../config-schema/feature.md) — `planner.planMaxSteps`.
- [F04 — run state + budgets](../run-state-budgets/feature.md).
- [F05 — event bridge](../event-bridge/feature.md).
- [F11 — classifier router](../router-classify/feature.md) — supplies `initialPlan`.
- [context.md#fr-ia-37](../../context.md#functional-requirements).

## Implementation notes

- Structured output via `withStructuredOutput`: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"LangGraph / Agent Layer".
- Pure planning node, IO confined to single LLM call: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"LangGraph / Agent Layer".

## Open questions

- Should the planner LLM be the same `model` as the run (`config.model`) or a smaller faster model? SRS uses one model. Lean: single model.
- Should `planMaxSteps` default change with `routingMode === 'deep'` (e.g. up to 12)? SRS keeps default 8 in both modes. Stick with that.
- Plan-step strings unbounded length — should we cap each step to e.g. 200 chars? Defer; LLM tends to keep them short.
