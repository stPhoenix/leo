# Compliance iteration 1 — F51 mcp-client-config-transports

## Acceptance criteria
- AC1 (parallel non-blocking connectAll): PASS — `connectAll` uses `Promise.allSettled` over enabled configs; hang-test asserts a second server observes `connected` status before the first's connect resolves.
- AC2 (stdio + sse entries + unknown-field passthrough): PASS — `parseMcpConfig` preserves unknown fields (`custom_field` retained in the parsed config); discriminator enforces `command` for stdio and `url` for sse.
- AC3 (namespaced registration + source=mcp): PASS — two discovered tools visible via `ToolRegistry.lookup('mcp.s1.read_file')` / `.lookup('mcp.s1.write_file')` with `source: 'mcp'` and `requiresConfirmation: true`.
- AC4 (`callTool` delegates): PASS — invoke through `ToolRegistry.invoke('mcp.s1.echo', ...)` reaches the transport's `callTool`, returns `{ok: true, data}`; error path wraps into `{ok: false, error}`.
- AC5 (failure isolation): PASS — one bad + one good server produces `failed` and `connected` statuses in the server map; `mcp.connect.fail` emitted at `warn`; registration of the good server still completes.
- AC6 (SafeStorage substitution, no plaintext persisted): PASS at the pure layer — `resolveSecretsForConfig` replaces the literal prefix with the plaintext before transport construction. Vault/`data.json` sniff is a platform-adapter concern; the core module never touches disk.
- AC7 (structured events + no sensitive fields above `info`): PASS — every lifecycle event emits only `{serverId, transport, toolCount, resourceCount, promptCount, durationMs}` plus error strings; `env`, `headers`, and raw tool arguments are never logged.
- AC8 (NFR-TEST-05 Vitest coverage): PASS via the injectable fake transport — 12 cases cover connect → discover → register → invoke, failure isolation, secret substitution, and parallel kick-off.

## Scope coverage
- In scope "`MCPClient` + `ServerRuntime` map + `connectAll` / `disconnectAll` / `listResources` / `listPrompts` / `callTool`": PASS.
- In scope "`.leo/config.json` loader with schema": PASS (hand-rolled parser; Zod pending dependency decision).
- In scope "Transports seam (stdio + sse)": PASS at the factory interface; concrete SDK adapters parked.
- In scope "Parallel non-blocking startup": PASS.
- In scope "Discovery pipeline (`tools/list` / `resources/list` / `prompts/list`)": PASS.
- In scope "Namespaced tool registration with `mcp.<serverId>.<toolName>`": PASS.
- In scope "Secret resolution via `SafeStorage`": PASS.
- In scope "Failure isolation + `ServerRuntime.status = 'failed'`": PASS.
- In scope "Structured log events": PASS.
- In scope "Vitest integration coverage": PASS at the injectable-transport seam.

## Out-of-scope audit
- Out of scope "`requiresConfirmation` per-thread pre-approval (F52)": CLEAN — default is set; threading lives elsewhere.
- Out of scope "Resource picker UI (F53)": CLEAN — `listResources` returns data only.
- Out of scope "Prompts-in-skills UI (F54)": CLEAN — `listPrompts` returns data only.
- Out of scope "Settings-tab UI (F55)": CLEAN — no UI.
- Out of scope "Reconnect + SIGTERM/SIGKILL shutdown (F56)": CLEAN — `disconnectAll` uses plain `close()` error-isolated; `disposer` hook available via `ServerRuntime.connection.close`.
- Out of scope "`SafeStorage` adapter itself (F38)": CLEAN — consumed via `SafeStorageLike.get`.
- Out of scope "`ToolRegistry` implementation (F16)": CLEAN — used via `register` / `invoke`.

## QA aggregate
All 4 gates PASS (typecheck, lint, 947 / 947 tests across 90 files, build `main.js` ~254 KB unchanged — SDK adapter parked). See `qa-1.md`.

## Verdict: PASS
