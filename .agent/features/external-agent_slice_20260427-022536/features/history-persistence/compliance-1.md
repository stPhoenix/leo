# Compliance iteration 1 — F12 history-persistence

## Acceptance criteria

- AC1: PASS — `WidgetPayload {kind, props}` already in `chat/types.ts`; `EXTERNAL_AGENT_WIDGET_KIND='external_agent_widget'` registered via `widgets/registry`. Existing thread JSONs without this kind load cleanly (no schema migration needed).
- AC2: PASS — `orchestrator.ts:terminal handler` calls `persistSnapshot(snapshot)` exactly once per terminal; `main.ts:persistExternalAgentSnapshot` appends a widget message to `chatMessageStore`.
- AC3: PASS — `terminalSnapshot.test.ts:round-trip serialize → JSON → deserialize` asserts `toEqual` after JSON round-trip.
- AC4: PASS — `ExternalAgentTerminalBlock` renders without any controller; `ExternalAgentTerminalBlock.test.tsx:expand toggles refine transcript + response` proves expand path.
- AC5: PASS — `main.ts:onunload` iterates `liveHandlesSnapshot()`, builds reload-snapshot per handle, appends to chat store, cancels handle. Snapshot construction tested in `terminalSnapshot.test.ts:error state with reload code carried through`.
- AC6: PASS — `filterSecretFields` test confirms `apiKey` (secret) dropped + `model` retained.
- AC7: PASS — `tryParseTerminalSnapshot` returns null on missing fields / bad input. `ExternalAgentTerminalBlock.test.tsx:renders nothing for malformed payload` verifies UI side.

## Scope coverage

- In scope `extend chat block discriminated union`: PASS — used existing `WidgetPayload` indirection; same outcome.
- In scope `Persisted payload (Zod schema)`: PASS — `TerminalSnapshotSchema`.
- In scope `messageStore handle persistence + rehydration`: PASS — append + existing storedToRecords/recordsToStored handle widget round-trip.
- In scope `widgetController extends to emit terminalSnapshot`: PASS via orchestrator emitting on terminal (same effect).
- In scope `Reload-rehydration path via onunload`: PASS.
- In scope `Adapter-config snapshot filter`: PASS.
- In scope `Vitest suite covering round-trip / secret filter / reload-flush / malformed`: PASS.

## Out-of-scope audit

- Out of scope `Conversation-store schema migration`: CLEAN — additive only.
- Out of scope `Streaming-state persistence`: CLEAN — only terminal snapshots persist.
- Out of scope `New UI`: CLEAN — terminal block reuses F08-style summary; no new design surface.

## QA aggregate

PASS (typecheck + lint + tests + build all green; +13 tests). Integration gate: `EXTERNAL_AGENT_WIDGET_KIND`, `ExternalAgentTerminalBlock`, `buildTerminalSnapshot`, `resolveAdapterConfig`, `registerWidget` all referenced from `src/main.ts`. Reload-flush runs first in `onunload`.

## Verdict: PASS
