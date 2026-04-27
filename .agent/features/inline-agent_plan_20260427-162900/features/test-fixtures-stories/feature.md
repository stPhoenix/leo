# F18 — Test fixtures + Storybook scenarios

## Purpose

Land the cross-cutting test infrastructure required by NFR-IA-06 / NFR-IA-07 — fake `ChatModel` driver, msw fixtures for Tavily + arbitrary HTTP, the consolidated integration-test suite covering scenarios that span more than one feature (recursion guard, abort cleanup, partial-flush ordering, classifier fallback, planner fallback). Add Storybook fixtures to the existing `ExternalAgentWidget.stories.tsx` showing inline-agent runs (simple route streaming, multistep route with note count + step progression, classifier-fallback warning surface). Covers NFR-IA-06, NFR-IA-07.

## Scope

In scope:
- `tests/unit/externalAgent/adapters/inlineAgent/_fakes/fakeChatModel.ts` — fake `ChatModel` with scripted token deltas + tool calls + final assistant message; supports `withStructuredOutput` mocking. Used across F11/F12/F13/F14/F15 unit tests.
- `tests/unit/externalAgent/adapters/inlineAgent/_fakes/msw/tavily.ts` — msw handlers for Tavily success / 401 / 429 / 503 / oversize body responses.
- `tests/unit/externalAgent/adapters/inlineAgent/integration.test.ts` covering:
  - Recursion guard — every branch's tool list asserted not to contain `delegate_external` (negative test injects forbidden tool to ensure assertion fires).
  - Abort cleanup — abort signal during simple branch, multistep step, synthesize; verify sandbox wiped + iterable terminated within 2 s grace.
  - Partial flush — iteration_limit during simple branch yields prior nominations as `file` events.
  - Classifier fallback — schema mismatch + LLM error each route to simple with one `log warn`.
  - Planner fallback — empty plan routes to simple with one `log warn`.
  - Recursion guard — cannot invoke `delegate_external` (negative — confirms it is not in any tool list).
- Storybook fixtures in [`src/ui/chat/blocks/ExternalAgentWidget.stories.tsx`](../../../../src/ui/chat/blocks/ExternalAgentWidget.stories.tsx) — scripted `ExternalEvent` streams that exercise the existing widget for inline-agent runs:
  - `inline-agent / simple` — text stream + a single `publish_artifact` log + `file` + `done`.
  - `inline-agent / multistep` — classifier `log info`, planner `log info`, three research-step phases each with note count, synthesize text, two artifacts.
  - `inline-agent / classifier-fallback` — `log warn` followed by simple branch.
  - `inline-agent / iteration-limit` — error event with partial artifact flush before terminal.
- Storybook UI design lives in [./ui.md](./ui.md).

Out of scope:
- New chat block component — reused `ExternalAgentWidget` and `ExternalAgentTerminalBlock`.
- E2E browser tests — manual smoke checklist already covers (per [`.agent/standards/tech-stack.md`](../../../../.agent/standards/tech-stack.md) §Testing).
- Per-feature unit tests already owned by their respective features.

## Acceptance criteria

1. `tests/unit/externalAgent/adapters/inlineAgent/integration.test.ts` is green; covers all NFR-IA-06 enumerated scenarios ([context.md#nfr-ia-06](../../context.md#non-functional-requirements)).
2. Fake `ChatModel` exports a scriptable interface enough to drive every node without a real provider — verified by `pnpm test` excluding `vitest.llm.config.ts` ([context.md#nfr-ia-07](../../context.md#non-functional-requirements)).
3. msw handlers for Tavily success / 4xx / 5xx / oversize present and reused by F07 unit tests.
4. `ExternalAgentWidget.stories.tsx` exposes 4 inline-agent scenarios; each renders without runtime errors in `pnpm storybook`.
5. Recursion guard assertion has a positive test (clean tool lists) and a negative test (injecting forbidden tool name asserts the guard fires).
6. Abort cleanup test injects a 5 s tool delay, fires abort, and asserts sandbox wiped + iterable terminated within ≤ 2 s grace.
7. Partial-flush ordering: cap-hit yields existing `file` events before the `error` event.

## Dependencies

- [F16 — graph wiring](../graph-wiring/feature.md) (full adapter behaviour available).
- All upstream tool / branch / node features (F01–F15).
- [`src/ui/chat/blocks/ExternalAgentWidget.stories.tsx`](../../../../src/ui/chat/blocks/ExternalAgentWidget.stories.tsx) — existing Storybook entry point.
- [`tests/unit/externalAgent/`](../../../../tests/unit/externalAgent/) — existing adapter test directory.
- [context.md#nfr-ia-06](../../context.md#non-functional-requirements), [context.md#nfr-ia-07](../../context.md#non-functional-requirements).

## Implementation notes

- Vitest unit + msw fixture conventions: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Testing".
- Storybook patterns + Obsidian-vars preview: [`.agent/standards/project-structure.md`](../../../../.agent/standards/project-structure.md) (`.storybook/` entry).
- Tech-stack note on Vitest + msw + storybook scenarios: [`.agent/standards/tech-stack.md`](../../../../.agent/standards/tech-stack.md) §"Testing".
- Best-practices test pyramid: [`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Testing & Quality Gates".

## Open questions

- Does the existing Storybook preview support adapter widgets without mocking the host subgraph entirely? Inspect [`src/ui/chat/__stories__/mocks/sources.ts`](../../../../src/ui/chat/__stories__/mocks/sources.ts) before scripting fixtures.
- How to script the `inline-agent / iteration-limit` story so the partial-flush ordering is observable to a reviewer (the widget collapses summary)? Decide whether to unfold by default in this story.
- Should the fake `ChatModel` be re-exportable for the existing main-agent test suite? Out of scope; keep it adapter-private to honor isolation.
