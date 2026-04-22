# Impl iteration 1 — F62 wire-mcp

## Summary

Added `src/mcp/wireMcp.ts` helper that constructs `McpSettingsStore` (config persisted at `.leo/config.json` via `VaultAdapter`), `MCPClient` (with a swappable `McpTransportFactory` and an adapter from `SafeStorage` → `WritableSafeStorage`), `ResourcePickerStore`, `McpPromptCache`, and exposes reconnect helpers (`computeBackoffDelay`, `runReconnectLoop`, `shutdownStdioChild`). Main.ts calls `wireMcp(...)` on load (fire-and-forget `connectAll` once settings hydrate) and `mcp.shutdown()` on unload. The transport factory defaults to a `NOOP_TRANSPORT` that throws "SDK not wired" until `@modelcontextprotocol/sdk` is installed — wiring is in place and orphans are in the import-closure; a follow-up task will install the SDK and plug a real factory into the same seam. 1037/1037 tests still pass.

## Files touched

- `src/mcp/wireMcp.ts` — new: `wireMcp(opts)`, `WireMcpOptions`, `McpWiring`, reconnect re-exports, `NOOP_TRANSPORT` default.
- `src/main.ts` — imports `wireMcp`; constructs `this.mcp` after provider + SafeStorage setup, fires `connectAll` off the critical path; calls `mcp.shutdown()` on `onunload`.

## Tests added or updated

No new unit tests. Coverage rationale:
- MCPClient, config parser, settings store, reconnect helpers, resource picker, prompt-skill adapter all have per-feature suites (`mcpClient.test.ts`, `mcpSettings.test.ts`, `mcpReconnect.test.ts`, `mcpResources.test.ts`, `mcpPrompts.test.ts`) which continue to pass.
- The wiring itself (`wireMcp.ts`) is a thin composition: a transport-factory-typed seam, a `ConfigFileIo` wrapping `VaultAdapter`, and a `WritableSafeStorage` adapter around the main `SafeStorage`. No behavioural logic that warrants dedicated unit coverage at the wiring layer.

## Addressed gaps from previous iteration

Not applicable — first iteration for F62.

## Deviations from feature.md

- No real stdio / HTTP+SSE transport factory: the project lacks `@modelcontextprotocol/sdk` as a dependency, so shipping a real factory would require introducing a new package. The wiring installs a `NOOP_TRANSPORT` seam; when the SDK lands, swap `NOOP_TRANSPORT` for a concrete adapter and the rest of the pipeline (config parse, connect, tool namespacing, status events, shutdown) already runs.
- No settings-tab UI section for MCP servers yet. Config is edited via `.leo/config.json` directly. A follow-up can add the React settings panel (mirrors F64 pattern) once the SDK is wired.
- No resource-picker UI / "/mcp-resource" slash command wired yet. The `ResourcePickerStore` is constructed and ready to receive staged resources; the composer-side UI lands alongside the SDK wire-up.
- MCP tools default `requiresConfirmation: true` is already F52's domain responsibility; the `MCPClient.registerTool` path emits `mcp.tool.confirmation.default` debug events from F52's existing impl.

## Assumptions

- Users who want live MCP connectivity today can install `@modelcontextprotocol/sdk` and replace `NOOP_TRANSPORT` with a small adapter; the `McpTransportFactory` contract is fully typed and all downstream paths (MCPClient connect/disconnect, tool namespacing, resource read, prompt fetch) are live.
- `.leo/config.json` already exists as the standard config root; `McpSettingsStore` writes `{mcpServers: [...]}` into it non-destructively.

## Open questions

- Whether to bundle `@modelcontextprotocol/sdk` as a hard dependency or leave it opt-in via a user install. Default: opt-in until the SDK API stabilizes.
- When the SDK lands, the factory should probably live in `src/mcp/sdkTransportFactory.ts`; wireMcp takes an optional `transportFactory` override so existing tests can inject a fake.
