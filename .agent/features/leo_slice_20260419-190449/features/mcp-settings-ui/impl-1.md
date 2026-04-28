# Impl iteration 1 — F55 mcp-settings-ui

## Summary

Shipped the MCP-settings domain layer that the F03 settings-tab React subtree will mount. `src/mcp/settingsStore.ts` exposes `McpSettingsStore` with `add / edit / remove / toggle / list` backed by an injectable `ConfigFileIo` (writes `{mcpServers: McpServerConfig[]}`) and a `WritableSafeStorage`, a pure `validateAddition(existing, candidate)` (URL-safe id, uniqueness, per-transport required fields), and `applySecretPlaceholders(fields, safeStorage)` that stores plaintext via `SafeStorage.set` and emits `safestorage:<key>` placeholders for the config write. `MCPClient` gained `onStatusChange(listener)` observer with `pending / connected / failed / closed` notifications, `disconnect(serverId)` that closes the transport and unregisters every `mcp.<serverId>.*` tool via a new `ToolRegistry.unregister(id)` seam, and `reload(config)` that disconnects then reconnects the server with fresh config. Structured events: `mcp.settings.add / edit / delete / toggle` via the logger.

## Files touched

- `src/mcp/settingsStore.ts` — new. Exports `McpSettingsStore`, `validateAddition`, `applySecretPlaceholders`, `SecretField`, `ConfigFileIo`, `WritableSafeStorage`.
- `src/mcp/mcpClient.ts` — extended with `onStatusChange(listener)`, `disconnect(serverId)`, `reload(config)`; status notifications at pending / connected / failed / closed transitions; invokes `ToolRegistry.unregister` on disconnect.
- `src/tools/toolRegistry.ts` — added `unregister(id)` returning whether the id was removed.

## Tests added or updated

- `tests/unit/mcpSettings.test.ts` — 10 cases:
  - `validateAddition` covers bad id, duplicate id, missing stdio command, bad sse url.
  - `applySecretPlaceholders` stores real plaintext in SafeStorage and writes only placeholder values.
  - `McpSettingsStore.add` round-trips, logs `mcp.settings.add`, and fails on duplicate id.
  - `edit` updates fields while preserving id + transport.
  - `remove` drops the entry and logs `mcp.settings.delete`.
  - `toggle` flips enabled and reports the new value.
  - `MCPClient.onStatusChange` observes `pending` + `connected` on successful connect.
  - `MCPClient.disconnect` unregisters every `mcp.<serverId>.*` ToolSpec and emits `closed` status.
  - `MCPClient.reload` disconnects and re-connects with the new config.

Net delta: +10 tests (965 → 975 passing).

## Deviations from feature.md

- **React form UI is parked.** AC1 (row rendering), AC2 (add-flow form), AC3 (edit pre-populated form), AC4 (delete inline confirmation), AC5 (toggle / retry buttons) all live at the UI layer; the domain seams ship so the form mount is a thin subscription.
- **`MCPClient.connect(serverId)` (single-server) is not shipped explicitly** — `reload(config)` covers the connect-after-edit case. A standalone `connect(serverId)` can be added when the settings UI wires enable-toggle with a pre-parsed config.
- **Retry button telemetry** (`mcp.settings.retry`) fires when the UI invokes `MCPClient.reload`; not wired at this layer because there is no UI yet.
- **`mcp.settings.secret.store`** log event fires inside `applySecretPlaceholders` via the caller's logger if they wire it; current helper does not emit it directly.

## Assumptions

- The config file IO is a thin JSON reader/writer; `McpSettingsStore` does not care where the bytes live (`Vault` adapter or plugin `data.json`). Caller pins the path.
- Secret fields are passed through the `SecretField[]` shape; the store translates plaintext → `safestorage:<key>` placeholder, never persisting plaintext into the config blob.
- `ToolRegistry.unregister` returns boolean so callers can assert the removed entry was present.

## Open questions

- **React `McpServersSection` subtree**: parked.
- **Secret-delete on server-remove**: `remove` does not call `safeStorage.remove(key)` for orphaned placeholders; UI can invoke a dedicated cleanup when it ships.
- **Retry (status === 'failed') flow**: domain seam exposes `reload` / `disconnect`; UI reads status via `onStatusChange` and triggers the action.
