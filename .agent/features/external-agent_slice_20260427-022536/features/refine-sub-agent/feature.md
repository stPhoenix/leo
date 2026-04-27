# F04 — Refine sub-agent (PREPARING phase)

## Purpose

Implement the LLM-driven refine loop that runs inside the `PREPARING` node of the subgraph from F03: takes the user's original ask, optionally asks clarifying questions (via LangGraph `interrupt()`), and emits a `final_prompt` that gets handed to the `READY` phase. Restricted action surface prevents tool abuse and recursive self-delegation.

Implements [`context.md`](../../context.md) FR-EXT-07, FR-EXT-08, FR-EXT-09, FR-EXT-10.

## Scope

**In scope**
- `src/agent/externalAgent/refinePrompt.ts`: pure function returning the refine system prompt. Encodes the file/return contract: "Output exactly one of two tool calls per turn — `ask_clarifying_question(question: string)` or `emit_final_prompt(prompt: string)`. Do not call any other tool."
- Two stub tools wired into the refine sub-agent only: `ask_clarifying_question`, `emit_final_prompt`. These are *internal* — never registered into the global `ToolRegistry`.
- Refine loop driver in `src/agent/externalAgent/subgraph.ts`'s `prepare` node (extending the F03 stub): each iteration calls thread provider with `refineHistory`, parses tool call, branches.
- Budget enforcement: increments `refineIterations` per LLM turn; on `>= refineBudget`, drives transition to `READY` with the sub-agent's last draft (or original ask if no draft yet).
- `interrupt()` integration: when `ask_clarifying_question` fires, suspends graph with the question payload; resume input becomes the user's textual answer appended to `refineHistory`.
- Vitest suite using `MockLangChainProvider` (canned `tool_call` responses): clarifying loop terminates on `emit_final_prompt`, budget exhaustion forces READY, attempts to call other tools are rejected.

**Out of scope**
- Widget rendering of the clarifying question (F08); F04 emits structured interrupt payload only.
- Provider configuration (already exists via `ProviderManager`).
- Edit-from-READY → PREPARING re-entry (state-machine transition lives in F03; F04 just resumes correctly when re-invoked).

## Acceptance criteria

1. Refine sub-agent's allowed tool set is exactly `{ask_clarifying_question, emit_final_prompt}`. Any other `tool_call` from the LLM → graph transitions to `ERROR` with `error.code='refine_invalid_tool'`. Honors FR-EXT-10.
2. Clarifying question fires `interrupt()` carrying `{question: string, askedAt: number}`. Resume payload `{answer: string}` is appended to `refineHistory` as a user message and the loop continues. Honors FR-EXT-08.
3. Budget enforcement: on `iterations >= refineBudget` without `emit_final_prompt`, the loop terminates by synthesizing `refinedPrompt = originalAsk` plus any partial draft hint and transitions to `READY`. Honors FR-EXT-09.
4. `refinePrompt.ts` exports a pure function `getRefineSystemPrompt(): string` (no I/O, no time, no random) so it is snapshot-testable.
5. Sub-agent uses thread's currently-selected provider via `ProviderManager` — does NOT introduce a per-adapter model override (deferred per OQ-01).
6. Refine `text` output of the LLM (if any, alongside tool calls) is appended to `refineHistory` for context but never surfaced as a widget event — the widget only sees clarifying questions and the final prompt.

## Dependencies

- **F03** — extends the `prepare` node and uses `refineHistory`, `refineIterations`, `refineBudget`, `refinedPrompt` fields of `ExternalAgentState`.
- Cross-doc:
  - [`context.md#fr-ext-07`](../../context.md#functional-requirements)
  - [`../subgraph-state-machine/feature.md`](../subgraph-state-machine/feature.md)

## Implementation notes

- LangGraph `interrupt()` pattern — same machinery used by `confirmationController` and `planApprovalController`; see [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §1 ("Interrupt-driven tool flow") and §5.3.
- Provider call shape — use `ProviderManager.stream()` per [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3.4 / §4 (`StreamEvent` union).
- AgentRunner: refine sub-agent calls `ProviderManager` directly during the suspended `delegate_external` tool, preserving FR-AGENT-07 by suspension semantics — full reasoning in [`features-index.md`](../../features-index.md) §"Architecture compliance summary".
- Tool schemas — Zod with `.describe()` on every field per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Zod & Tool Schemas".
- No `any` in tool-call parsing — narrow at boundary per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §TypeScript.
- Pure modules — `refinePrompt.ts` lives in Domain layer per [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3.3 ("Pure core").

## Open questions

- **OQ-01-F04** When the LLM emits *both* a clarifying question and a final prompt in one turn (model bug), which wins? **Proposed**: take `emit_final_prompt`, log `warn` event, ignore the clarifying call.
- **OQ-02-F04** Should the refine system prompt explicitly forbid the model from including vault file paths in the final prompt without quoting their content? Could affect adapter behavior (some adapters can't read vault). **Proposed**: yes — system prompt instructs "always inline content; never reference vault paths the external agent cannot access".
- **OQ-03-F04** Token-cap on clarifying question text and final prompt. **Proposed**: soft-limit 4 KB on final prompt with a `warn` log if exceeded; hard-limit 16 KB → ERROR.
