# F02 — Stream aggregator → typed blocks

## Purpose

Extend `StreamingTurnController` and the `StreamEvent` union so provider stream events grow a typed `AssistantMessage.content[]` array per content-block index, including buffered tool-use input JSON. Pure boundary normaliser between the provider stream and the chat store. Covers [FR-02](../../context.md#functional-requirements), [FR-03](../../context.md#functional-requirements), [NFR-02](../../context.md#non-functional-requirements), [NFR-09](../../context.md#non-functional-requirements). No UI in this feature.

## Scope

In scope:
- New `StreamEvent` variants modelling `content_block_start | content_block_delta | content_block_stop` and `message_delta` semantics, with delta sub-types `text_delta | thinking_delta | signature_delta | input_json_delta`. Shape mirrors [`livestatus.md` §3](../../../../srs/livestatus.md).
- Per-provider mapping at the boundary (LM Studio + OpenAI-compatible + Anthropic): translate native provider events into the new normalized event shape. Lives next to existing provider modules under `src/providers/`.
- `StreamingTurnController.consume` extended to dispatch on the new event types and call `messageStore.updateBlock` / `appendBlock` (from F01). Keeps RAF coalescing.
- Per-block JSON buffer (`Map<index, string>`) for `tool_use` blocks; on `content_block_stop` parse via `JSON.parse`; on parse failure store `{ __raw: string }`.
- Cumulative `usage` merge keeps existing semantics: replace cache fields, never overwrite non-zero `inputTokens` with zero ([livestatus §3 gotchas](../../../../srs/livestatus.md)).
- Connection-drop handling: mid-stream abort marks the message `status='error'` and keeps partial blocks (existing behaviour preserved + extended to per-block).

Out of scope:
- UI rendering (F04 / F05 / F07).
- Run-state mutators — F03 owns that store; aggregator only emits `tool_call` / `tool_result` events at the block-stop boundary, the existing channel.
- Persistence — F13.
- Tool-call execution side effects.

## Acceptance criteria

1. `StreamEvent` (in [`src/agent/streamEvents.ts`](../../../../../src/agent/streamEvents.ts)) gains variants: `block_start`, `block_delta`, `block_stop`, `message_delta`. Old `token` event maps internally to `block_delta {sub:'text_delta'}` for compatibility during rollout — final code path uses the new variants only. (FR-02)
2. `StreamingTurnController.consume` routes:
   - `block_start` → init `content[index]` via `messageStore.updateBlock` with type-specific empty shape.
   - `block_delta` (`text_delta`) → append text to `content[index].text`.
   - `block_delta` (`thinking_delta`) → append to `content[index].thinking`.
   - `block_delta` (`signature_delta`) → set `content[index].signature`.
   - `block_delta` (`input_json_delta`) → append to internal JSON buffer for index.
   - `block_stop` → finalize: parse JSON buffer for `tool_use`, no-op for others.
   - `message_delta` → update `stopReason` + cumulative usage.
   - `done` / `error` → existing behaviour, finalised with last-known partial blocks. (FR-02, FR-03)
3. RAF coalescing reaches every block kind, not just text. `MessageList` re-renders ≤ once per frame regardless of token rate. (NFR-02)
4. Aggregator is a pure module by data flow: store mutators are injected; no direct DOM, no `Date.now()`. (NFR-09)
5. Provider boundary adapters under `src/providers/` translate provider-native events to the new normalized events. Each provider has unit tests with `msw` fixtures verifying mapping. (NFR-08 from F-context, transitive)
6. JSON parse failure on tool-use input does not stop the stream — block carries `{ __raw }` and aggregator emits a `tool_use_parse_error` log via `Logger`. ([livestatus §3](../../../../srs/livestatus.md))
7. Reconnect / abort mid-stream: in-progress blocks remain in `content[]` with their partial data; message status moves to `error` only when the controller detects a non-cancel termination. ([livestatus §14 edge cases](../../../../srs/livestatus.md))

## Dependencies

- Upstream: [F01](../F01-message-blocks/feature.md) — needs `ContentBlock` types and `updateBlock` / `appendBlock` store API.
- Touches: [`src/chat/streamingController.ts`](../../../../../src/chat/streamingController.ts), [`src/agent/streamEvents.ts`](../../../../../src/agent/streamEvents.ts), [`src/providers/anthropicProvider.ts`](../../../../../src/providers/anthropicProvider.ts), [`src/providers/lmStudioProvider.ts`](../../../../../src/providers/lmStudioProvider.ts), [`src/providers/openAICompatibleProvider.ts`](../../../../../src/providers/openAICompatibleProvider.ts), [`src/providers/sseParser.ts`](../../../../../src/providers/sseParser.ts).
- Downstream: F04, F05, F07, F08, F11.

## Implementation notes

- Streaming format and gotchas: aggregator pseudocode and edge-case list per [`livestatus.md` §3](../../../../srs/livestatus.md) and [`livestatus.md` §14](../../../../srs/livestatus.md).
- Provider abstraction: the existing `ProviderManager` + `StreamEvent` pipeline already passes through `AgentRunner` — see [`architecture.md` §3.4 Adapters](../../../../architecture/architecture.md#34-adapters) and [`architecture.md` §5.2](../../../../architecture/architecture.md#52-chat-turn-no-tools) for the data-flow expectation; this feature only adds variants.
- LangGraph + agent layer constraints (typed state, AbortSignal threading, no thrown errors from tools): see [`code-style.md` § LangGraph](../../../../standards/code-style.md#langgraph--agent-layer).
- Async coalescing pattern: the existing RAF helper in `StreamingTurnController` is the single source — extend it, do not re-roll a debounce per [`code-style.md` § Async](../../../../standards/code-style.md#async--concurrency).
- Logging: `logger.warn('agent.aggregator.parse', { …})` per [`code-style.md` § Logging](../../../../standards/code-style.md#logging).

## Open questions

- OpenAI-compatible providers don't expose Anthropic's `content_block_*` framing — mapping is best-effort. Decide whether to *synthesize* a single text block per assistant message and skip thinking/tool_use unless the provider's tool-call surface fires (in which case wrap into a synthetic `tool_use` block). Tracked as [OQ-02](../../context.md#open-questions).
- Whether to expose the legacy `token` event externally or remove it once consumers migrate. Default: deprecate, keep one release cycle.
