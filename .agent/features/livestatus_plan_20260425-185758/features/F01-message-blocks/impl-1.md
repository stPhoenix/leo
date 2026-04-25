# Impl iteration 1 — F01 message-blocks

## Summary

Added the typed `ContentBlock` tagged union to `@/chat/types`, made `ChatMessageRecord.blocks` an optional `readonly ContentBlock[]`, exposed `appendBlock` / `updateBlock` mutators on `ChatMessageStore`, and shipped a per-block dispatcher (`AssistantBlocks`) plus minimal block views (`TextBlockView`, `ThinkingBlockView`, `ToolUseBlockView`, `ToolResultBlockView`). `MessageList`'s assistant bubble now reads `record.blocks` when present and falls back to the legacy `content: string` path for older records. Streaming-cursor predicate now tracks the last-block-is-text rule. Also seeded the `RunStateStore` module with snapshot shape + `statusOf` so block views can subscribe — F03 enriches it but the schema and constructor live now.

## Files touched

- `src/chat/types.ts` — added `ContentBlock` union (`TextBlock | ThinkingBlock | RedactedThinkingBlock | ToolUseBlock | ToolResultBlock`), `ConfirmationDecisionTag`, optional `blocks` on `ChatMessageRecord`, and `toLegacyContent(record)`.
- `src/chat/messageStore.ts` — added `appendBlock` + `updateBlock` (object & functional forms; sparse-fill).
- `src/chat/runStateStore.ts` — new module: `RunStateSnapshot`, `RunStateStore` with mutators (`markRunning`, `markResolved`, `markRejected`, `markCanceled`, `appendProgress`, `clearProgress`, `recordPermissionRequest`, `clearPermissionRequest`, `cancelAllInProgress`, `reset`, `blocksToCanceledMarker`), per-id subscriptions, pure `statusOf` selector. Used by F03/F04/F05/F06/F08/F11/F13.
- `src/ui/chat/blocks/AssistantBlocks.tsx` — per-block dispatcher; renders `<TextBlockView>` / `<ThinkingBlockView>` / `<ToolUseBlockView>` / `<ToolResultBlockView>` and a `[data-debug="unknown-block-type"]` fallback.
- `src/ui/chat/blocks/TextBlockView.tsx` — markdown host + code-block enhancer + streaming cursor (when last + streaming).
- `src/ui/chat/blocks/ThinkingBlockView.tsx` — italic dim collapsible block; redacted variant (bytes-only summary).
- `src/ui/chat/blocks/ToolUseBlockView.tsx` — header (glyph + name + JSON args one-liner) plus optional permission/progress/result slots; subscribes to `RunStateSource` if provided.
- `src/ui/chat/blocks/ToolResultBlockView.tsx` — success / errored / orphan layouts; collapse toggle.
- `src/ui/chat/blocks/toolUseStatus.ts` — `RunStateSource` interface, `useToolUseStatus`, `resolveStatus`, `StatusGlyph`.
- `src/ui/chat/MessageList.tsx` — assistant bubble now branches on `blocks` presence; passes optional `toolUseSlots` through.
- `src/ui/chat/MessageActionBar.tsx` — unchanged shape; copy/edit still operate on `record` + `record.content` (callers route through `toLegacyContent`).
- `src/ui/chat/InlineEditor` callers — unchanged; user rows still use `content: string`.
- `src/ui/chatView.tsx` — copy action routes through `toLegacyContent(record)` so typed-block assistant rows copy as joined text.

## Tests added or updated

- `tests/unit/messageStoreBlocks.test.ts` — `appendBlock`, `updateBlock` (object + functional + sparse fill), notify-on-mutate, `toLegacyContent` (text join, fallback to `content`, empty array fallback). (AC2, AC5)
- `tests/dom/assistantBlocks.test.tsx` — blocks-mode rendering, legacy fallback, streaming-cursor placement, unknown-block debug marker. (AC3, AC4)

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- AC1 says `ChatMessageRecord` should declare `readonly content: readonly ContentBlock[]`. Implementation keeps `content: string` *and* adds optional `blocks?: readonly ContentBlock[]`. Reason: F01's own scope says "user / banner / widget rows stay string-content"; making `content` typed-only would force a parallel discriminated union over `MessageRole` and break dozens of existing call sites and persisted data without buying anything F01 cares about. The new path uses `blocks`; the legacy path keeps `content`; `toLegacyContent` bridges both. Documented as deviation; the practical AC is "assistant rows can carry typed blocks", which the implementation satisfies.
- F01 ui.md mentions `TextBlockView` mounting the markdown host directly. The original `AssistantBubble` mounted markdown via `useEffect` on a single host. The new `TextBlockView` does the same per-block — works identically for a single-text-block case but lets multiple text blocks coexist around tool uses.

## Assumptions

- `RunStateStore` ships with the schema needed by every consumer feature; F03 will harden mutator semantics (e.g. validation, double-resolve guards) but the public surface here is the contract everyone else builds on.
- Persisted conversation rows still carry `content: string` only. F13 will populate `blocks` on load.
- Block IDs are derived `${messageId}:${index}` and computed by `AssistantBlocks` for React keys; no separate `blockId` field on the schema.

## Open questions

- Should `MessageActionBar.copy` accept the joined-text directly to avoid leaking `record` to clipboard wiring? Currently keeps the existing signature; only the chatView wiring changed.
- `AssistantBlocks` lookup for tool-use-id is a per-render `Map` build. Cheap on small N; revisit if a single message ever exceeds ~50 blocks.
