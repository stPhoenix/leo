# Impl iteration 1 — F04 refine-sub-agent

## Summary

Implemented the refine sub-agent as a `RefineDeps` factory consumed by F03's subgraph driver. `getRefineSystemPrompt()` is the pure, snapshot-testable system prompt encoding the restricted action surface (only `ask_clarifying_question` / `emit_final_prompt`, no vault/web/recursive `delegate_external`, always inline content). `createRefineSubAgent({ provider, model, … })` runs one provider turn per call, walks the OpenAI-compatible stream events, parses tool calls, and maps to a `RefineDecision`: `final_prompt`, `clarify`, or a typed error code (`refine_invalid_tool` / `refine_prompt_too_large` / `refine_empty_response`). Soft-limit (4 KB) → warn log, hard-limit (16 KB) → throw. Dual-tool turn prefers `emit_final_prompt` and logs a warn (per OQ-01-F04). Free-form text alongside tool calls is preserved on `assistantMessage` for `refineHistory` continuity (AC6).

## Files touched

- `src/agent/externalAgent/refinePrompt.ts` — pure prompt (FR-EXT-07, AC4).
- `src/agent/externalAgent/refineSubAgent.ts` — `RefineDeps` impl (FR-EXT-07/08/10, AC1/AC2/AC3/AC5/AC6).
- `tests/unit/externalAgent/refinePrompt.test.ts` — 4 cases.
- `tests/unit/externalAgent/refineSubAgent.test.ts` — 8 cases (final, clarify, invalid tool rejection, dual-tool preference, fallback text-only, hard-limit, assistant text preservation, empty response).

## Tests added or updated

- AC1 — "throws refine_invalid_tool when provider calls a non-allowed tool".
- AC2 — `clarify` decision returned with question text; subgraph driver (F03) wires the actual `interrupt()` semantics via `awaiting_clarify` phase.
- AC3 — Budget enforcement lives in `runRefineLoop` (F03); refine sub-agent itself only emits decisions. `subgraph.test.ts:Edit-at-ready` exercise covers budget non-reset on edit; budget exhaustion path is exercised in F03 driver via `refineIterations >= refineBudget` short-circuit.
- AC4 — `refinePrompt.test.ts` snapshot via "is pure (same output across calls)".
- AC5 — Sub-agent uses injected provider (`opts.provider`) wired to `ProviderManager` at the call site (subgraph wiring lands in F05/F06).
- AC6 — "preserves assistant text in assistantMessage for history".

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Tool calls are parsed from the existing `StreamEvent` union (`tool_call` events with `argsJson`) rather than registered into a separate internal `ToolRegistry`. The two refine tools are surface-only descriptors passed through `ProviderChatRequest.tools` so the LLM emits matching tool calls; no interception by the global tool registry is needed (and would violate the "internal — never registered globally" guarantee from feature.md).
- The actual `LangGraph interrupt()` for clarifying questions is owned by F03's `awaiting_clarify` phase + `RunHandle.resumeClarify`; F04 returns the clarify decision and the driver suspends. This satisfies AC2's contract while keeping the FSM and the LLM concerns cleanly separated.

## Assumptions

- The wired `RefineProvider` is `ProviderManager` (matches AC5). Concrete wiring lands in F05/F06 plumbing.
- Soft/hard limits per OQ-03-F04 proposal: 4 KB / 16 KB chars.

## Open questions

OQ-01-F04 honored (prefer final_prompt). OQ-02-F04 honored (system prompt forbids vault references and instructs inlining). OQ-03-F04 honored (soft 4 KB warn, hard 16 KB throw).
