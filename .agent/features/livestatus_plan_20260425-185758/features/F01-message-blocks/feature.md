# F01 — Tagged-union message content

## Purpose

Replace the flat `ChatMessageRecord.content: string` shape with a typed `content: ContentBlock[]` array so the chat surface can carry text, thinking, tool-use and tool-result blocks side-by-side. Upstream of every other live-status feature: every renderer reads blocks; every persisted message stores blocks. Covers [FR-01](../../context.md#functional-requirements), [FR-06](../../context.md#functional-requirements), [FR-07](../../context.md#functional-requirements), [NFR-04](../../context.md#non-functional-requirements).

## Scope

In scope:
- New tagged union `ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock` exported from `@/chat/types`.
- `ChatMessageRecord` gains `content: readonly ContentBlock[]`. The legacy `content: string` field stays writable on user messages and banner rows; assistant rows move fully to blocks.
- `ChatMessageStore.update` helpers for per-index block patching (`updateBlock(messageId, index, patch)`, `appendBlock(messageId, block)`).
- `MessageList` AssistantBubble renders the block array — mounting a per-block renderer chosen by `block.type`. Existing markdown render + cursor logic shifts onto the *last text block of a streaming assistant message*.
- Banner / widget / user rows stay string-content (out of scope of typed blocks).
- Compat shim: a helper `toLegacyContent(record)` that joins text blocks for callers still doing `.content` reads (logging, action bar copy).

Out of scope:
- Aggregator changes — F02.
- Run-state — F03.
- Persistence migration — F13.
- New tool-use / tool-result *visual* renderers — F04 / F05 only consume the new types.

## Acceptance criteria

1. `ChatMessageRecord` declares `readonly content: readonly ContentBlock[]` and the union types are exported. (FR-01)
2. `ChatMessageStore` gains `updateBlock` and `appendBlock`; existing `set` / `append` / `update` keep working. Assistant message rows always have a non-empty `content` array; `[]` is illegal post-aggregator (FR-02 prereq).
3. `MessageList.AssistantBubble` iterates `record.content` and renders one slot per block via a registry (`blockRenderers[type]`). Default fall-throughs render an `<unknown block>` debug marker behind a `data-debug` attribute. (FR-06)
4. Streaming cursor renders only when *the last block of the message is a text block and message status is `streaming`*. Existing copy/edit action bar still works. (FR-07)
5. `toLegacyContent(record)` returns the concatenated text of all `text` blocks; used by `MessageActionBar` copy + `Logger`. Existing `record.content` reads are migrated to call the helper or read blocks directly.
6. Vitest coverage: `messageStore.test.ts` covers `updateBlock`/`appendBlock`; type-level test confirms `ChatMessageRecord.content` is `readonly ContentBlock[]`. (NFR-04)

## Dependencies

- None upstream.
- Downstream: F02, F03, F04, F05, F06, F07, F08, F09, F10, F11, F12, F13, F14.
- Touches: [`src/chat/types.ts`](../../../../../src/chat/types.ts), [`src/chat/messageStore.ts`](../../../../../src/chat/messageStore.ts), [`src/ui/chat/MessageList.tsx`](../../../../../src/ui/chat/MessageList.tsx), [`src/ui/chat/MessageActionBar.tsx`](../../../../../src/ui/chat/MessageActionBar.tsx).

## Implementation notes

- Schema shape and field semantics: see [`livestatus.md` §2](../../../../srs/livestatus.md) — types map 1:1 (block.type, tool_use_id, signature optional).
- Store hook pattern: keep `useSyncExternalStore` semantics from the existing [`MessageList`](../../../../../src/ui/chat/MessageList.tsx) — do not introduce Zustand or context.
- Type discipline: tagged union via `as const` literal `type` field — see [`code-style.md` § TypeScript](../../../../standards/code-style.md#typescript) for the no-enum / unions-as-string-literals rule.
- React component patterns: function components, hooks order, memoization — see [`code-style.md` § React 18](../../../../standards/code-style.md#react-18).
- Architecture layering: this feature mutates Chat domain (`src/chat`) + UI (`src/ui/chat`). Both already inside the upper layers per [`architecture.md` §2](../../../../architecture/architecture.md#2-layer-diagram); no back-edges introduced.

## Open questions

- Whether to keep `content: string` on `ChatMessageRecord` *also* (denormalised join) for action-bar copy speed, or compute lazily via `toLegacyContent`. Default plan: lazy — saves persistence size.
- Block ID stability: blocks are addressed by array index per Anthropic schema. Decide whether to add a `blockId: string` for React keys — recommended `blockId = ${messageId}:${index}` derived in renderer; no extra storage.
