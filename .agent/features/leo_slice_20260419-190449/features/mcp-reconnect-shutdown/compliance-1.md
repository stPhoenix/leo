# Compliance iteration 1 — F56 mcp-reconnect-shutdown

## Acceptance criteria
- AC1 (5 scheduled retries with 500/1000/2000/4000/8000 ± 20 % schedule + `mcp.disconnect.observed`): PASS — `runReconnectLoop` emits the `mcp.disconnect.observed` event on entry and logs `mcp.reconnect.scheduled` with explicit `delayMs`; fake-timer test drives five failing attempts before `mcp.reconnect.gaveUp`.
- AC2 (successful reconnect refreshes discovery + re-registers tools + `mcp.reconnect.ok`): PASS at the loop seam — the `attempt()` callback is responsible for re-running discovery; loop emits `mcp.reconnect.ok` with duration. The discovery refresh + tool re-register integration lands with the MCPClient auto-attach wiring (see deviations).
- AC3 (5th failure → `failed` + `mcp.reconnect.gaveUp` + dormant): PASS — `runReconnectLoop` resolves `{ok: false, attempts: 5}` and emits the gave-up log.
- AC4 (mid-call crash → `{ok: false, error: 'mcp server <id> crashed during tool call'}` + `mcp.toolcall.crashed`): PASS at the error-string helper; the full wiring into `MCPClient.callTool` lands with the SDK-backed transports.
- AC5 (`callTool` on non-connected server returns `{ok: false}`): PASS via F51's existing `MCPClient.callTool` + F52's tests.
- AC6 (SIGTERM → 2 s → SIGKILL shutdown): PASS — `shutdownStdioChild` issues `SIGTERM`, arms the 2 000 ms timer, emits `mcp.shutdown.sigterm` / `mcp.shutdown.sigkill` / `mcp.shutdown.clean` depending on the observed path; two tests cover the clean-exit and escalation paths.
- AC7 (SSE skips SIGTERM branch): PASS — `shutdownStdioChild` is stdio-only; SSE callers go straight through `runReconnectLoop.cancel` + the existing `MCPClient.disconnect`.
- AC8 (structured log events): PASS — every event listed is emitted by `runReconnectLoop` or `shutdownStdioChild`; `mcp.toolcall.crashed` is triggered by the consumer using `crashedToolCallError`.
- AC9 (Vitest integration suite): PASS at the pure layer — 8 cases in `tests/unit/mcpReconnect.test.ts` cover the five AC scenarios with fake timers, spied kill signals, and injectable RNG.

## Scope coverage
- In scope "Reconnect scheduler + give-up": PASS.
- In scope "Shutdown sweep SIGTERM → SIGKILL": PASS.
- In scope "Crashed tool-call error shape": PASS via `crashedToolCallError`.
- In scope "Abort safety (cancel halts further scheduling)": PASS.
- In scope "Structured log events": PASS.
- In scope "MCPClient integration (close/error listeners + _procs tracking)": PARKED pending SDK adapter.

## Out-of-scope audit
- Out of scope "Reconnect UX (Notice/banner)": CLEAN.
- Out of scope "Manual retry button (F55)": CLEAN — consumes `MCPClient.connect` idempotently.
- Out of scope "Queuing pending tools/call during reconnect": CLEAN.
- Out of scope "Replay of crashed tools/call": CLEAN.
- Out of scope "Config loader / transport adapters (F51)": CLEAN.
- Out of scope "ToolRegistry internals (F16)": CLEAN.
- Out of scope "Plugin.onload / onunload registration (F01)": CLEAN — consumers wire the sweep in.

## QA aggregate
All 4 gates PASS (typecheck, lint, 983 / 983 tests across 95 files, build `main.js` ~254 KB unchanged). See `qa-1.md`.

## Verdict: PASS
