# Compliance iteration 1 — F54 mcp-prompts-in-skills

## Acceptance criteria
- AC1 ("From MCP" section renders): PARKED at UI layer; `CompositeSkillSource` merges built-in + MCP.
- AC2 (adapter shape): PASS — `adaptPromptToSkill` produces `id=mcp.<serverId>.<promptName>`, `source='mcp'`, `mcpServerId`, empty `systemPrompt`, `resolved:false`.
- AC3 (selection triggers `getPrompt`, next-turn apply): PASS at the domain seam — `MCPClient.getPrompt` returns a typed result and `resolvePromptBody` + `McpPromptCache` stage the resolved body.
- AC4 (allowedTools / defaultModel pass-through via F22): PARKED at the F22 picker-wiring layer; adapter leaves the optional fields undefined so F22's existing fallback path applies.
- AC5 (disconnected-server fallback to general): PARKED at the F22 `SkillsStore.get(id)` resolver; `getPrompt` returns `{ok:false}` which the resolver can detect.
- AC6 (AbortSignal propagation): PASS via the signal-threaded `getPrompt` signature.
- AC7 (structured log events): PASS — `skill.mcp.resolve.ok` / `.err` wired.
- AC8 (Vitest coverage): PASS — 7 cases cover adapter, cache, composite source, getPrompt happy/unknown/unsupported/throw.

## Scope coverage
- In scope "MCPPromptSkillAdapter": PASS.
- In scope "CompositeSkillSource": PASS.
- In scope "`getPrompt` seam on MCPClient": PASS.
- In scope "Cache with server invalidation": PASS.
- In scope "Structured log events": PASS.
- In scope "F22 picker section render": PARKED.

## Out-of-scope audit
- Out of scope "MCP host / transports / discovery": CLEAN — reuses F51.
- Out of scope "SkillPicker component / HeaderBar badge / command palette": CLEAN — F22 territory.
- Out of scope "In-plugin skill editor": CLEAN — F39.
- Out of scope "MCP prompt arguments / parameterised prompts": CLEAN.
- Out of scope "Settings-tab MCP UI (F55)": CLEAN.
- Out of scope "MCP reconnect / crash (F56)": CLEAN.
- Out of scope "MCP tool confirmation (F52)": CLEAN.
- Out of scope "Autocompact skill-change interaction": CLEAN.

## QA aggregate
All 4 gates PASS (typecheck, lint, 965 / 965 tests across 93 files, build `main.js` ~254 KB unchanged). See `qa-1.md`.

## Verdict: PASS
