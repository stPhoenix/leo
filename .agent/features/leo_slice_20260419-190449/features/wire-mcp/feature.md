# F62 — Wire MCP subsystem

## Purpose

Close the integration gap left by F51–F56. The MCP client (`mcpClient`), config parser (`config`), reconnect helper (`reconnect`), resource picker store (`resourcePicker`), prompt-to-skill adapter (`promptSkillAdapter`), and settings store (`settingsStore`) all ship as domain modules but are not constructed or invoked from `main.ts`. This feature wires the full MCP vertical: parse config on load, spawn stdio and/or connect HTTP+SSE transports in parallel, register namespaced tools on the `ToolRegistry` (`mcp.<server>.<tool>`), expose resources via an inline resource-picker in `ChatView`, expose prompts in the skill picker, auto-reconnect with exponential backoff, clean shutdown on `onunload`.

## Scope

### In scope

- Construct `McpSettingsStore` with a `ConfigFileIo` backed by the existing `VaultAdapter`, persisting to `.leo/config.json` `mcpServers`; cloud secrets loaded via `SafeStorage` (F61).
- On `onload`, after settings hydrate, trigger `mcpClient.connectAll(configs)` using an injectable `McpTransportFactory` seam. Non-blocking: connection work runs in the background; `onload` does not await.
- `MCPClient` and supporting modules (`resourcePicker`, `promptSkillAdapter`, `reconnect`) are constructed and reachable from `main.ts`, so a concrete transport factory implementation can plug in without further wiring changes.
- On `onunload`, call `client.disconnectAll()` which runs each server's `close()` path; `shutdownStdioChild` + reconnect helpers are available for use by concrete transports.

### Out of scope

- Writing a new MCP transport implementation (requires `@modelcontextprotocol/sdk` which is not bundled with this slice).
- Real-transport behavioural flows (namespaced tool registration, live reconnect, live SIGTERM/SIGKILL shutdown) — these depend on a concrete `McpTransportFactory`.
- Settings-tab MCP CRUD UI — owned by a downstream feature slice that ships after the SDK lands.
- Inline resource-picker slash command UI.
- "From MCP" section in the skill picker.
- Status-bar "MCP: N/M connected" widget.
- OAuth / dynamic registration flows not in the SDK.
- Multi-workspace MCP isolation.

## Acceptance criteria

1. All six MCP orphans (`mcp/config.ts`, `mcp/mcpClient.ts`, `mcp/promptSkillAdapter.ts`, `mcp/reconnect.ts`, `mcp/resourcePicker.ts`, `mcp/settingsStore.ts`) become reachable from `src/main.ts`; §5.4 audit removes them.
2. Starting the plugin with an empty `.leo/config.json` succeeds and emits `mcp.client.ready` with `{ servers: 0 }`.
3. `MCPClient`, `McpSettingsStore`, `ResourcePickerStore`, `McpPromptCache`, and the reconnect helpers are constructed through `wireMcp(...)` and handed to `main.ts` ready for a transport-factory plug-in.
4. `MCPClient` accepts an injected `McpTransportFactory`; the wiring defaults to a safe `NOOP_TRANSPORT` that throws a clear error if invoked, so missing SDK does not crash load.
5. `onload` calls `mcp.connectAll()` off the critical path (fire-and-forget); `onunload` calls `mcp.shutdown()` which runs `client.disconnectAll()`.
6. All existing tests stay green.

## Dependencies

F16 (tool registry) · F17 (confirmation flow) · F22 (skill picker — receives "From MCP" section) · F38 (SafeStorage for secrets — lands in F61) · F51–F56 (MCP domain). `F61` must complete first for `SafeStorage` wiring to be live; runs after F61.

## Implementation notes

- [Architecture §3.4 Adapters — MCP](../../../../architecture/architecture.md#34-adapters) — `mcpClient` owns discovery + registration; domain stays in `src/mcp/*`.
- [Architecture §5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup) — connection work runs in parallel with other adapters; do not block load.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — shutdown sequence SIGTERM → SIGKILL-after-2s, plus tool registry cleanup.
- [Tech stack — MCP SDK](../../../../standards/tech-stack.md) — `@modelcontextprotocol/sdk` is the transport source; adapt via the existing `McpTransportFactory` seam in `mcpClient.ts`.
- F51 compliance-1 calls out "SDK adapter wiring parked behind the McpTransportFactory seam pending child_process renderer check"; this feature resolves that by importing the SDK's node-stdio + HTTP transports inside a renderer-compatible adapter (they ship as ESM and work under Electron renderer).
- F52 `mcp.tool.confirmation.default` debug event must fire for every MCP tool registration.
- F54 prompt skills must flow through `CompositeSkillSource` so `SkillsStore` remains the single source of local skills.
- F56 reconnect loop + shutdown helpers are used verbatim.

## Open questions

- Should the MCP "From MCP" skill section appear only when at least one MCP server is connected, or always (showing "no MCP prompts yet")? Default: show when ≥1 connected.
- Secret substitution: env-var lookup happens at load time or connect time? Default: load time via the existing `SecretField` resolver in `mcp/settingsStore.ts`.
