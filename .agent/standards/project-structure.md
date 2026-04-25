# Project Structure

```
leo/
├── .agent/
│   ├── architecture/
│   │   └── architecture.md              # Module map, contracts, data flows
│   ├── features/
│   │   └── leo_slice_20260419-190449/   # Sliced feature planning workspace (per-feature docs)
│   ├── scripts/
│   │   └── precommit.md                 # Precommit runbook
│   ├── srs/
│   │   ├── compact.md
│   │   ├── context.md
│   │   ├── plan.md
│   │   ├── skill-doc.md
│   │   └── srs.md                       # Software requirements spec
│   └── standards/
│       ├── best-practices.md
│       ├── code-style.md
│       ├── project-structure.md         # This file
│       └── tech-stack.md
├── src/
│   ├── agent/                           # Agent loop, compaction, plan mode, todo, context assembly, graph + streaming events
│   │   ├── acceptRejectController.ts
│   │   ├── agentRunner.ts
│   │   ├── autocompact.ts
│   │   ├── autocompactBreaker.ts
│   │   ├── compactConstants.ts
│   │   ├── compactPrompts.ts
│   │   ├── confirmationController.ts
│   │   ├── contextAnalyzer.ts
│   │   ├── contextAssembler.ts
│   │   ├── graph.ts
│   │   ├── microcompact.ts
│   │   ├── planApprovalController.ts
│   │   ├── planModeController.ts
│   │   ├── planSessionResume.ts
│   │   ├── ptlRetry.ts
│   │   ├── streamEvents.ts
│   │   ├── todoStore.ts
│   │   ├── tokenCount.ts
│   │   ├── tokenEstimator.ts
│   │   ├── truncator.ts
│   │   └── types.ts
│   ├── chat/                            # Chat message store, streaming, attachments, usage
│   │   ├── attachments.ts
│   │   ├── attachmentsStore.ts
│   │   ├── messageStore.ts
│   │   ├── streamingController.ts
│   │   ├── tokenUsage.ts
│   │   ├── types.ts
│   │   └── wireAttachments.ts
│   ├── editor/                          # CM6 edit lock, editor bridge, focused context, highlights
│   │   ├── activeNoteEditBridge.ts
│   │   ├── cm6LockDecoration.ts
│   │   ├── editLock.ts
│   │   ├── editorBridge.ts
│   │   ├── focusedContext.ts
│   │   ├── focusedContextChannel.ts
│   │   ├── highlights.ts
│   │   ├── types.ts
│   │   ├── withLock.ts
│   │   └── workspaceFocusProbe.ts
│   ├── graph/
│   │   └── GraphCache.ts                # Link graph cache
│   ├── indexer/                         # Vault + canvas chunking, dirty queue, reindex
│   │   ├── CanvasChunker.ts
│   │   ├── chunker.ts
│   │   ├── chunkIteration.ts
│   │   ├── dirtyQueue.ts
│   │   ├── indexHeader.ts
│   │   ├── indexerStatusBar.ts
│   │   ├── reindexService.ts
│   │   ├── vaultIndexer.ts
│   │   └── wireIndexerRag.ts
│   ├── mcp/                             # MCP client, config, reconnect, resource picker, prompt-skill adapter
│   │   ├── config.ts
│   │   ├── mcpClient.ts
│   │   ├── promptSkillAdapter.ts
│   │   ├── reconnect.ts
│   │   ├── resourcePicker.ts
│   │   ├── settingsStore.ts
│   │   └── wireMcp.ts
│   ├── platform/                        # Logger, sinks, error channel
│   │   ├── Logger.ts
│   │   ├── logTypes.ts
│   │   ├── obsidianSinkFs.ts
│   │   ├── obsidianUserErrorChannel.ts
│   │   └── rotatingFileSink.ts
│   ├── providers/                       # LLM + embedding providers, SSE, pricing, manager, registry
│   │   ├── anthropicProvider.ts
│   │   ├── connectionState.ts
│   │   ├── embeddingClient.ts
│   │   ├── lmStudioProvider.ts
│   │   ├── openAICompatibleProvider.ts
│   │   ├── pricing.ts
│   │   ├── providerManager.ts
│   │   ├── registry.ts
│   │   ├── sseParser.ts
│   │   └── types.ts
│   ├── rag/                             # RAG engine, graph traversal, scoring, exclude/tag matchers
│   │   ├── excludeMatcher.ts
│   │   ├── GraphTraversal.ts
│   │   ├── ragEngine.ts
│   │   ├── scorer.ts
│   │   └── tagMatcher.ts
│   ├── settings/                        # Settings tab, wizard, commands, exclude store
│   │   ├── commands.ts
│   │   ├── excludeListStore.ts
│   │   ├── settingsStore.ts
│   │   ├── SettingsTab.ts
│   │   ├── WizardApp.tsx
│   │   ├── wizardMachine.ts
│   │   └── wizardModal.tsx
│   ├── skills/                          # Skill parse/store/editor, registry, runtime (conditional, hooks, permissions, shell exec, slash, substitutions, listing, invoked, signals, dynamic, migration)
│   │   ├── builtins.ts
│   │   ├── conditional.ts
│   │   ├── dynamic.ts
│   │   ├── hooks.ts
│   │   ├── invokedSkills.ts
│   │   ├── listingAttachment.ts
│   │   ├── migration.ts
│   │   ├── parse.ts
│   │   ├── permissions.ts
│   │   ├── registry.ts
│   │   ├── shellExec.ts
│   │   ├── signals.ts
│   │   ├── skillEditorController.ts
│   │   ├── skillsStore.ts
│   │   ├── slashProcessor.ts
│   │   ├── substitutions.ts
│   │   └── types.ts
│   ├── storage/                         # IndexedDB stores, vault adapter, safeStorage, vectors
│   │   ├── conversationSchema.ts
│   │   ├── conversationStore.ts
│   │   ├── planStore.ts
│   │   ├── safeStorage.ts
│   │   ├── threadsStore.ts
│   │   ├── vaultAdapter.ts
│   │   └── vectorStore.ts
│   ├── tools/                           # Tool registry + builtin + user tool loader + zod adapter
│   │   ├── builtin/
│   │   │   ├── appendToNote.ts
│   │   │   ├── createFolder.ts
│   │   │   ├── createNote.ts
│   │   │   ├── editNote.ts
│   │   │   ├── listNotes.ts
│   │   │   ├── readNote.ts
│   │   │   ├── searchVault.ts
│   │   │   └── skillTool.ts
│   │   ├── user/
│   │   │   ├── userToolsLoader.ts
│   │   │   └── wireUserTools.ts
│   │   ├── planModeTools.ts
│   │   ├── todoWriteTool.ts
│   │   ├── toolRegistry.ts
│   │   ├── types.ts
│   │   └── zodAdapter.ts
│   ├── ui/                              # Chat view, context UI, notifications, icons
│   │   ├── chat/
│   │   │   ├── __stories__/
│   │   │   │   └── mocks/
│   │   │   │       └── sources.ts       # Shared Storybook mocks (sources, conversations, renderers)
│   │   │   ├── widgets/
│   │   │   │   ├── ContextWidget.tsx
│   │   │   │   └── registry.ts
│   │   │   ├── ChatRoot.stories.tsx
│   │   │   ├── ChatRoot.tsx
│   │   │   ├── codeBlockEnhancer.ts
│   │   │   ├── ComposerInput.stories.tsx
│   │   │   ├── ComposerInput.tsx
│   │   │   ├── ContextIndicator.stories.tsx
│   │   │   ├── ContextIndicator.tsx
│   │   │   ├── fuzzyMatch.ts
│   │   │   ├── HeaderBar.stories.tsx
│   │   │   ├── HeaderBar.tsx
│   │   │   ├── HeaderStat.tsx
│   │   │   ├── HeaderStatsLive.tsx
│   │   │   ├── headerStatsSources.ts
│   │   │   ├── IndexStatusBlock.stories.tsx
│   │   │   ├── IndexStatusBlock.tsx
│   │   │   ├── InlineConfirmation.tsx
│   │   │   ├── InlineDialog.tsx
│   │   │   ├── MessageActionBar.stories.tsx
│   │   │   ├── MessageActionBar.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── PlanApprovalDialog.stories.tsx
│   │   │   ├── PlanApprovalDialog.tsx
│   │   │   ├── scrollAnchoring.ts
│   │   │   ├── slashCommands.ts
│   │   │   ├── SlashPicker.stories.tsx
│   │   │   ├── SlashPicker.tsx
│   │   │   ├── ThreadSwitcher.stories.tsx
│   │   │   ├── ThreadSwitcher.tsx
│   │   │   └── turnDispatcher.ts
│   │   ├── chatView.tsx
│   │   ├── contextCommand.ts
│   │   ├── contextGrid.ts
│   │   ├── contextSuggestions.ts
│   │   ├── notifications.ts
│   │   ├── openChatView.ts
│   │   ├── responsiveCollapse.ts
│   │   ├── toolIcons.ts
│   │   ├── viewType.ts
│   │   ├── visualStates.ts
│   │   ├── wireContextStatusLine.ts
│   │   └── wireUiHelpers.ts
│   ├── util/
│   │   ├── debounce.ts
│   │   ├── delay.ts
│   │   └── fifoQueue.ts
│   └── main.ts                          # Obsidian plugin entry
├── tests/
│   ├── unit/                            # Vitest unit suite (happy-dom)
│   ├── dom/                             # React/DOM component tests
│   ├── integration/                     # MSW-backed provider/embedding integration
│   │   ├── _mswServer.ts
│   │   ├── embeddingClient.test.ts
│   │   ├── lmStudioProvider.test.ts
│   │   └── providerManager.test.ts
│   ├── smoke/                           # Release smoke + CM6 checklist + tinyVault fixture
│   │   ├── fixtures/
│   │   │   ├── tinyVault/
│   │   │   └── tinyVault.ts
│   │   ├── CM6-CHECKLIST.md
│   │   ├── RELEASE.md
│   │   └── release.smoke.test.ts
│   ├── perf/                            # Perf fixtures + report
│   │   ├── fixtures/
│   │   │   └── make10kVault.ts
│   │   └── REPORT.md
│   └── llm/                             # Live LLM tests (vitest.llm.config.ts)
│       ├── _fakes.ts
│       ├── _judge.ts
│       ├── _liveEnv.ts
│       ├── agent.live.test.ts
│       ├── embeddings.live.test.ts
│       ├── provider.live.test.ts
│       └── toolCalling.live.test.ts
├── .agent/                              # Planning, standards, scripts (see top of tree)
├── .eslintignore
├── .eslintrc.cjs
├── .gitignore
├── .prettierignore
├── .prettierrc.json
├── .storybook/                          # Storybook config (main, preview, mocks, obsidian theme vars)
│   ├── mocks/
│   ├── main.ts
│   ├── preview.ts
│   └── preview-obsidian-vars.css
├── CLAUDE.md                            # Root agent instructions
├── data.json                            # Plugin runtime data
├── esbuild.config.mjs                   # Bundler config
├── main.js                              # Bundled plugin output (gitignored in spirit)
├── manifest.json                        # Obsidian plugin manifest
├── package.json
├── pnpm-lock.yaml
├── styles.css                           # Plugin styles
├── tsconfig.json
├── vitest.config.ts                     # Default vitest config
└── vitest.llm.config.ts                 # Live-LLM vitest config
```

## Test suites

- `pnpm test` — default vitest (unit + dom + integration + smoke).
- `pnpm test:llm` — live provider tests (`vitest.llm.config.ts`), requires env keys.
- `pnpm smoke` — release smoke only.
- `pnpm bench` — vitest bench.
- `pnpm lint` — eslint over `src/**` and `tests/**`.
- `pnpm format` / `pnpm format:check` — prettier write / check.
- `pnpm typecheck` — `tsc --noEmit`.
- `pnpm dev` / `pnpm build` — esbuild (dev watch / prod bundle).
- `pnpm storybook` / `pnpm build-storybook` — Storybook dev server / static build.
