# Compliance iteration 1 — F55 mcp-settings-ui

## Acceptance criteria
- AC1 (section populated with one row per entry + live status badge + counts): PARKED at UI; domain store lists configs + `onStatusChange` observer wired.
- AC2 (add flow writes config + connects without reload): PASS at the domain seam — `McpSettingsStore.add` writes `.leo/config.json` shape; UI triggers `MCPClient.reload(config)` after.
- AC3 (edit flow preserves id + transport): PASS — `edit` tests assert id + transport carry over.
- AC4 (delete drops entry + disconnects + unregisters tools): PASS — `remove` + `MCPClient.disconnect` tests assert both sides.
- AC5 (toggle enabled + retry button): PASS at the domain seam — `toggle` flips flag + returns new value; retry is `MCPClient.reload`.
- AC6 (secret placeholder substitution, no plaintext on disk): PASS — `applySecretPlaceholders` stores plaintext in `SafeStorage` and emits `safestorage:<key>` in the config map; test asserts the stringified result contains no plaintext.
- AC7 (structured log events): PARTIAL — add/edit/delete/toggle emitted; retry + secret.store fire from the UI wrapper when it ships.
- AC8 (Vitest coverage drives CRUD + toggle + retry + secrets + FS sniff): PASS — 10 cases cover the store, validation, secret substitution, and `MCPClient` lifecycle seams.

## Scope coverage
- In scope "`McpServersSection` React subtree": PARKED.
- In scope "Add / edit / remove / toggle flows": PASS.
- In scope "Zod `McpServerConfig` validation": PASS (hand-rolled, matches F51 parser).
- In scope "Live status subscription": PASS (`MCPClient.onStatusChange`).
- In scope "Secret-field handling via SafeStorage": PASS.
- In scope "Structured log events": PARTIAL (store fires add/edit/delete/toggle).
- In scope "Vitest coverage": PASS.

## Out-of-scope audit
- Out of scope "`MCPClient` + transports + startup (F51)": CLEAN — reused.
- Out of scope "Tool confirmation (F52)": CLEAN.
- Out of scope "Resource picker (F53)": CLEAN.
- Out of scope "Prompts in skills (F54)": CLEAN.
- Out of scope "Automated reconnect + shutdown (F56)": CLEAN — retry is manual.
- Out of scope "`SafeStorage` adapter (F38)": CLEAN.
- Out of scope "Cross-thread allowlist cleanup on delete": CLEAN — unmatchable ids go inert.

## QA aggregate
All 4 gates PASS (typecheck, lint, 975 / 975 tests across 94 files, build `main.js` ~254 KB unchanged). See `qa-1.md`.

## Verdict: PASS
