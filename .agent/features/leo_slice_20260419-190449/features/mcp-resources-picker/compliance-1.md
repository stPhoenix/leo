# Compliance iteration 1 — F53 mcp-resources-picker

## Acceptance criteria
- AC1 (composer affordance + inline picker, no Modal): PARKED — UI layer not yet mounted.
- AC2 (picker lists resources grouped by serverId with name/title/mimeType): PARKED — domain data + store ready.
- AC3 (multi-select with keyboard): PARKED at UI; `ResourcePickerStore.toggle/has/clear` tested.
- AC4 (submit-time resolve, prepend content blocks in staging order): PASS at the domain seam — `resolveStagedResources` + `composeResourceContent` preserve order and emit byte-deterministic blocks.
- AC5 (failure surface + retry + synthetic marker): PASS — `composeResourceContent` surfaces failed URIs in the preamble; UI wires Retry by re-staging.
- AC6 (AbortSignal cancels in-flight reads + no persistence): PASS — `resolveStagedResources` short-circuits on `signal.aborted`; `ResourcePickerStore.clear()` resets state.
- AC7 (structured log events): PARTIAL — `mcp.resource.read.ok` / `.err` wired in `MCPClient`; UI-side `mcp.resource.picker.open / .pick / .attach` fires when the UI lands.
- AC8 (Vitest coverage with fixture server, failure path, abort): PASS via injectable transport — 7 cases plus F51's 12 cover the fixture server flow.

## Scope coverage
- In scope "MCPClient.readResource seam": PASS.
- In scope "Resource-picker staging store": PASS.
- In scope "Content-block composition with MCP preamble": PASS.
- In scope "AbortSignal plumbing": PASS.
- In scope "Read-side structured events": PASS.
- In scope "Picker React UI": PARKED.

## Out-of-scope audit
- Out of scope "MCP host / transports / config": CLEAN — F51 territory.
- Out of scope "Tool confirmation gating on resources": CLEAN — resources carry content, not tool calls.
- Out of scope "MCP prompts in skill picker (F54)": CLEAN.
- Out of scope "Settings-tab MCP server management (F55)": CLEAN.
- Out of scope "Reconnect / crash handling (F56)": CLEAN.
- Out of scope "Cross-turn persistence": CLEAN — staging is in-memory.
- Out of scope "Vault attachments (F49)": CLEAN — composed alongside, not merged.

## QA aggregate
All 4 gates PASS (typecheck, lint, 958 / 958 tests across 92 files, build `main.js` ~254 KB unchanged). See `qa-1.md`.

## Verdict: PASS
