# Impl iteration 1 — F53 mcp-resources-picker

## Summary

Added the pure staging + resolution + composition primitives the MCP resource picker needs. `MCPClient.readResource(serverId, uri, signal)` wraps the transport `readResource?` hook with structured `mcp.resource.read.ok` / `mcp.resource.read.err` log events and returns `{ok: true, data} | {ok: false, error}`. `src/mcp/resourcePicker.ts` exports `ResourcePickerStore` (in-memory toggle/clear with `serverId|uri` key), `StagedResource`, `composeResourceContent(results)` that emits a preamble plus per-resource text blocks (with a failure note when any URI errored), and `resolveStagedResources(staged, readFn, signal)` that threads an `AbortSignal` through the per-entry reads.

## Files touched

- `src/mcp/mcpClient.ts` — extended `McpTransportConnection` with optional `readResource(uri, signal)`, added `McpResourceContent` type and `MCPClient.readResource`.
- `src/mcp/resourcePicker.ts` — new. Exports `MCP_RESOURCES_PREAMBLE`, `StagedResource`, `ResourcePickerStore`, `ResolvedResource`, `composeResourceContent`, `resolveStagedResources`.

## Tests added or updated

- `tests/unit/mcpResources.test.ts` — 7 cases:
  - **AC3** `ResourcePickerStore` toggle + clear + has.
  - **AC4** `composeResourceContent` emits preamble + blocks in order.
  - **AC5** failed URIs surface in preamble, blocks shrink accordingly.
  - **AC6** `MCPClient.readResource` happy path + log emit.
  - **AC6** unknown server + unsupported transport return `{ok: false}`.
  - **AC6** abort signal halts the resolver and marks remaining entries as aborted.

Net delta: +7 tests (951 → 958 passing).

## Deviations from feature.md

- **Picker React UI is parked.** AC1 (inline mount), AC2 (grouped list), AC3 (keyboard affordances), AC7 (UI log-sniff) require the React component inside `ChatView`. Shipped: the domain seam so the UI is a thin consumer when it lands.
- **`mcp.resource.picker.open` / `mcp.resource.pick` / `mcp.resource.attach` events** belong to the UI layer (picker open, user pick, turn submission); these fire where the store is wired into `ChatView`. The read-side events (`mcp.resource.read.ok` / `.err`) are wired.
- **Retry affordance on failed chips**: the domain layer returns `{ok: false, error}`; the UI layer invokes retry by re-staging.

## Assumptions

- `readResource` on the transport is optional (servers may not implement it); the client returns a typed error instead of throwing.
- Staging is in-memory and discarded on clear / thread switch / plugin unload — matches the "next-message-only" scope.
- Content blocks are plain text per the picker's spec. Binary blobs are summarised as `<binary N bytes>` placeholders; UI can stream them to attachments later.

## Open questions

- **UI component**: parked; the domain surface is ready.
- **Attachment integration with F49**: resources appear alongside F49 image/file attachments if both fire — ordering TBD at UI time.
