# Integration orphans — leo_slice_20260419-190449

2026-04-23T02:06:52+03:00

Method: import-closure BFS from `src/main.ts` (resolving `@/` alias to `src/`, plus relative imports). A file is an orphan when it is not in the closure.

Entry points scanned:
- src/main.ts

## Result

**Clean — 0 orphans.** All 138 `.ts` / `.tsx` files under `src/` are reachable from `src/main.ts` after the F58–F68 wiring sweep. The 43 orphans flagged on 2026-04-22 (row 232) have all been resolved:

| Feature | Resolved orphan(s) |
|---|---|
| F58 wire-indexer-rag-graph | 18 files across `indexer/`, `rag/`, `graph/`, `storage/vectorStore.ts`, `settings/excludeListStore.ts`, `tools/builtin/searchVault.ts`, `ui/chat/IndexEmptyStateCta.tsx` |
| F59 wire-edit-lock-cm6 | `editor/editLock.ts`, `editor/highlights.ts`, `editor/withLock.ts` |
| F60 wire-plan-mode | `agent/planSessionResume.ts`, `storage/planStore.ts`, `tools/todoWriteTool.ts`, `tools/planModeTools.ts` |
| F61 wire-cloud-providers | `providers/anthropicProvider.ts`, `providers/openAICompatibleProvider.ts`, `providers/pricing.ts`, `storage/safeStorage.ts` |
| F62 wire-mcp | `mcp/config.ts`, `mcp/mcpClient.ts`, `mcp/promptSkillAdapter.ts`, `mcp/reconnect.ts`, `mcp/resourcePicker.ts`, `mcp/settingsStore.ts` |
| F63 wire-threads-multi | `storage/threadsStore.ts` |
| F64 wire-skill-editor | `skills/skillEditorController.ts` |
| F65 wire-user-tools | `tools/user/userToolsLoader.ts` |
| F66 wire-attachments-ui | `chat/attachments.ts` |
| F67 wire-ui-helpers | `ui/notifications.ts`, `ui/toolIcons.ts`, `ui/visualStates.ts` |
| F68 wire-context-suggestions-statusline | `ui/contextSuggestions.ts` |
