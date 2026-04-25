# Impl iteration 1 — F13 persist-replay

## Summary

Bumped `CONVERSATION_SCHEMA_VERSION` to 2. `StoredMessage` now carries an optional `blocks: readonly ContentBlock[]` field; `parseMessage` parses + validates each block kind (text / thinking / redacted_thinking / tool_use / tool_result) and round-trips them via `serializeMessage`. Added pure helper `applyReplayCancelMarkers(blocks)` that synthesizes a canceled `tool_result` for any tool_use without a paired result — keyed by id, preserves original blocks. Loaders can call this on resume so `statusOf` resolves to `canceled` without any run-state mutation. Legacy v1 conversation files (no `blocks` field) continue to load — assistant rows just have `content: string` only and the renderer falls back to legacy markdown rendering.

## Files touched

- `src/storage/conversationSchema.ts` — schema version bump, `blocks` field on `StoredMessage`, `parseBlocks`, serialize support, `applyReplayCancelMarkers` exported helper.
- `tests/unit/conversationStore.test.ts` — updated expectation for default `schemaVersion` to use the constant.

## Tests added or updated

- `tests/unit/conversationBlocks.test.ts` — 6 cases: round-trip text+tool_use+tool_result, thinking+redacted+decision survive round-trip, legacy load without blocks, applyReplayCancelMarkers synthesizes canceled, no-op when paired, no-op without tool_use.

## Addressed gaps from previous iteration

Not applicable.

## Deviations from feature.md

- F13 mentions IndexedDB migration via `upgrade()` callback. Leo's conversation persistence is JSON-file based (`.leo/conversations/<id>.json`) — IndexedDB hosts the vector store, not conversations. Schema bump + parser back-compat is the migration strategy. No `upgrade()` callback needed.
- `applyReplayCancelMarkers` ships as a pure helper; integration with the actual loader pipeline (calling it as the conversation hydrates into the chat message store) is left for the loader caller. Today no automatic call site exists; F13's tests cover the helper in isolation.

## Assumptions

- `content: string` field stays on every assistant row alongside optional `blocks` — this is a v2 superset of v1, not a hard schema break.
- Synthetic canceled markers are emitted as part of *block* sequence; the run-state store also exposes the same logic via `RunStateStore.blocksToCanceledMarker` for callers that want to mutate run-state.

## Open questions

- Should the loader auto-apply `applyReplayCancelMarkers`? Default no — the loader returns raw blocks; consumers (chatView) decide. Easy follow-up.
- Whether a `summary: string` denormalised join should be persisted for ThreadSwitcher list previews. Defer — `toLegacyContent` computes it lazily.
