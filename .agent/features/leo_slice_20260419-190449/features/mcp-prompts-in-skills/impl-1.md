# Impl iteration 1 — F54 mcp-prompts-in-skills

## Summary

Added `MCPClient.getPrompt(serverId, promptName, args?, signal?)` (wrapping the optional transport `getPrompt` hook with `skill.mcp.resolve.ok` / `skill.mcp.resolve.err` structured events) and `src/mcp/promptSkillAdapter.ts` which exports `adaptPromptToSkill(envelope)` that maps an MCP `Prompt` descriptor into the `Skill` shape with `id = mcp.<serverId>.<promptName>`, `source: 'mcp'`, `mcpServerId`, an empty deferred `systemPrompt`, and `resolved: false`; `resolvePromptBody(content)` concatenates the `description` + ordered `messages[role, content]` tuple into a single system prompt string; `McpPromptCache` keys in-memory bodies by `serverId|promptName` with a `invalidateServer` hook; `CompositeSkillSource` merges an existing `SkillCatalog` with an `McpSkillSource` so F22's picker sees MCP prompts alongside file-backed skills.

## Files touched

- `src/mcp/mcpClient.ts` — extended `McpTransportConnection` with optional `getPrompt(name, args, signal)`, added `McpPromptContent` / `McpPromptMessage` types, and `MCPClient.getPrompt(serverId, promptName, args?, signal?)` with typed `{ok: true, data} | {ok: false, error}` return.
- `src/mcp/promptSkillAdapter.ts` — new. Exports `adaptPromptToSkill`, `resolvePromptBody`, `McpPromptCache`, `CompositeSkillSource`, `McpPromptEnvelope`, `McpPromptSkill`, `SkillCatalog`, `McpSkillSource`.

## Tests added or updated

- `tests/unit/mcpPrompts.test.ts` — 7 cases:
  - **AC2** adapter shape.
  - **AC3** `resolvePromptBody` concatenation order.
  - **cache** put/get/invalidate/clear.
  - **AC1** `CompositeSkillSource` merging order.
  - **AC3/AC6/AC7** `getPrompt` happy path + `skill.mcp.resolve.ok` log.
  - **AC5/AC6** `getPrompt` returns `{ok:false}` on unknown server + unsupported transport.
  - **AC6/AC7** thrown error propagates as `{ok:false, error}` + `skill.mcp.resolve.err` log.

Net delta: +7 tests (958 → 965 passing).

## Deviations from feature.md

- **React UI for F22 picker "From MCP" section is parked.** ACs 1/4/5/6 that involve the picker component or ConversationStore wiring are covered at the domain seams (adapter + getPrompt + cache + composite source); UI mount lands with the F22 follow-up.
- **`prompts/list_changed` invalidation** is exposed via `McpPromptCache.invalidateServer(serverId)`; the subscription to the change event will live in the wiring layer when F56 adds reconnect + `list_changed` handling.
- **Parameterised prompts (`arguments`)** are deferred per feature Open questions; `getPrompt` accepts an optional `args` object that passes straight through.

## Assumptions

- `Skill.mcpServerId` and `resolved` fields extend the existing `Skill` contract via structural typing; callers that ignore them see a normal `Skill`.
- The default `description` → `messages[].content` concatenation order matches the common MCP prompt convention (system → user → assistant); adapter callers can override by transforming `McpPromptContent` before `resolvePromptBody` if needed.

## Open questions

- **F22 picker UI wiring**: parked. The `CompositeSkillSource` is ready to plug in.
- **`prompts/list_changed` subscription**: lands with F56.
