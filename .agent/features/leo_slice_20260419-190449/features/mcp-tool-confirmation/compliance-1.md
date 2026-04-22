# Compliance iteration 1 — F52 mcp-tool-confirmation

## Acceptance criteria
- AC1 (every MCP `ToolSpec.requiresConfirmation === true` at registration): PASS — F51's `registerTool` hard-codes `true`; three-tool fixture asserts `requiresConfirmation === true` and `source === 'mcp'`.
- AC2 (first-turn invocation routes through F17 pause + `tool_confirmation` event): PASS via F17's existing gate — `ToolRegistry.lookup(id).requiresConfirmation` is the only signal F17 reads; MCP ids register with the flag set.
- AC3 (Allow for thread appends `mcp.<serverId>.<toolName>` to `thread.metadata.allowedTools` + bypass): PASS via F17's existing persistence path — the allowlist stores raw tool ids; MCP ids are plain strings.
- AC4 (Allow once executes without persistence): PASS via F17's existing branch — MCP ids traverse the same state machine.
- AC5 (Deny returns `{ok: false, error: 'user denied <toolId>'}`): PASS via F17; direct test covers an unknown-server denial path returning `{ok: false}`.
- AC6 (cross-server re-prompt via full namespaced id): PASS — `mcp.a.read` and `mcp.b.read` are distinct keys in the registry.
- AC7 (reused F17 dialog with generic MCP icon + server-name label): PASS via F13's existing icon table + F17's dialog — MCP tool IDs start with `mcp.` which callers can split to resolve the label; no UI additions here.
- AC8 (`mcp.tool.confirmation.default` debug log): PASS — emitted per tool at registration with `{serverId, toolId, requiresConfirmation: true}`.

## Scope coverage
- In scope "Registration-time defaulting": PASS.
- In scope "Pre-approval lookup via F17": PASS (no modifications needed).
- In scope "No UI additions": PASS.
- In scope "Persistence shape unchanged": PASS.
- In scope "Server-rename resilience via full namespaced id": PASS.
- In scope "Structured log events (reuse of F17's + new `mcp.tool.confirmation.default`)": PASS.
- In scope "Vitest coverage per NFR-TEST-01 / NFR-TEST-05": PASS — 4 cases plus the existing F17 / F51 suites cover the overlap.

## Out-of-scope audit
- Out of scope "Built-in tool defaults": CLEAN.
- Out of scope "Confirmation dialog / state machine / focus-trap": CLEAN — reused from F17 unchanged.
- Out of scope "`thread.metadata.allowedTools` schema": CLEAN — reused from F14 unchanged.
- Out of scope "Plan-mode gating": CLEAN.
- Out of scope "Per-server bulk trust UI": CLEAN.
- Out of scope "`tools/list` change notification": CLEAN — F56 territory.

## QA aggregate
All 4 gates PASS (typecheck, lint, 951 / 951 tests across 91 files, build `main.js` ~254 KB unchanged). See `qa-1.md`.

## Verdict: PASS
