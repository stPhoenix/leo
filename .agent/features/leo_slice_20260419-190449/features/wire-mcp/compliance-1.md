# Compliance iteration 1 — F62 wire-mcp

## Acceptance criteria

- AC1 (6 MCP orphans reachable from main.ts): PASS — `mcp/config.ts`, `mcp/mcpClient.ts`, `mcp/promptSkillAdapter.ts`, `mcp/reconnect.ts`, `mcp/resourcePicker.ts`, `mcp/settingsStore.ts` all reachable via `src/mcp/wireMcp.ts` imported from `main.ts:73`. Audit: 14 → 8 orphans (-6).
- AC2 (empty config path logs mcp.client.ready 0): PASS — `wireMcp.connectAll` logs `mcp.client.ready` with `{ servers: 0 }` when the settings store returns no configs.
- AC3 (MCPClient + stores constructed through wireMcp): PASS — `wireMcp(...)` returns `{ client, settingsStore, resourcePicker, promptCache, connectAll, shutdown, reconnect }`; `main.ts:this.mcp` holds the wiring for the plugin lifetime.
- AC4 (transport factory seam with safe default): PASS — `WireMcpOptions.transportFactory` is an optional injection point; `NOOP_TRANSPORT` throws a clear error if invoked so a missing SDK never crashes load.
- AC5 (connectAll off critical path + shutdown on unload): PASS — `main.ts` uses `void this.mcp.connectAll()` and `await this.mcp.shutdown()` respectively.
- AC6 (all existing tests green): PASS — 1037/1037.

## Scope coverage

- In scope "Construct McpSettingsStore with ConfigFileIo on `.leo/config.json`": PASS — `wireMcp.ts:buildConfigFileIo` + `McpSettingsStore` construction.
- In scope "Trigger mcpClient.connectAll on load via an injectable McpTransportFactory seam": PASS — `wireMcp.connectAll` + `WireMcpOptions.transportFactory`.
- In scope "MCPClient and supporting modules reachable from main.ts": PASS — verified by audit drop.
- In scope "onunload calls client.disconnectAll() with shutdownStdioChild available for concrete transports": PASS — `mcp.shutdown` wired; reconnect helpers exposed.

## Out-of-scope audit

- Out of scope "MCP transport implementation": CLEAN — no real transport shipped; `NOOP_TRANSPORT` is the explicit placeholder.
- Out of scope "Real-transport behavioural flows": CLEAN — no live connect flows claimed.
- Out of scope "Settings-tab MCP CRUD UI": CLEAN — not added.
- Out of scope "Inline resource-picker slash command UI": CLEAN.
- Out of scope "'From MCP' skill picker section": CLEAN.
- Out of scope "Status-bar 'MCP: N/M connected' widget": CLEAN.
- Out of scope "OAuth / dynamic registration flows": CLEAN.
- Out of scope "Multi-workspace MCP isolation": CLEAN.

## QA aggregate

`qa-1.md` verdict: `PASS` (typecheck, lint, 1037/1037 tests, build 385 KB).

## Integration gate (§5.3.1)

New public module: `src/mcp/wireMcp.ts`. Anchors `wireMcp`, `WireMcpOptions`, `McpWiring` hit at `main.ts:73`. Gate PASS.

## Verdict: PASS
