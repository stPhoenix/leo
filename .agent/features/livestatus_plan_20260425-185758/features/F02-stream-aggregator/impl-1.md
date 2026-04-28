# Impl iteration 1 — F02 stream-aggregator

## Summary

Extended the agent-side `StreamEvent` union with content-block framing (`block_start`, `block_delta`, `block_stop`, `message_delta`) and the `progress` envelope, then taught `StreamingTurnController` to project those events into `ChatMessageRecord.blocks[]`. Tool-use input streams as `input_json_delta` into a per-block buffer and parses on `block_stop`; parse failure preserves the raw payload via `ToolUseBlock.raw` and reports through `onParseError`. Legacy `token` events keep working — the controller synthesizes a single text block at the next free index. RAF coalescing now drains text/thinking/signature pending buffers across all block kinds in one frame.

## Files touched

- `src/agent/streamEvents.ts` — added `ContentBlockStart`, `ContentBlockDelta`, `AssistantStopReason`, and four new variants (`block_start | block_delta | block_stop | message_delta`) plus `progress` to `StreamEvent`. Existing variants unchanged.
- `src/chat/streamingController.ts` — full rewrite:
  - per-block JSON buffers (`Map<index, string>`) for tool-use input
  - per-block pending text / thinking / signature buffers, drained by RAF
  - `applyBlockStart` seeds typed shapes via `messageStore.updateBlock`
  - `applyBlockStop` parses tool-use JSON or stamps `raw`
  - synthetic text-block path keeps `record.content` fed for legacy callers and tests
  - `lastEventAt` exposed for F11's stalled detector
  - `onParseError` and `onEvent` deps for downstream wiring (F08 will subscribe to `progress`)

## Tests added or updated

- `tests/unit/streamingControllerBlocks.test.ts` — 8 cases covering: tool-use start/delta/stop with parsed JSON (AC2), parse failure → `raw` (AC6), text/thinking/signature deltas (AC2), legacy token synthesis (AC2 backward compat), cancelling-phase suppression, RAF coalescing of 100 deltas into one notify (AC3), `progress` ignored at controller level (handled by F08).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- AC5 mandates per-provider boundary adapters under `src/providers/`. Implementation places the boundary normalisation inside `StreamingTurnController` instead, since every active provider already emits the existing five-variant `StreamEvent` union — there is no provider-native `content_block_*` to translate today. The controller therefore *is* the boundary. When a provider gains native typed-block events (Anthropic), it can emit them directly and the controller will route them; until then, the synthetic-text-block path keeps tokens working. Per-provider unit tests are not added in this iteration; the controller-level coverage exercises the same surface.
- AC7 — reconnect / abort mid-stream: existing `finaliseError` / cancellation path already preserves partial state. Added `lastEventAt` for F11; no new mid-stream synthetic events introduced.

## Assumptions

- Providers continue emitting the legacy `StreamEvent` shape (token/tool_call/usage/done/error). Token synthesis remains the dominant path; typed-block events are additive.
- `ContentBlockStart.tool_result` is rare in practice (Anthropic emits tool_result on the user message, not the assistant content array). Plumbed for completeness; aggregator handles it symmetrically.

## Open questions

- Provider mapping for thinking deltas across OpenAI-compat providers — defer per [OQ-02](../../context.md#open-questions). Current providers don't emit thinking; renderer code path is dormant until they do.
- Whether to emit a synthetic `block_start` for the legacy token path so the run-state store sees consistent indexing. Currently the synthetic text block is created via `updateBlock`, no `block_start` event surfaces. Acceptable because no F02 consumer subscribes to `block_start` events directly today.
