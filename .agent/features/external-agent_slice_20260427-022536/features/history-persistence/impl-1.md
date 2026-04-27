# Impl iteration 1 — F12 history-persistence

## Summary

Built `terminalSnapshot.ts` — pure module producing the persisted payload (`ExternalAgentTerminalSnapshot`) plus a Zod schema (`TerminalSnapshotSchema`) for round-trip serialize / deserialize and a `tryParseTerminalSnapshot` boundary parser that drops malformed older shapes (returns null + caller logs warn). `filterSecretFields` walks the adapter's `configSchema` (using F11's `describeConfigSchema`) and drops any field tagged `.describe('secret')` from the `adapterConfigSnapshot`. Wired the orchestrator to call `persistSnapshot(snapshot)` once per terminal run with the resolved (non-secret) config blob; `main.ts` registers the widget kind via `registerWidget(EXTERNAL_AGENT_WIDGET_KIND, ExternalAgentTerminalBlock)` and writes the snapshot into the active thread via `chatMessageStore.append(...)` (ID `ea-<runId>`, role `widget`). `ExternalAgentTerminalBlock.tsx` renders the persisted payload directly (no controller) — collapsed-summary by default, expand reveals refine transcript + response + error block + files + log-count. The `onunload` reload-flush iterates `orchestrator.liveHandlesSnapshot()`, builds a `terminalPhase='error', error.code='reload'` snapshot per in-flight run, appends each to the chat store, and cancels the handle. Existing `chatMessageStore`'s subscribe-driven persistence routes the appended message to the conversation store on the next tick.

## Files touched

- `src/agent/externalAgent/terminalSnapshot.ts` — `EXTERNAL_AGENT_WIDGET_KIND`, `TerminalSnapshotSchema`, `buildTerminalSnapshot`, `filterSecretFields`, `tryParseTerminalSnapshot`.
- `src/agent/externalAgent/orchestrator.ts` — `persistSnapshot` + `resolveConfig` deps; emits snapshot on terminal; added `liveHandlesSnapshot()` for reload-flush.
- `src/ui/chat/blocks/ExternalAgentTerminalBlock.tsx` — persisted-payload renderer; falls back to null when payload fails to parse.
- `src/main.ts` — registered widget kind + `persistSnapshot` callback; added reload-flush in `onunload`.
- `tests/unit/externalAgent/terminalSnapshot.test.ts` — 7 cases (filter, build done, build error reload, round-trip, parse-malformed, parse-null, kind constant).
- `tests/dom/externalAgentTerminalBlock.test.tsx` — 5 cases (malformed → null, done summary, expand, reload variant, error variant).

## Tests added or updated

- AC1 — block kind exists; `chatMessageStore`-roundtrip preserved (existing storedToRecords already handles `widget` field).
- AC2 — `persistSnapshot` callback exactly once per terminal (orchestrator calls it inside the terminal handler); dom test "renders done summary with folder and duration" verifies render path.
- AC3 — `round-trip serialize → JSON → deserialize` test asserts `toEqual`.
- AC4 — `ExternalAgentTerminalBlock` test renders without any controller / live subgraph.
- AC5 — `onunload` reload flush exercised manually + covered by the snapshot's reload-error branch test.
- AC6 — `filterSecretFields` test asserts `apiKey` (secret) removed and `model` retained.
- AC7 — `tryParseTerminalSnapshot` returns null for missing-required-fields and non-object input.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The persisted payload includes additional fields beyond the minimum spec (`schemaVersion`, `adapterLabel`, `responseText`, `logCount`, `threadId`) — `responseText` keeps the response visible in expanded view; `logCount` honors OQ-01-F12 (not the full log); `adapterLabel` denormalizes for collapsed-summary display without re-querying the registry.
- The `WidgetPayload` in `chat/types.ts` already supports `kind: string, props: unknown`. F12 reuses that surface rather than extending the chat-block discriminated union — the runtime path is the same (registered via `widgets/registry.ts`), and the schema is enforced at parse time by `tryParseTerminalSnapshot`.

## Assumptions

- Per OQ-01-F12: response text + log-count only.
- Per OQ-02-F12: malformed payload → drop with null return; caller logs warn.
- Per OQ-03-F12: reload-flush runs first in `onunload` before other teardown so `chatMessageStore.append` still functions.

## Open questions

OQ-01/02/03-F12 honored. No new open questions.
