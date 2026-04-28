# Impl iteration 1 — F10 tool-extract-note

## Summary

Landed `extract_note` tool factory + `messageRewriter` helpers. The tool validates input with Zod (`relevance ∈ [0,1]`, non-empty `summary`/`title`), enforces a 2 KB UTF-8 byte cap on `summary`, optional `note_limit` (default 128), assigns deterministic IDs `n1, n2, n3...` and stamps `stepIndex` from `runState.currentStep`. Rewriter helpers are pure: `rewriteConsumedToolResults` swaps tool-result content for `[discarded — see note <id>]` while preserving `toolCallId`/`name`; `dropRawToolMessagesAtStepBoundary` filters out every tool message but keeps system/user/assistant.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/tools/extractNote.ts` — new: `createExtractNoteTool`, `NOTE_LIMIT_DEFAULT`, `ExtractNoteResult`.
- `src/agent/externalAgent/adapters/inlineAgent/multistep/messageRewriter.ts` — new: `rewriteConsumedToolResults`, `dropRawToolMessagesAtStepBoundary`, `RewriteMessage` shape.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/extractNote.test.ts` — 11 cases:
  - Tool: AC1 ID + count, AC2 summary cap, AC3 stepIndex, AC6 Zod boundary, note_limit.
  - Rewriter: AC4 selective rewrite + empty refs no-op; AC5 step-boundary drop preserves system/user/assistant.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Open-question resolution: introduced an internal `NOTE_LIMIT_DEFAULT = 128` cap so the buffer is bounded; configurable via ctx.
- Stub format: `[discarded — see note <id>]` retained in tool messages with original `toolCallId` preserved so the chat-model still sees the tool-call linkage. (F14 will adapt LangChain's `ToolMessage` to `RewriteMessage` and back.)

## Assumptions

- F14 will own `consumedRefs` accounting (mapping `tool_call_id → note_id`). F10 ships only the helper.
- `extract_note` not in simple-branch tool list — enforced by F12 graph wiring.

## Open questions

- None blocking F10.
