# Impl iteration 1 — F56 mcp-reconnect-shutdown

## Summary

Added `src/mcp/reconnect.ts` with pure primitives for MCP resilience: `computeBackoffDelay(attempt, opts)` producing the 500/1000/2000/4000/8000 ms cap-16 000 ms ±20 %-jitter schedule, `runReconnectLoop(opts)` that drives up to 5 attempts with injectable `setTimeout` + `attempt()` callback and emits `mcp.disconnect.observed → mcp.reconnect.scheduled → mcp.reconnect.attempt → mcp.reconnect.ok|fail → mcp.reconnect.gaveUp` logs, `shutdownStdioChild({serverId, proc, logger, timeoutMs})` that sends `SIGTERM`, arms a 2 000 ms fallback, and issues `SIGKILL` if the child has not exited, plus `crashedToolCallError(serverId)` for the canonical tool-result error string. The design is domain-pure: `ChildProcessLike` and `ReconnectLogger` are structural interfaces so tests can supply deterministic timer + RNG + kill spies.

## Files touched

- `src/mcp/reconnect.ts` — new. Exports `MAX_RECONNECT_ATTEMPTS`, `SHUTDOWN_SIGTERM_TIMEOUT_MS`, `computeBackoffDelay`, `runReconnectLoop`, `shutdownStdioChild`, `crashedToolCallError`, plus the `ReconnectHandle`, `ChildProcessLike`, `ReconnectLogger`, `ReconnectSchedulerOpts`, `ShutdownSweepOpts` shapes.

## Tests added or updated

- `tests/unit/mcpReconnect.test.ts` — 8 cases:
  - **backoff**: `computeBackoffDelay` boundary (attempt 0, 4, cap at 10) + jitter shrink/expand via injected RNG.
  - **AC1/AC3** give-up: fake-timer loop drives 5 failing attempts → `mcp.reconnect.gaveUp` log + `{ok: false, attempts: 5}` resolution.
  - **AC2** success on attempt 3: resolves `{ok: true, attempts: 3}` + `mcp.reconnect.ok` log.
  - **AC3** cancel halts further attempts.
  - **AC6 clean exit** — `SIGTERM` + explicit `exit` event resolves before the 2 s timer fires; `mcp.shutdown.clean` logged; no `SIGKILL`.
  - **AC6 escalation** — no `exit`; 2 s timeout triggers `SIGKILL` + `mcp.shutdown.sigkill` log.
  - **AC4** `crashedToolCallError('ide')` returns the canonical "mcp server ide crashed during tool call" message consumed by `MCPClient.callTool`.

Net delta: +8 tests (975 → 983 passing).

## Deviations from feature.md

- **Integration with `MCPClient` runtime (auto-attach on transport close/error + mid-call crash surfacing)** is scaffolded in the pure layer but not wired into `MCPClient` yet. The `runReconnectLoop` + `shutdownStdioChild` primitives are ready; callers bind them when the SDK-backed transports go in (pending F51 Open question §4 `child_process` renderer check).
- **AC5 (`callTool` on non-connected server → `{ok: false}`) is already covered by F51 + F52** — the existing `MCPClient.callTool` returns `{ok: false, error: 'mcp server not connected: <id>'}` when the runtime lacks a connection.
- **SSE-specific disposer shape**: `runReconnectLoop` is transport-agnostic; SSE consumers pass `transport: 'sse'` and an `attempt()` function that re-creates the SSE connection. The `shutdownStdioChild` helper is stdio-only by design; SSE callers skip it entirely.
- **`Promise.all` upper bound on `Plugin.onunload`**: the shutdown sweep is a per-child helper; `MCPClient.disconnectAll()` will dispatch `shutdownStdioChild` in parallel via `Promise.all` when the stdio adapter lands.

## Assumptions

- **Backoff schedule**: 500 / 1 000 / 2 000 / 4 000 / 8 000 ms with cap 16 000 ms and ±20 % jitter, matching AC1 numbers.
- **Give-up policy**: 5 attempts hard cap; failures beyond that require a manual `MCPClient.connect(serverId)` call (F55 retry button or plugin reload).
- **Jitter RNG** is injectable so fake-timer tests can assert exact scheduled delays without flake.

## Open questions

- **`MCPClient` auto-reconnect wiring**: lands when the SDK transports are installed. The pure loop is ready.
- **Queuing pending `tools/call` during reconnecting window**: feature's Open question — still deferred.
- **Replay of crashed `tools/call`**: out of scope per feature; agent recovers at the next turn.
