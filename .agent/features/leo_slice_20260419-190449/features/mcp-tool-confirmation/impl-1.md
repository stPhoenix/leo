# Impl iteration 1 — F52 mcp-tool-confirmation

## Summary

Confirmed the default `requiresConfirmation: true` flag on every F51-registered MCP `ToolSpec` (already set at registration time in `src/mcp/mcpClient.ts` during F51) and added a `mcp.tool.confirmation.default` debug log event emitted once per tool at registration with `{serverId, toolId, requiresConfirmation}` fields. No UI additions, no controller additions, no new persistence surface — F17's existing pre-invoke gate (pause → dialog → Allow once / Allow for thread / Deny, with thread-allowlist bypass) works byte-identically against `mcp.<serverId>.<toolName>` ids because `ToolRegistry.lookup(id).requiresConfirmation` is the only signal F17 reads. The namespaced id also makes cross-server isolation (F52 AC6) and cross-thread isolation (F52 AC2) inherent: different `serverId` → different registry key → different allowlist key.

## Files touched

- `src/mcp/mcpClient.ts` — added the `mcp.tool.confirmation.default` debug event after successful registration.

## Tests added or updated

- `tests/unit/mcpConfirmation.test.ts` — 4 cases covering AC1, AC6, AC8, and the deny-unknown-server branch:
  - **AC1** registration-time default: three fixture tools on one server all carry `requiresConfirmation === true` and `source === 'mcp'`.
  - **AC8** debug log emission: two fixture tools produce two `mcp.tool.confirmation.default` records with `{serverId, toolId, requiresConfirmation: true}`.
  - **AC6** cross-server namespace isolation: `mcp.a.read` and `mcp.b.read` are distinct registry entries with distinct ids.
  - **AC5** deny path on unknown server: `callTool('ghost', …)` returns `{ok: false, error: 'mcp server not connected: ghost'}` without throwing.

Net delta: +4 tests (947 → 951 passing).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **AC2/AC3/AC4/AC7 are covered by existing F17 tests against any `ToolSpec.requiresConfirmation: true`.** F17's pre-invoke gate, `thread.metadata.allowedTools` persistence, Allow once / Allow for thread branching, Deny path, and icon/label rendering are byte-identical regardless of whether the tool id is `read_note` or `mcp.serverId.toolName`. F52 verifies at registration + namespace seam, not by duplicating F17's integration suite.
- **No tests against `ConfirmationController` directly**: the confirmation controller is opaque to this feature; tests focus on the MCP registration boundary.

## Assumptions

- **Every MCP tool is individually gated** per Open question #1 — no "trust this server" bulk flip ships. The stale-entry policy is "leave inert"; `serverId` changes naturally miss the allowlist.
- **Schema-hash invalidation** (Open question §3): not implemented; re-registering a tool with a different JSON Schema but the same id re-uses the existing allowlist entry. If this becomes a safety concern, a schema-hash comparison can slot into `registerTool` without changing the default.
- **UI label** (Open question §2) is F17/F55's concern; the namespaced id is the allowlist key regardless of label.

## Open questions

- **Schema-hash invalidation**: deferred; simple to add via `crypto` / FNV on the `inputSchema` JSON.
- **Server-rename resilience**: relying on user-chosen `serverId` stability; when servers rename, the allowlist entries go inert which matches the SRS's "thread-scoped allowlist" intent.
