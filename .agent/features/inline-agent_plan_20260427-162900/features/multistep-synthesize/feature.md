# F15 — Synthesize node

## Purpose

Build the multistep `synthesize` node — the *only* node where `publish_artifact` is reachable in the multistep branch. Receives notes-only context (`{ refinedAsk, plan, notes, scratchpad }`) — no raw tool messages — emits final assistant text to the caller, may call `publish_artifact` (and only `publish_artifact`), terminates on assistant message without tool calls. Reserves a minimum of 4 iterations regardless of remaining run budget. Covers FR-IA-40.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/multistep/synthesize.ts` exporting:
  - `async *runSynthesize({ providerFactory, config, runState, sandbox, signal, logger, refinedAsk }): AsyncIterable<ExternalEvent>`.
  - Builds prompt from `{ refinedAsk, plan: runState.plan, notes: runState.notes, scratchpad: runState.scratchpad }`.
  - Tool list: only `publish_artifact` (F09 factory). No `search_web` / `fetch_url` / file ops / `extract_note`.
  - `createReactAgent` with iteration budget from F04 — at least `synthesizeReserve = 4` even when remaining run budget is below.
  - Streams text deltas + tool-call logs through F05.
  - Tick `runState.iterations` and tokens per round-trip.
  - Termination: assistant message without tool calls → exit; downstream graph runs `publishArtifacts` then `done`.

Out of scope:
- Per-step research — F14.
- Recursion guard assertion — F16.
- Top-level graph wiring — F16.

## Acceptance criteria

1. Synthesize tool list contains **only** `publish_artifact` ([context.md#fr-ia-40](../../context.md#functional-requirements)).
2. Prompt receives only `{ refinedAsk, plan, notes, scratchpad }` — no raw tool-result messages ([context.md#fr-ia-40](../../context.md#functional-requirements)).
3. Termination on assistant message without tool calls → caller routes to `publishArtifacts` → `done` ([context.md#fr-ia-40](../../context.md#functional-requirements)).
4. At least 4 iterations available regardless of cumulative budget; allocates from `selectMaxIterations` with `synthesizeReserve = 4` ([context.md#fr-ia-41](../../context.md#functional-requirements)).
5. Each round-trip increments `runState.iterations`; tokens ticked.
6. Stream `text` deltas + tool-call logs per F05 elision rules.
7. `signal` threaded into `ChatModel.stream` and `publish_artifact.invoke`.

## Dependencies

- [F04 — run state + budgets](../run-state-budgets/feature.md) — reserve helper.
- [F05 — event bridge](../event-bridge/feature.md).
- [F09 — publish_artifact](../tool-publish-artifact/feature.md).
- [F14 — research step](../multistep-research-step/feature.md) — supplies `notes`, `scratchpad`.
- [context.md#fr-ia-40](../../context.md#functional-requirements), [context.md#fr-ia-41](../../context.md#functional-requirements).

## Implementation notes

- LangChain `withStructuredOutput` not needed here — synthesize is plain text + tool calls.
- Adapter isolation per [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Imports & Module Boundaries".
- Best-practices: keep prompt assembly in a pure helper; avoid stringly-typed concatenation drift ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Core Principles").

## Open questions

- Notes section formatting — bullet list with `(n1) [title] — summary (relevance: 0.8)`? Confirm a stable format the model can re-cite easily.
- Should synthesize produce a structured response (e.g. `{summary, citations}`) or free-form markdown? SRS implies free-form text. Stick with free-form.
- Hard fail when `notes.length === 0` and `route === 'multistep'`? Probably let synthesize answer with "no information found"; LLM owns the wording.
