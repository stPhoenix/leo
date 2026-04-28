# F10 — `extract_note` + message rewriter

## Purpose

Build the multistep-only `extract_note` tool: validates `summary` size cap, appends a `NoteRecord` to `runState.notes`, returns `{ id, noteCount }`. Pair it with a pure `messageRewriter` helper used by the research-step (F14) to rewrite the consumed raw tool-result message into a one-line stub `[discarded — see note <id>]` for subsequent invocations within the same step, and to drop all raw tool messages at the step boundary. Covers the FR-IA-39 mechanism portions; the per-step orchestration sits in F14.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/tools/schemas.ts` (subset for extract_note): `{ sourceUrl?, title, summary, relevance ∈ [0,1] }` per [context.md#fr-ia-39](../../context.md#functional-requirements).
- `src/agent/externalAgent/adapters/inlineAgent/tools/extractNote.ts` exporting `createExtractNoteTool({ runState, logger })`:
  - Generates `id` `n1`, `n2`, ... per nomination order (uses `runState.notes.length + 1`).
  - Enforces `summary` ≤ 2 KB (UTF-8 byte length) → `error: 'summary_too_large'`.
  - Returns `{ ok: true, data: { id, noteCount } }` on append.
  - Records `stepIndex = runState.currentStep ?? null` on the `NoteRecord`.
  - Emits the `[discarded — see note <id>]` rewrite signal to the calling step via the returned tool result; F14 owns the message-history rewrite.
- `src/agent/externalAgent/adapters/inlineAgent/multistep/messageRewriter.ts` exporting:
  - `rewriteConsumedToolResults(messages, consumedRefs): Message[]` — walks `messages`, replaces each tool-result message whose `tool_call_id` is in `consumedRefs` with a stub assistant message body `[discarded — see note <id>]`.
  - `dropRawToolMessagesAtStepBoundary(messages): Message[]` — drops all tool / tool-result messages, leaving system + ask + notes summary + scratchpad summary.
- `consumedRefs` mapping is owned in F14; F10 just provides the helper.
- Unit tests: ID assignment incremental, summary-size cap, rewrite preserves order, rewrite leaves non-consumed tool messages alone, step-boundary drop preserves system + user messages.

Out of scope:
- The actual orchestration of which raw tool result was consumed — F14 owns the bookkeeping of `tool_call_id → noteId`.
- `extract_note` callable from simple branch — explicitly excluded by branch tool-list assembly (F12).

## Acceptance criteria

1. `extract_note` returns `{ ok: true, data: { id, noteCount } }`; `id` increments deterministically `n1, n2, n3...` per nomination order ([context.md#fr-ia-39](../../context.md#functional-requirements)).
2. `summary` >2 KB → `{ ok: false, error: 'summary_too_large' }`; loop continues, LLM may retry ([context.md#fr-ia-39](../../context.md#functional-requirements)).
3. `NoteRecord.stepIndex = runState.currentStep` (null when called outside a research step).
4. `rewriteConsumedToolResults` replaces only tool-result messages whose `tool_call_id ∈ consumedRefs`; others untouched.
5. `dropRawToolMessagesAtStepBoundary` removes tool / tool-result messages but keeps `system`, `human`, and assistant text messages.
6. `relevance` outside `[0,1]` rejected at Zod boundary ([context.md#nfr-ia-02](../../context.md#non-functional-requirements)).
7. `extract_note` not present in simple-branch tool list (negative test in F12 acceptance).

## Dependencies

- [F04 — run state + budgets](../run-state-budgets/feature.md) — `runState.notes` shape.
- [F05 — event bridge](../event-bridge/feature.md) — log mapping (note: `summary` elided to length only at info per [context.md#fr-ia-46](../../context.md#functional-requirements)).
- [context.md#fr-ia-39](../../context.md#functional-requirements).

## Implementation notes

- Pure helper modules: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"LangGraph / Agent Layer".
- Strict TS, no `any` past boundary: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"TypeScript".
- LangChain `Message` types come from `@langchain/core/messages` subpath imports per [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"LangGraph / Agent Layer".
- Best-practices: KISS — no premature abstraction over note-buffer storage ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Core Principles").

## Open questions

- Should the note buffer cap be enforced (e.g. 256 notes per run)? SRS does not specify. Lean: cap to `planMaxSteps × 8` with `error: 'note_limit'` to bound memory.
- Is `[discarded — see note <id>]` the literal stub format LangChain expects in a tool message? Verify the exact message-shape (tool message vs replaced assistant text) when implementing F14 — may need to keep the message as a tool-result with shortened content to preserve `tool_call_id` linkage.
- Step-boundary drop: should we keep the *last* assistant text from a step (so the next step sees prior reasoning summary) or only `notes` + `scratchpad`? SRS says only `notes`, `scratchpad`, original ask survive. Stick with that.
