# UI / Runtime Wiring Gap Report

Audit date: 2026-04-22
Source: `src/main.ts`, `src/ui/chatView.tsx`, `src/ui/chat/*`, `src/settings/SettingsTab.ts`, `src/agent/agentRunner.ts`
Feature workspace: `.agent/features/leo_slice_20260419-190449/`

## Wired (confirmed)

- F01–F17 core: logger, RotatingFileSink, LMStudioProvider, ProviderManager, EmbeddingClient, SettingsStore, SettingsTab, first-run wizard, ChatView register + ribbon + onLayoutReady auto-open, ChatMessageStore, streamStarter, EditorBridge + FocusedContextChannel + WorkspaceFocusProbe, AgentRunner, ConversationStore, read/write/folder tools, ConfirmationController
- F18 AcceptRejectController (F20 `editNoteTool` registered, but `EditNoteBridge.isActiveNote: () => false` → CM6 active-note adapter still stub at `main.ts:148-151`)
- F21 SkillsStore + `loadAll()`
- F22 `SkillPickerSource` built + passed to ChatView (palette entry missing — see gaps)
- F23/F24 TodoStore + PlanModeController (`enter/exit` prop)
- F41 tokenEstimator (used in `analyzeContextForChat`)
- F42 microcompact (`agentRunner.ts:153-157,532`, via `AgentRunner.microcompact` options)
- F46 `analyzeContextUsage` — wired, **but counters stubbed**: `countSystemTokens / countMemoryFileTokens / countMcpToolTokens / countCustomAgentTokens / countSlashCommandTokens / countSkillTokens` all return `0`; only message + builtin-tool estimates real

## NOT wired

| Feature     | Area                                                                                             | Evidence                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **F20**     | CM6 active-note adapter                                                                          | `main.ts:148-151` returns `'active-note routing not wired in iter-1'`                           |
| **F22**     | palette entry for skill switch                                                                   | only 3 cmds registered: `openSettings`, `configureLmStudio`, `openChat`                         |
| **F25**     | PlanApprovalController + PlanApprovalDialog                                                      | zero refs in `main.ts` / `chatView.tsx`; `ChatRoot` accepts `planApprovalSource` but never fed  |
| **F26**     | PlanSessionResume walker                                                                         | not called on load                                                                              |
| **F27-F29** | VaultIndexer / Chunker / VectorStore / DirtyQueue                                                | zero imports in `main.ts`                                                                       |
| **F30**     | IndexerStatusBar / ReindexService / reindex command                                              | absent                                                                                          |
| **F31**     | RAGEngine                                                                                        | not instantiated                                                                                |
| **F32**     | ExcludeListStore                                                                                 | file exists (`src/settings/excludeListStore.ts`) but not imported by `main.ts` or `SettingsTab` |
| **F33**     | search_vault tool + `Plugin.onload` registration                                                 | tool not registered in `ToolRegistry`                                                           |
| **F34**     | GraphCache                                                                                       | not wired                                                                                       |
| **F35**     | graphrag boosts                                                                                  | not wired (blocked by F31 + F34)                                                                |
| **F36**     | canvas `processPath` dispatcher + F29 `node_id` key ext                                          | no canvas indexing path                                                                         |
| **F37**     | multi-thread / ThreadsStore / HeaderBar / palette / Notice buttons                               | hardcoded `DEFAULT_THREAD_ID`; no `ThreadsStore` import                                         |
| **F38**     | cloud providers (OpenAI-compat / Ollama / Anthropic / Custom) + SafeStorage + `$`-slot + pricing | only `LMStudioProvider` registered                                                              |
| **F39**     | SkillEditor React mount in SettingsTab                                                           | no `SkillEditor*` import in `SettingsTab.ts`                                                    |
| **F40**     | UserToolsLoader invocation                                                                       | loader not called from `main.ts`                                                                |
| **F43**     | autoCompactIfNeeded                                                                              | `agentRunner.ts` wires only F42 microcompact; no autocompact call                               |
| **F44**     | ptlRetry loop                                                                                    | blocked by F43                                                                                  |
| **F45**     | autocompactBreaker                                                                               | blocked by F43                                                                                  |
| **F47**     | contextCommand / contextGrid React + slash-cmd + ResizeObserver                                  | modules exist (`src/ui/contextCommand.ts`, `contextGrid.ts`), not mounted                       |
| **F48**     | contextSuggestions + status-bar mount                                                            | module exists (`src/ui/contextSuggestions.ts`), not wired to status bar                         |
| **F49**     | attachments tray / captureAttachments                                                            | zero refs in ChatView                                                                           |
| **F51**     | MCPClient + connectAll + SDK adapter                                                             | no `MCPClient` import in `main.ts`                                                              |
| **F52**     | MCP tool confirmation default + log event                                                        | blocked by F51                                                                                  |
| **F53**     | ResourcePickerStore + picker UI → ChatView                                                       | not wired                                                                                       |
| **F54**     | McpPromptCache + CompositeSkillSource                                                            | not wired                                                                                       |
| **F55**     | McpSettingsStore + React settings UI                                                             | not imported by SettingsTab                                                                     |
| **F56**     | MCPClient close/error auto-attach (reconnect)                                                    | not wired                                                                                       |

## Summary

~**25 of 57** features ship domain-only; UI/runtime wiring parked.

Gap clusters:

- **Indexing / RAG**: F27–F36 (10)
- **MCP stack**: F51–F56 (6)
- **Compaction autocompact**: F43–F45 (3)
- **Cloud providers**: F38
- **Multi-thread**: F37
- **Attachments**: F49
- **Context grid/suggestions**: F47–F48
- **Skill editor**: F39
- **Plan approval + resume**: F25, F26
- **User-defined tools**: F40
- **CM6 active-note adapter**: F20
- **Skill picker palette**: F22
- **F46 counters**: 6 counters stubbed to `0`

## Suggested wiring order

1. F37 multi-thread (unblocks thread-scoped state used by F22/F25/F49)
2. F27–F31 indexer + RAG
3. F32/F33 exclude list + search_vault tool
4. F34/F35 graph cache + boosts
5. F36 canvas indexing
6. F43–F45 autocompact + ptl retry + breaker
7. F49 attachments tray
8. F47/F48 context grid + suggestions status bar
9. F38 cloud providers + SafeStorage
10. F51–F56 MCP stack
11. F25/F26 plan approval + session resume
12. F39 skill editor React mount
13. F40 user-defined tools loader
14. F20 CM6 active-note adapter
15. F22 skill-switch palette command
16. F46 real counter implementations
