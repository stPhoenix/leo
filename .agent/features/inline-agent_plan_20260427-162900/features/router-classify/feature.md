# F11 — Classifier router node

## Purpose

Build the `classify_task` first-pass node: single LLM call against the configured provider/model with structured-output via tool call returning `{ route, reasoning, initialPlan? }`. Inputs: refined ask + runtime tool inventory `{ toolId, oneLineDescription }` filtered by `enabled`. Handles routing-mode override (`'auto' | 'simple' | 'deep'`) and one-retry fallback to `route: 'simple'` on classifier failure with a `log warn` event. Covers FR-IA-32, FR-IA-33, FR-IA-34.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/router.ts`:
  - `buildToolInventory(config) → { toolId, oneLineDescription }[]` — only enabled tools (`fetchUrl`, `searchWeb`, `fileOps`, `publish_artifact`).
  - `async classifyTask({ providerFactory, config, refinedAsk, signal, runState, logger }): Promise<{ route, reasoning, initialPlan? }>` — single LLM call with `classify_task` tool schema as the only available tool; one retry on schema-mismatch.
  - On failure: returns `{ route: 'simple', reasoning: 'classifier_fallback', initialPlan: undefined }` and emits `log warn { reason }`.
  - Tick `runState.iterations` and tokens via [F04](../run-state-budgets/feature.md) helpers.
- `src/agent/externalAgent/adapters/inlineAgent/tools/schemas.ts` (subset for classify_task): `{ route: 'simple'|'multistep', reasoning: string, initialPlan?: string[] }` with `initialPlan.length ≤ planner.planMaxSteps` (clamp at parse time).
- Routing-mode override:
  - `'auto'` → call classifier as above.
  - `'simple'` → skip classifier, set `route: 'simple'`, `initialPlan: undefined`.
  - `'deep'` → skip classifier, set `route: 'multistep'`, `initialPlan: undefined` (planner generates from scratch — F13).
- Emits one `log info { node: 'classify_task', route, planLength?, durationMs }` on completion (via F05 `mapNodeComplete`).
- Unit tests: structured-output success path, retry-then-fallback on schema mismatch, retry-then-fallback on LLM error, both override branches skip classifier, plan length clamp, `route` literal mismatch falls back, one `log warn` per fallback (no double-warn).

Out of scope:
- Planner node — F13.
- Token budget enforcement — owned by F16/F04 wiring.

## Acceptance criteria

1. With `routing.mode === 'auto'`, classifier is invoked; success returns valid `{ route, reasoning, initialPlan? }` with `initialPlan` clamped to `[0, planMaxSteps]` ([context.md#fr-ia-32](../../context.md#functional-requirements)).
2. Classifier given **only** the `classify_task` tool — no `fetch_url` / `search_web` / file ops / publish ([context.md#fr-ia-32](../../context.md#functional-requirements)).
3. Tool inventory passed in classifier prompt is **filtered by `enabled`** — disabled tools omitted.
4. Schema parse failure or LLM error → one retry; second failure → fall-back `route: 'simple'`, empty plan, `log warn { reason }` ([context.md#fr-ia-33](../../context.md#functional-requirements)).
5. `routing.mode === 'simple'` and `'deep'` skip the classifier entirely (no LLM call) ([context.md#fr-ia-34](../../context.md#functional-requirements)).
6. Token + iteration counters incremented exactly once per LLM call (zero when overridden).
7. One `log info` event on completion; classifier never emits `text` ([context.md#fr-ia-45](../../context.md#functional-requirements)).

## Dependencies

- [F02 — config schema](../config-schema/feature.md) — `routing.mode`, `planner.planMaxSteps`, tool `enabled` flags.
- [F04 — run state + budgets](../run-state-budgets/feature.md) — `incrementIterations`, `addTokens`, `setRoute`.
- [F05 — event bridge](../event-bridge/feature.md) — `mapNodeComplete`, `log warn`.
- [F01 — adapter scaffold](../adapter-scaffold/feature.md) — `providerFactory`.
- [context.md#fr-ia-32](../../context.md#functional-requirements)..FR-IA-34, [context.md#fr-ia-45](../../context.md#functional-requirements).

## Implementation notes

- LangGraph structured-output via tool calls: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"LangGraph / Agent Layer" + [`.agent/standards/tech-stack.md`](../../../../.agent/standards/tech-stack.md) "Tool schemas" row.
- Pass `signal` to `ChatModel.stream` per [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Async & Concurrency".
- Best-practices fail-fast on retry: surface `log warn` once, do not bury the failure ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Operational Excellence").

## Open questions

- Structured-output API surface differs by provider: OpenAI tool-calls, Anthropic tool-use, LM Studio JSON-mode. Use LangChain's `withStructuredOutput` if uniform across the registry; verify per provider during implementation.
- Should retry use a different temperature (e.g. 0) when the first attempt failed schema validation? Lean: yes — set `temperature: 0` on the retry call to stabilize.
- Is the fallback `reasoning` string used downstream (e.g. in synthesize)? SRS doesn't say. Surface as a `log warn` payload only; do not pass into next node.
