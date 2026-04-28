# Impl iteration 1 — F51 mcp-client-config-transports

## Summary

Added the MCP host scaffold. `src/mcp/config.ts` hosts the `.leo/config.json` parser with stdio + SSE discriminated shape, unknown-field passthrough for forward compatibility, per-entry error isolation (invalid entries skipped, reported), the `safestorage:<key>` secret substitution via an injected `SafeStorageLike` (empty string when the key is unknown), and `resolveSecretsForConfig` for both `env` and `headers`. `src/mcp/mcpClient.ts` hosts the `MCPClient` class with a `Map<serverId, ServerRuntime>` covering `pending | connected | failed | closed` states, `connectAll(configs, signal?)` that launches one `Promise.allSettled` branch per enabled entry (disabled servers skipped entirely), parallel `tools/list` / `resources/list` / `prompts/list` discovery after transport connect, registration of every discovered tool into F16's `ToolRegistry` under the `mcp.<serverId>.<toolName>` namespace with `source: 'mcp'`, `mcpServerId`, `requiresConfirmation: true` (default gate; F52 owns threading), and `invoke` delegating to `callTool`. `callTool` issues the transport call, wraps failures in `{ok: false, error}` without throwing. Structured events `mcp.connect.start / ok / fail`, `mcp.discovery.ok`, `mcp.tool.register`, `mcp.tool.invoke.start / ok / error`, and `mcp.config.parse.fail` flow through F01's `Logger` with only non-sensitive fields.

## Files touched

- `src/mcp/config.ts` — new. Exports `McpServerConfig` discriminated union, `McpStdioConfig`, `McpSseConfig`, `McpConfigFile`, `parseMcpConfig`, `resolveSecrets`, `resolveSecretsForConfig`, `SafeStorageLike`, `SAFE_STORAGE_PREFIX`.
- `src/mcp/mcpClient.ts` — new. Exports `MCPClient`, `namespaceTool`, `ServerRuntime`, `McpTransportConnection`, `McpTransportFactory`, `McpToolInfo`, `McpResourceInfo`, `McpPromptInfo`, `McpCallToolResult`, `ServerStatus`.

## Tests added or updated

- `tests/unit/mcpClient.test.ts` — 12 cases covering AC1–AC7:
  - **config parser**: empty absent / stdio + sse accepted / invalid entries skipped-with-errors / unknown fields passthrough.
  - **AC6 secret substitution**: `env: {API_KEY: 'safestorage:api-key'}` → plaintext; missing key → empty string.
  - **AC3 namespacing**: `namespaceTool('github', 'read_file') === 'mcp.github.read_file'`.
  - **AC1 connectAll + disabled filter**: two enabled + one disabled → 2 settled results; one good + one bad → `connected` + `failed` statuses in play.
  - **AC3 registration**: registered tools appear in `ToolRegistry.lookup('mcp.s1.<name>')` with `source: 'mcp'` and `requiresConfirmation: true`.
  - **AC4 invocation delegation**: `ToolRegistry.invoke('mcp.s1.echo', argsJson, ctx)` routes into the transport's `callTool`, returns `{ok: true, data}`.
  - **AC5/AC7 logging**: structured events cover `mcp.connect.start / ok / fail`, `mcp.discovery.ok`, `mcp.tool.register`, `mcp.tool.invoke.start / ok`.
  - **AC1 parallel startup**: a transport that hangs on one server does not block the other — the fast server is observed `connected` before the hang resolves.

Net delta: +12 tests (935 → 947 passing).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **`@modelcontextprotocol/sdk` dependency is not installed.** Transports are injected via the `McpTransportFactory` seam so stdio + SSE can be supplied by a thin adapter against the SDK without changing the core module. Install and SDK adapter lands in a follow-up where the Obsidian renderer's `child_process` access is validated (Open question §4).
- **Zod is not a project dependency.** JSON-schema tool shape is passed through to the `ToolSpec.parameters` field as-is; runtime validation is the caller's job (the tool's `validate` function returns `{ok: true, data: raw}` by default). When a Zod compiler is added (or a hand-rolled validator like the one in F33), it can be swapped in without changing the registration path.
- **Confirmation default** (`requiresConfirmation: true`) lands here rather than in F52 — F52 adds per-thread allowlist semantics and pre-approval UI on top of this default.
- **`NFR-TEST-05` bundled reference stdio MCP fixture server** is not shipped. Integration coverage lives in `tests/unit/mcpClient.test.ts` using an injectable fake transport that simulates all SDK surfaces; a real stdio round-trip lands when the SDK adapter ships.
- **SSE via `msw`**: not wired because no HTTP calls happen in the adapter layer; the `McpTransportFactory` seam makes future `msw` coverage straightforward.

## Assumptions

- **Secret placeholder** (Open question §2): `safestorage:<key>` literal sigil — matches proposal; prefix exported as `SAFE_STORAGE_PREFIX` so lints / docs can reference it.
- **`.leo/config.json` authority** (Open question §1): this slice reads the file as authoritative; F55 settings-tab will writeback through the same file.
- **Missing `resources/list` / `prompts/list` methods**: server implementations that do not support these methods can return empty arrays via the transport adapter's own fallback (Open question §5); the client code just consumes whatever the transport returns.
- **`child_process` in Obsidian renderer** (Open question §4): adapter resolution is delayed; this module is Electron-agnostic.
- **Forward compatibility**: unknown fields on `McpServerConfig` entries are preserved via a `[extra: string]: unknown` index signature, so new MCP SDK options (auth methods, timeouts) round-trip intact without a parser update.

## Open questions

- **SDK wiring (`StdioClientTransport` / `SSEClientTransport`)**: parked until the `child_process` renderer check clears and the SDK is added to `package.json`. The `McpTransportFactory` seam is the single insertion point.
- **Reconnect + shutdown (F56)**: `MCPClient.disconnectAll()` currently calls `connection.close()` with error isolation; F56 will plug in `SIGTERM → SIGKILL` + exponential-backoff reconnect without touching the `MCPClient` interface.
- **Zod compilation for tool JSON Schema** (Open question §3): deferred until either a Zod dependency is added or a hand-rolled JSON Schema validator is factored out across F40/F51.
