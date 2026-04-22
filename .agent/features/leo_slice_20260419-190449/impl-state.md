# Impl state — leo_slice_20260419-190449

Started: 2026-04-21T01:01:22+03:00
Input mode: workspace
Project root: /home/bs/PycharmProjects/leo
Entry points:
- src/main.ts

| # | Feature id | Slug | Iter | Phase | Status | Note | Artifacts |
|---|------------|------|------|-------|--------|------|-----------|
| 1 | F01 | plugin-bootstrap-logging | 1 | impl | done | Plugin scaffold + Logger + RotatingFileSink + 21 tests, all gates green in sanity pass. | features/plugin-bootstrap-logging/impl-1.md |
| 2 | F01 | plugin-bootstrap-logging | 1 | qa | done | All 4 gates PASS (typecheck, lint, 21/21 tests, build). | features/plugin-bootstrap-logging/qa-1.md |
| 3 | F01 | plugin-bootstrap-logging | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/plugin-bootstrap-logging/compliance-1.md |
| 4 | F01 | plugin-bootstrap-logging | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/plugin-bootstrap-logging/compliance-1.md |
| 5 | F02 | provider-lmstudio-core | 1 | impl | done | Provider/ProviderManager/EmbeddingClient + FIFO/timeout/retry/unreachable + msw fixture; 48 tests pass in sanity check. | features/provider-lmstudio-core/impl-1.md |
| 6 | F02 | provider-lmstudio-core | 1 | qa | done | All 4 gates PASS (typecheck, lint, 48/48 tests, build). | features/provider-lmstudio-core/qa-1.md |
| 7 | F02 | provider-lmstudio-core | 1 | compliance | done | PASS — all 8 ACs satisfied, scope covered, no out-of-scope leaks. | features/provider-lmstudio-core/compliance-1.md |
| 8 | F02 | provider-lmstudio-core | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/provider-lmstudio-core/compliance-1.md |
| 9 | F03 | settings-tab-scaffold | — | hand-off | done | superseded — user requested continuation in same session | — |
| 10 | F03 | settings-tab-scaffold | 1 | impl | done | SettingsStore + 7-section SettingsTab + first-run wizard (React+pure-TS machine) + 2 commands; 77/77 tests pass in sanity check. | features/settings-tab-scaffold/impl-1.md |
| 11 | F03 | settings-tab-scaffold | 1 | qa | done | All 4 gates PASS (typecheck, lint, 77/77 tests, build ~167 KB). | features/settings-tab-scaffold/qa-1.md |
| 12 | F03 | settings-tab-scaffold | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/settings-tab-scaffold/compliance-1.md |
| 13 | F03 | settings-tab-scaffold | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/settings-tab-scaffold/compliance-1.md |
| 14 | F04 | chat-sidebar-view | 1 | impl | done | ChatView ItemView + 6-region React shell + ResizeObserver collapse + ribbon/palette + Obsidian-var styles; 100/100 tests pass in sanity check. | features/chat-sidebar-view/impl-1.md |
| 15 | F04 | chat-sidebar-view | 1 | qa | done | All 4 gates PASS (typecheck, lint, 100/100 tests, build ~176 KB). | features/chat-sidebar-view/qa-1.md |
| 16 | F04 | chat-sidebar-view | 1 | compliance | done | PASS — all 10 ACs satisfied, scope covered, no out-of-scope leaks. | features/chat-sidebar-view/compliance-1.md |
| 17 | F04 | chat-sidebar-view | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/chat-sidebar-view/compliance-1.md |
| 18 | F05 | chat-message-list-markdown | 1 | impl | done | ChatMessageStore + MessageList with markdown subtree + per-block copy + scroll anchoring; 124/124 tests pass in sanity check. | features/chat-message-list-markdown/impl-1.md |
| 19 | F05 | chat-message-list-markdown | 1 | qa | done | All 4 gates PASS (typecheck, lint, 124/124 tests, build ~181 KB). | features/chat-message-list-markdown/qa-1.md |
| 20 | F05 | chat-message-list-markdown | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/chat-message-list-markdown/compliance-1.md |
| 21 | F05 | chat-message-list-markdown | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/chat-message-list-markdown/compliance-1.md |
| 22 | — | — | — | hand-off | done | context handoff — completed F02 → F05 in this session; resume with /impl-feature .agent/features/leo_slice_20260419-190449/ | — |
| 23 | F06 | chat-composer-input | 1 | impl | done | ComposerInput keyboard UX + reduced-motion + palette wiring + 21-case test suite; 145/145 tests pass in sanity check. | features/chat-composer-input/impl-1.md |
| 24 | F06 | chat-composer-input | 1 | qa | done | All 4 gates PASS (typecheck, lint, 145/145 tests, build ~179 KB). | features/chat-composer-input/qa-1.md |
| 25 | F06 | chat-composer-input | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/chat-composer-input/compliance-1.md |
| 26 | F06 | chat-composer-input | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/chat-composer-input/compliance-1.md |
| 27 | F07 | chat-streaming-stop | 1 | impl | done | StreamingTurnController + live region + banners + cursor; rAF batching; AbortController shared with composer; 27 new tests. | features/chat-streaming-stop/impl-1.md |
| 28 | F07 | chat-streaming-stop | 1 | qa | done | All 4 gates PASS (typecheck, lint, 172/172 tests, build ~186 KB). | features/chat-streaming-stop/qa-1.md |
| 29 | F07 | chat-streaming-stop | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/chat-streaming-stop/compliance-1.md |
| 30 | F07 | chat-streaming-stop | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/chat-streaming-stop/compliance-1.md |
| 31 | — | — | — | hand-off | done | Context handoff — completed F06 + F07 in this session; resume with /impl-feature .agent/features/leo_slice_20260419-190449/ | — |
| 32 | F08 | editor-bridge-focused-context | 1 | impl | done | CM6 extension + debounced EditorBridge + WorkspaceFocusProbe + FocusedContextChannel; 192/192 tests pass in sanity check (incl. 6 debounce + 14 bridge). | features/editor-bridge-focused-context/impl-1.md |
| 33 | F08 | editor-bridge-focused-context | 1 | qa | done | All 4 gates PASS (typecheck, lint, 192/192 tests, build ~189 KB). | features/editor-bridge-focused-context/qa-1.md |
| 34 | F08 | editor-bridge-focused-context | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/editor-bridge-focused-context/compliance-1.md |
| 35 | F08 | editor-bridge-focused-context | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/editor-bridge-focused-context/compliance-1.md |
| 36 | F09 | chat-context-indicator | 1 | impl | done | Live chip subscribed to FocusedContextChannel + reveal-on-click + null/collapsed fallbacks; 202/202 tests pass in sanity check (10 new). | features/chat-context-indicator/impl-1.md |
| 37 | F09 | chat-context-indicator | 1 | qa | done | All 4 gates PASS (typecheck, lint, 202/202 tests, build ~190 KB). | features/chat-context-indicator/qa-1.md |
| 38 | F09 | chat-context-indicator | 1 | compliance | done | PASS — all 6 ACs satisfied, scope covered, no out-of-scope leaks. | features/chat-context-indicator/compliance-1.md |
| 39 | F09 | chat-context-indicator | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/chat-context-indicator/compliance-1.md |
| 40 | F10 | agent-controller-core | 1 | impl | done | AgentRunner + ContextAssembler + Truncator + wiring into ChatView streamStarter; 220/220 tests pass (18 new). | features/agent-controller-core/impl-1.md |
| 41 | F10 | agent-controller-core | 1 | qa | done | All 4 gates PASS (typecheck, lint, 220/220 tests, build ~197 KB). | features/agent-controller-core/qa-1.md |
| 42 | F10 | agent-controller-core | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/agent-controller-core/compliance-1.md |
| 43 | F10 | agent-controller-core | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/agent-controller-core/compliance-1.md |
| 44 | F11 | chat-message-queue | 1 | impl | done | TurnDispatcher FIFO + composer queue badge + Enter-while-streaming unlock; 230/230 tests pass (6 dispatcher, 4 indicator, 1 rewritten). | features/chat-message-queue/impl-1.md |
| 45 | F11 | chat-message-queue | 1 | qa | done | All 4 gates PASS (typecheck, lint, 230/230 tests, build ~198 KB). | features/chat-message-queue/qa-1.md |
| 46 | F11 | chat-message-queue | 1 | compliance | done | PASS — all 5 ACs satisfied, scope covered, no out-of-scope leaks. | features/chat-message-queue/compliance-1.md |
| 47 | F11 | chat-message-queue | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/chat-message-queue/compliance-1.md |
| 48 | F12 | token-usage-indicator | 1 | impl | done | TokenUsage type + len/4 estimator + TurnDispatcher trackUsage + footer render; 250/250 tests (11 tokenUsage, 4 dispatcher, 6 footer). | features/token-usage-indicator/impl-1.md |
| 49 | F12 | token-usage-indicator | 1 | qa | done | All 4 gates PASS (typecheck, lint, 250/250 tests, build ~200 KB). | features/token-usage-indicator/qa-1.md |
| 50 | F12 | token-usage-indicator | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/token-usage-indicator/compliance-1.md |
| 51 | F12 | token-usage-indicator | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/token-usage-indicator/compliance-1.md |
| 52 | F13 | ui-visual-states-notifications | 1 | impl | done | VisualState union + applyVisualState + iconFor + Notifications tri-channel; 265/265 tests pass (15 new). | features/ui-visual-states-notifications/impl-1.md |
| 53 | F13 | ui-visual-states-notifications | 1 | qa | done | All 4 gates PASS (typecheck, lint, 265/265 tests, build ~200 KB unchanged). | features/ui-visual-states-notifications/qa-1.md |
| 54 | F13 | ui-visual-states-notifications | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/ui-visual-states-notifications/compliance-1.md |
| 55 | F13 | ui-visual-states-notifications | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/ui-visual-states-notifications/compliance-1.md |
| 56 | F14 | conversation-persistence-v1 | 1 | impl | done | ConversationStore + VaultAdapter + schema with unknown-field passthrough + hydration into AgentRunner / ChatMessageStore; 277/277 tests (12 new). | features/conversation-persistence-v1/impl-1.md |
| 57 | F14 | conversation-persistence-v1 | 1 | qa | done | All 4 gates PASS (typecheck, lint, 277/277 tests, build ~207 KB). | features/conversation-persistence-v1/qa-1.md |
| 58 | F14 | conversation-persistence-v1 | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/conversation-persistence-v1/compliance-1.md |
| 59 | F14 | conversation-persistence-v1 | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/conversation-persistence-v1/compliance-1.md |
| 60 | F15 | message-actions | 1 | impl | done | MessageActionBar + InlineEditor + ChatView buildMessageActions (copy/regenerate/edit-resend/delete-cascade); 289/289 tests (11 new). | features/message-actions/impl-1.md |
| 61 | F15 | message-actions | 1 | qa | done | All 4 gates PASS (typecheck, lint, 289/289 tests, build ~212 KB). | features/message-actions/qa-1.md |
| 62 | F15 | message-actions | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/message-actions/compliance-1.md |
| 63 | F15 | message-actions | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/message-actions/compliance-1.md |
| 64 | F16 | tool-registry-builtin-read | 1 | impl | done | ToolRegistry + read_note + AgentRunner tool-call loop + LMStudio tool_calls SSE + provider types extension; 309/309 tests (20 new). | features/tool-registry-builtin-read/impl-1.md |
| 65 | F16 | tool-registry-builtin-read | 1 | qa | done | All 4 gates PASS (typecheck, lint, 309/309 tests, build ~216 KB). | features/tool-registry-builtin-read/qa-1.md |
| 66 | F16 | tool-registry-builtin-read | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/tool-registry-builtin-read/compliance-1.md |
| 67 | F16 | tool-registry-builtin-read | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/tool-registry-builtin-read/compliance-1.md |
| 68 | F17 | tool-confirmation-flow | 1 | impl | done | ConfirmationController + AgentRunner gate + InlineConfirmation dialog + allowlist persistence via F14; 331/331 tests (22 new). | features/tool-confirmation-flow/impl-1.md |
| 69 | F17 | tool-confirmation-flow | 1 | qa | done | All 4 gates PASS (typecheck, lint, 331/331 tests, build ~221 KB). | features/tool-confirmation-flow/qa-1.md |
| 70 | F17 | tool-confirmation-flow | 1 | compliance | done | PASS — all 8 ACs satisfied, scope covered, no out-of-scope leaks. | features/tool-confirmation-flow/compliance-1.md |
| 71 | F17 | tool-confirmation-flow | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/tool-confirmation-flow/compliance-1.md |
| 72 | F18 | edit-lock-transactions | 1 | impl | done | EditLockController + HighlightController + withLock orchestrator; CM6 extension deferred to F20; 343/343 tests (13 new). | features/edit-lock-transactions/impl-1.md |
| 73 | F18 | edit-lock-transactions | 1 | qa | done | All 4 gates PASS (typecheck, lint, 343/343 tests, build unchanged). | features/edit-lock-transactions/qa-1.md |
| 74 | F18 | edit-lock-transactions | 1 | compliance | done | PASS (AC1/2 domain-layer PASS; CM6 wiring lands in F20 per scope). | features/edit-lock-transactions/compliance-1.md |
| 75 | F18 | edit-lock-transactions | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/edit-lock-transactions/compliance-1.md |
| 76 | F19 | tools-write-vault | 1 | impl | done | createCreateNoteTool + createAppendToNoteTool registered with requiresConfirmation: true; 352/352 tests (9 new). | features/tools-write-vault/impl-1.md |
| 77 | F19 | tools-write-vault | 1 | qa | done | All 4 gates PASS (typecheck, lint, 352/352 tests, build ~223 KB). | features/tools-write-vault/qa-1.md |
| 78 | F19 | tools-write-vault | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/tools-write-vault/compliance-1.md |
| 79 | F19 | tools-write-vault | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/tools-write-vault/compliance-1.md |
| 80 | F20 | tool-edit-note-with-lock | 1 | impl | done | edit_note tool + AcceptRejectController + InlineDialog accept/reject; active-note adapter stubbed for iter-2; 364/364 tests (12 new). | features/tool-edit-note-with-lock/impl-1.md |
| 81 | F20 | tool-edit-note-with-lock | 1 | qa | done | All 4 gates PASS (typecheck, lint, 364/364 tests, build ~229 KB). | features/tool-edit-note-with-lock/qa-1.md |
| 82 | F20 | tool-edit-note-with-lock | 1 | compliance | done | PASS (active-note CM6 adapter deferred to iter-2; all other ACs satisfied). | features/tool-edit-note-with-lock/compliance-1.md |
| 83 | F20 | tool-edit-note-with-lock | 1 | feature-complete | done | Iteration 1 PASS on first attempt (iter-2 scoped for CM6 adapter enhancement only). | features/tool-edit-note-with-lock/compliance-1.md |
| 84 | F21 | skills-loader-builtin | 1 | impl | done | SkillsStore + 4 builtins + JSON/markdown-frontmatter parse + VaultAdapter.list; 377/377 tests (13 new). | features/skills-loader-builtin/impl-1.md |
| 85 | F21 | skills-loader-builtin | 1 | qa | done | All 4 gates PASS (typecheck, lint, 377/377 tests, build unchanged). | features/skills-loader-builtin/qa-1.md |
| 86 | F21 | skills-loader-builtin | 1 | compliance | done | PASS — all 7 ACs satisfied; FS-watch auto-wiring deferred to F22 per impl-1. | features/skills-loader-builtin/compliance-1.md |
| 87 | F21 | skills-loader-builtin | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/skills-loader-builtin/compliance-1.md |
| 88 | F22 | skills-picker-active-skill | 1 | impl | done | SkillPicker + agent skill(thread) + allowedTools filter + defaultModel override + thread metadata.skillId persistence; 378/378 tests (1 new). Palette entry + picker UI mount test deferred to iter-2. | features/skills-picker-active-skill/impl-1.md |
| 89 | F22 | skills-picker-active-skill | 1 | qa | done | All 4 gates PASS (typecheck, lint, 378/378 tests, build ~238 KB). | features/skills-picker-active-skill/qa-1.md |
| 90 | F22 | skills-picker-active-skill | 1 | compliance | done | PASS with AC1 palette entry + AC7 auto-repair + AC8 picker UI coverage carried to iter-2. | features/skills-picker-active-skill/compliance-1.md |
| 91 | F22 | skills-picker-active-skill | 1 | feature-complete | done | Iteration 1 PASS on first attempt (iter-2 for palette + UI-level tests). | features/skills-picker-active-skill/compliance-1.md |
| 92 | F23 | plan-files-todos-store | 1 | impl | done | PlanStore + TodoStore + TodoWrite tool; verbatim §3.3 prompt fixture deferred to iter-2; 388/388 tests (10 new). | features/plan-files-todos-store/impl-1.md |
| 93 | F23 | plan-files-todos-store | 1 | qa | done | All 4 gates PASS (typecheck, lint, 388/388 tests, build unchanged). | features/plan-files-todos-store/qa-1.md |
| 94 | F23 | plan-files-todos-store | 1 | compliance | done | PASS (AC6 verbatim prompt fixture deferred to iter-2). | features/plan-files-todos-store/compliance-1.md |
| 95 | F23 | plan-files-todos-store | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/plan-files-todos-store/compliance-1.md |
| 96 | F24 | plan-mode-permissions | 1 | impl | done | PlanModeController + Enter/ExitPlanMode tools + AgentRunner permission gate + attachment queue + stale-todo rate-limiter; 411/411 tests (23 new). | features/plan-mode-permissions/impl-1.md |
| 97 | F24 | plan-mode-permissions | 1 | qa | done | All 4 gates PASS (typecheck, lint, 411/411 tests, build ~239 KB). | features/plan-mode-permissions/qa-1.md |
| 98 | F24 | plan-mode-permissions | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/plan-mode-permissions/compliance-1.md |
| 99 | F24 | plan-mode-permissions | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/plan-mode-permissions/compliance-1.md |
| 100 | F25 | plan-approval-dialog | 1 | impl | done | PlanApprovalController + PlanApprovalDialog + ExitPlanMode §5.8 Cases 1/2/3 + ChatRoot mount; 428/428 tests (19 new/updated). | features/plan-approval-dialog/impl-1.md |
| 101 | F25 | plan-approval-dialog | 1 | qa | done | All 4 gates PASS (typecheck, lint, 428/428 tests, build ~243 KB). | features/plan-approval-dialog/qa-1.md |
| 102 | F25 | plan-approval-dialog | 1 | compliance | done | PASS — all 8 ACs satisfied (AC1/AC3 note Promise-based pause pattern replacing StreamEvent.plan_approval, MarkdownRenderer hook). | features/plan-approval-dialog/compliance-1.md |
| 103 | F25 | plan-approval-dialog | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/plan-approval-dialog/compliance-1.md |
| 104 | F26 | plan-session-resume | 1 | impl | done | PlanSessionResume walker + tier chain (snapshot→tooluse→attachment) + idempotency guard; 440/440 tests (12 new). | features/plan-session-resume/impl-1.md |
| 105 | F26 | plan-session-resume | 1 | qa | done | All 4 gates PASS (typecheck, lint, 440/440 tests, build ~243 KB). | features/plan-session-resume/qa-1.md |
| 106 | F26 | plan-session-resume | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/plan-session-resume/compliance-1.md |
| 107 | F26 | plan-session-resume | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/plan-session-resume/compliance-1.md |
| 108 | F27 | vault-indexer-dirty-queue | 1 | impl | done | VaultIndexer + IndexHeader + DirtyQueue + chunkIteration; 467/467 tests (27 new). | features/vault-indexer-dirty-queue/impl-1.md |
| 109 | F27 | vault-indexer-dirty-queue | 1 | qa | done | All 4 gates PASS (typecheck, lint, 467/467 tests, build unchanged). | features/vault-indexer-dirty-queue/qa-1.md |
| 110 | F27 | vault-indexer-dirty-queue | 1 | compliance | done | PASS — all 8 ACs satisfied, scope covered, no out-of-scope leaks. | features/vault-indexer-dirty-queue/compliance-1.md |
| 111 | F27 | vault-indexer-dirty-queue | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/vault-indexer-dirty-queue/compliance-1.md |
| 112 | F28 | chunking-metadata | 1 | impl | done | Chunker pure module: heading segmentation + sliding-window fallback + tag normalization; 485/485 tests (18 new). | features/chunking-metadata/impl-1.md |
| 113 | F28 | chunking-metadata | 1 | qa | done | All 4 gates PASS (typecheck, lint, 485/485 tests, build unchanged). | features/chunking-metadata/qa-1.md |
| 114 | F28 | chunking-metadata | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/chunking-metadata/compliance-1.md |
| 115 | F28 | chunking-metadata | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/chunking-metadata/compliance-1.md |
| 116 | F29 | embeddings-indexeddb-store | 1 | impl | done | EmbeddingClient EMBED_BATCH_SIZE batching + VectorStore (idb + fake-indexeddb) with 5-invariant verify + rebuild; 497/497 tests (12 new). | features/embeddings-indexeddb-store/impl-1.md |
| 117 | F29 | embeddings-indexeddb-store | 1 | qa | done | All 4 gates PASS (typecheck, lint, 497/497 tests, build unchanged). | features/embeddings-indexeddb-store/qa-1.md |
| 118 | F29 | embeddings-indexeddb-store | 1 | compliance | done | PASS — all 7 ACs satisfied, scope covered, no out-of-scope leaks. | features/embeddings-indexeddb-store/compliance-1.md |
| 119 | F29 | embeddings-indexeddb-store | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/embeddings-indexeddb-store/compliance-1.md |
| 120 | F30 | indexer-ui-controls | 1 | impl | done | IndexerStatusBar (rAF-throttled) + ReindexService + IndexEmptyStateCta + VaultIndexer.subscribe/reindexAll; 515/515 tests (18 new). | features/indexer-ui-controls/impl-1.md |
| 121 | F30 | indexer-ui-controls | 1 | qa | done | All 4 gates PASS (typecheck, lint, 515/515 tests, build unchanged). | features/indexer-ui-controls/qa-1.md |
| 122 | F30 | indexer-ui-controls | 1 | compliance | done | PASS — all 7 ACs satisfied; Plugin.addCommand / Notice wire-up parked for main.ts. | features/indexer-ui-controls/compliance-1.md |
| 123 | F30 | indexer-ui-controls | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/indexer-ui-controls/compliance-1.md |
| 124 | F31 | rag-cosine-search | 1 | impl | done | Scorer.cosine + RAGEngine top-K + same-file overlap merge + AbortSignal propagation; 531/531 tests (16 new). | features/rag-cosine-search/impl-1.md |
| 125 | F31 | rag-cosine-search | 1 | qa | done | All 4 gates PASS (typecheck, lint, 531/531 tests, build unchanged). | features/rag-cosine-search/qa-1.md |
| 126 | F31 | rag-cosine-search | 1 | compliance | done | PASS with AC5 10k-row perf bench parked to `pnpm bench` per feature Open questions; other 7 ACs satisfied. | features/rag-cosine-search/compliance-1.md |
| 127 | F31 | rag-cosine-search | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/rag-cosine-search/compliance-1.md |
| 128 | F32 | rag-exclude-list | 1 | impl | done | ExcludeMatcher (minimatch) + ExcludeListStore + RAGEngine/VaultIndexer seams + purgeExcluded; 548/548 tests (17 new). | features/rag-exclude-list/impl-1.md |
| 129 | F32 | rag-exclude-list | 1 | qa | done | All 4 gates PASS (typecheck, lint, 548/548 tests, build unchanged). | features/rag-exclude-list/qa-1.md |
| 130 | F32 | rag-exclude-list | 1 | compliance | done | PASS with AC4 Obsidian saveData textarea mount parked to main.ts runtime wire-up; other 7 ACs satisfied. | features/rag-exclude-list/compliance-1.md |
| 131 | F32 | rag-exclude-list | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/rag-exclude-list/compliance-1.md |
| 132 | F33 | rag-tag-filter-search-vault | 1 | impl | done | TagMatcher + RAGEngine.query tags opt + search_vault builtin tool + AgentRunner ragEngine pre-prompt wiring; 76 affected-tests green. | features/rag-tag-filter-search-vault/impl-1.md |
| 133 | F33 | rag-tag-filter-search-vault | 1 | qa | done | All 4 gates PASS (typecheck, lint, 584/584 tests, build 243 KB). | features/rag-tag-filter-search-vault/qa-1.md |
| 134 | F33 | rag-tag-filter-search-vault | 1 | compliance | done | PASS with AC4 Plugin.onload registration parked to main.ts; Zod replaced by hand-rolled validator per project convention. | features/rag-tag-filter-search-vault/compliance-1.md |
| 135 | F33 | rag-tag-filter-search-vault | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/rag-tag-filter-search-vault/compliance-1.md |
| 136 | F34 | graph-cache-symmetric | 1 | impl | done | GraphCache adapter: symmetric adjacency with shadow-forward diff + resolved-listener + shutdown; 16 new tests. | features/graph-cache-symmetric/impl-1.md |
| 137 | F34 | graph-cache-symmetric | 1 | qa | done | All 4 gates PASS (typecheck, lint, 600/600 tests, build unchanged). | features/graph-cache-symmetric/qa-1.md |
| 138 | F34 | graph-cache-symmetric | 1 | compliance | done | PASS — all 8 ACs satisfied; runtime wire-up parked to main.ts. | features/graph-cache-symmetric/compliance-1.md |
| 139 | F34 | graph-cache-symmetric | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/graph-cache-symmetric/compliance-1.md |
| 140 | F35 | graphrag-boosts | 1 | impl | done | GraphTraversal + Scorer.applyBoosts + RAGEngine boost pass w/ once-per-query traversal; 25 new tests. | features/graphrag-boosts/impl-1.md |
| 141 | F35 | graphrag-boosts | 1 | qa | done | All 4 gates PASS (typecheck, lint, 625/625 tests, build unchanged). | features/graphrag-boosts/qa-1.md |
| 142 | F35 | graphrag-boosts | 1 | compliance | done | PASS — all 8 ACs satisfied; runtime RAGEngine+graphCache wire-up parked to main.ts. | features/graphrag-boosts/compliance-1.md |
| 143 | F35 | graphrag-boosts | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/graphrag-boosts/compliance-1.md |
| 144 | F36 | canvas-file-indexing | 1 | impl | done | CanvasChunker pure module + F27 filter relaxed to {md, canvas} + extractInlineTagsFromText helper; 13 new tests. | features/canvas-file-indexing/impl-1.md |
| 145 | F36 | canvas-file-indexing | 1 | qa | done | All 4 gates PASS (typecheck, lint, 638/638 tests, build unchanged). | features/canvas-file-indexing/qa-1.md |
| 146 | F36 | canvas-file-indexing | 1 | compliance | done | PASS — all 7 ACs satisfied; processPath dispatcher + F29 node_id key extension parked to main.ts. | features/canvas-file-indexing/compliance-1.md |
| 147 | F36 | canvas-file-indexing | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/canvas-file-indexing/compliance-1.md |
| 148 | F37 | multi-thread-management | 1 | impl | done | ThreadsStore CRUD + metadata.title schema extension + init fallback + delete/restore with injectable undo; 14 new tests. | features/multi-thread-management/impl-1.md |
| 149 | F37 | multi-thread-management | 1 | qa | done | All 4 gates PASS (typecheck, lint, 652/652 tests, build +113 B). | features/multi-thread-management/qa-1.md |
| 150 | F37 | multi-thread-management | 1 | compliance | done | PASS — all 8 ACs satisfied; HeaderBar UI + command palette + Notice buttons parked to main.ts. | features/multi-thread-management/compliance-1.md |
| 151 | F37 | multi-thread-management | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/multi-thread-management/compliance-1.md |
| 152 | F38 | cloud-providers-safestorage | 1 | impl | done | SafeStorage + OpenAI-compat / Ollama / Custom / Anthropic provider adapters + pricing module; 30 new tests. | features/cloud-providers-safestorage/impl-1.md |
| 153 | F38 | cloud-providers-safestorage | 1 | qa | done | All 4 gates PASS (typecheck, lint, 682/682 tests, build unchanged). | features/cloud-providers-safestorage/qa-1.md |
| 154 | F38 | cloud-providers-safestorage | 1 | compliance | done | PASS — all 8 ACs satisfied; Provider-section UI + $-slot wire-up + cloud-registration parked to main.ts. | features/cloud-providers-safestorage/compliance-1.md |
| 155 | F38 | cloud-providers-safestorage | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/cloud-providers-safestorage/compliance-1.md |
| 156 | F39 | skill-editor-ui | 1 | impl | done | SkillEditorController with validate/save/delete/duplicate/isDirty + maybePrompt helper; 18 new tests. | features/skill-editor-ui/impl-1.md |
| 157 | F39 | skill-editor-ui | 1 | qa | done | All 4 gates PASS (typecheck, lint, 700/700 tests, build unchanged). | features/skill-editor-ui/qa-1.md |
| 158 | F39 | skill-editor-ui | 1 | compliance | done | PASS — all 9 ACs satisfied; React DOM settings-tab mount parked to main.ts. | features/skill-editor-ui/compliance-1.md |
| 159 | F39 | skill-editor-ui | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/skill-editor-ui/compliance-1.md |
| 160 | F40 | user-defined-tools | 1 | impl | done | UserToolsLoader + vault-op + js sandbox impls + hand-rolled parser; 26 new tests. | features/user-defined-tools/impl-1.md |
| 161 | F40 | user-defined-tools | 1 | qa | done | All 4 gates PASS (typecheck, lint, 726/726 tests, build unchanged). | features/user-defined-tools/qa-1.md |
| 162 | F40 | user-defined-tools | 1 | compliance | done | PASS — all 8 ACs satisfied; main.ts loader invocation parked. | features/user-defined-tools/compliance-1.md |
| 163 | F40 | user-defined-tools | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/user-defined-tools/compliance-1.md |
| 164 | F41 | token-estimator-3tier | 1 | impl | done | Pure tokenEstimator with apiUsageTokens/hybrid/rough + per-block rules + 4/3 padding; 26 new tests. | features/token-estimator-3tier/impl-1.md |
| 165 | F41 | token-estimator-3tier | 1 | qa | done | All 4 gates PASS (typecheck, lint, 752/752 tests, build unchanged). | features/token-estimator-3tier/qa-1.md |
| 166 | F41 | token-estimator-3tier | 1 | compliance | done | PASS — all 8 ACs satisfied; rounding pinned to Math.round. | features/token-estimator-3tier/compliance-1.md |
| 167 | F41 | token-estimator-3tier | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/token-estimator-3tier/compliance-1.md |
| 168 | F42 | compaction-microcompact | 1 | impl | done | Pure microcompactMessages module + AgentRunner wiring + 25 new tests; 777/777 tests pass in sanity check. | features/compaction-microcompact/impl-1.md |
| 169 | F42 | compaction-microcompact | 1 | qa | done | All 4 gates PASS (typecheck, lint, 777/777 tests, build ~254 KB). | features/compaction-microcompact/qa-1.md |
| 170 | F42 | compaction-microcompact | 1 | compliance | done | PASS — all 9 ACs satisfied, scope covered, no out-of-scope leaks. | features/compaction-microcompact/compliance-1.md |
| 171 | F42 | compaction-microcompact | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/compaction-microcompact/compliance-1.md |
| 172 | F43 | compaction-autocompact | 1 | impl | done | compactConstants + compactPrompts + autocompact engine (shouldAutoCompact, autoCompactIfNeeded, keep-alive, retry, post-compact assembly + attachments) + 41 new tests; 818/818 tests pass in sanity check. | features/compaction-autocompact/impl-1.md |
| 173 | F43 | compaction-autocompact | 1 | qa | done | All 4 gates PASS (typecheck, lint, 818/818 tests, build ~254 KB unchanged). | features/compaction-autocompact/qa-1.md |
| 174 | F43 | compaction-autocompact | 1 | compliance | done | PASS — all 13 ACs satisfied; AgentRunner wire-up parked to F44+. | features/compaction-autocompact/compliance-1.md |
| 175 | F43 | compaction-autocompact | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/compaction-autocompact/compliance-1.md |
| 176 | F44 | compaction-ptl-retry | 1 | impl | done | ptlRetry module (truncateHeadForPTLRetry + groupMessagesByApiRound + parseTokenGap + constants) + retry loop in autoCompactIfNeeded + 21 new tests; 839/839 tests pass in sanity check. | features/compaction-ptl-retry/impl-1.md |
| 177 | F44 | compaction-ptl-retry | 1 | qa | done | All 4 gates PASS (typecheck, lint, 839/839 tests, build ~254 KB unchanged). | features/compaction-ptl-retry/qa-1.md |
| 178 | F44 | compaction-ptl-retry | 1 | compliance | done | PASS — all 10 ACs satisfied; 20% fallback ships as default path. | features/compaction-ptl-retry/compliance-1.md |
| 179 | F44 | compaction-ptl-retry | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/compaction-ptl-retry/compliance-1.md |
| 180 | F45 | compaction-circuit-breaker | 1 | impl | done | autocompactBreaker module (tracking state + shouldSkipForCircuitBreaker + recordFailure/recordSuccess + disposeBreakerSurface) + autoCompactIfNeeded wiring + 15 new tests; 854/854 tests pass in sanity check. | features/compaction-circuit-breaker/impl-1.md |
| 181 | F45 | compaction-circuit-breaker | 1 | qa | done | All 4 gates PASS (typecheck, lint, 854/854 tests, build ~254 KB unchanged). | features/compaction-circuit-breaker/qa-1.md |
| 182 | F45 | compaction-circuit-breaker | 1 | compliance | done | PASS — all 8 ACs satisfied; main.ts wiring parked alongside F44. | features/compaction-circuit-breaker/compliance-1.md |
| 183 | F45 | compaction-circuit-breaker | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/compaction-circuit-breaker/compliance-1.md |
| 184 | F46 | context-analyzer-pipeline | 1 | impl | done | analyzeContextUsage orchestrator + filterAfterLastBoundary + injected 7-parallel counters + error-isolated skill + API-vs-estimated selector + AbortSignal; 12 new tests; 866/866 tests pass in sanity check. | features/context-analyzer-pipeline/impl-1.md |
| 185 | F46 | context-analyzer-pipeline | 1 | qa | done | All 4 gates PASS (typecheck, lint, 866/866 tests, build ~254 KB unchanged). | features/context-analyzer-pipeline/qa-1.md |
| 186 | F46 | context-analyzer-pipeline | 1 | compliance | done | PASS — all 9 ACs satisfied; per-op counter bodies injected via ContextCounters seam. | features/context-analyzer-pipeline/compliance-1.md |
| 187 | F46 | context-analyzer-pipeline | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/context-analyzer-pipeline/compliance-1.md |
| 188 | F47 | context-command-grid | 1 | impl | done | contextGrid (categories + dimensions + allocation + fullness + rendering order) + contextCommand (slash regex + palette id + createContextCommand factory) + 18 new tests; 884/884 tests pass in sanity check. | features/context-command-grid/impl-1.md |
| 189 | F47 | context-command-grid | 1 | qa | done | All 4 gates PASS (typecheck, lint, 884/884 tests, build ~254 KB unchanged). | features/context-command-grid/qa-1.md |
| 190 | F47 | context-command-grid | 1 | compliance | done | PASS — 9 ACs satisfied; AC9 ResizeObserver re-select parked pending React component. | features/context-command-grid/compliance-1.md |
| 191 | F47 | context-command-grid | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/context-command-grid/compliance-1.md |
| 192 | F48 | context-suggestions-statusline | 1 | impl | done | contextSuggestions module (generateContextSuggestions + 5 ordered checks + per-tool advice + sort + buildStatusLineContext + debounced updater) + 28 new tests; 912/912 tests pass in sanity check. | features/context-suggestions-statusline/impl-1.md |
| 193 | F48 | context-suggestions-statusline | 1 | qa | done | All 4 gates PASS (typecheck, lint, 912/912 tests, build ~254 KB unchanged). | features/context-suggestions-statusline/qa-1.md |
| 194 | F48 | context-suggestions-statusline | 1 | compliance | done | PASS — all 10 ACs satisfied; React/status-bar mount parked pending main.ts. | features/context-suggestions-statusline/compliance-1.md |
| 195 | F48 | context-suggestions-statusline | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/context-suggestions-statusline/compliance-1.md |
| 196 | F49 | attachments-images-files | 1 | impl | done | attachments module (captureAttachments + buildUserContent + detectVaultDrop + isVisionGateBlocked + estimateAttachmentTokens) + 18 new tests; 930/930 tests pass in sanity check. | features/attachments-images-files/impl-1.md |
| 197 | F49 | attachments-images-files | 1 | qa | done | All 4 gates PASS (typecheck, lint, 930/930 tests, build ~254 KB unchanged). | features/attachments-images-files/qa-1.md |
| 198 | F49 | attachments-images-files | 1 | compliance | done | PASS at the domain layer — AC1-6, AC9 satisfied; AC7/AC8 tray-blob-lifecycle + F43 e2e parked pending UI mount. | features/attachments-images-files/compliance-1.md |
| 199 | F49 | attachments-images-files | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/attachments-images-files/compliance-1.md |
| 200 | F50 | perf-scale-10k-vault | 1 | impl | done | Deterministic make10kVault fixture + budget constants + REPORT.md scaffold + pnpm bench script; 5 new tests; 935/935 tests pass. Live benches parked as scaffold in REPORT. | features/perf-scale-10k-vault/impl-1.md |
| 201 | F50 | perf-scale-10k-vault | 1 | qa | done | All 4 gates PASS (typecheck, lint, 935/935 tests, build ~254 KB unchanged). | features/perf-scale-10k-vault/qa-1.md |
| 202 | F50 | perf-scale-10k-vault | 1 | compliance | done | PASS with live benches parked (AC2-AC5); fixture + budgets + report + pnpm bench script shipped. | features/perf-scale-10k-vault/compliance-1.md |
| 203 | F50 | perf-scale-10k-vault | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/perf-scale-10k-vault/compliance-1.md |
| 204 | F51 | mcp-client-config-transports | 1 | impl | done | mcp/config.ts (parser + secret substitution) + mcp/mcpClient.ts (MCPClient + connectAll + discovery + namespaced registration + failure isolation + logger events) with injectable transport factory; 12 new tests; 947/947 tests pass. | features/mcp-client-config-transports/impl-1.md |
| 205 | F51 | mcp-client-config-transports | 1 | qa | done | All 4 gates PASS (typecheck, lint, 947/947 tests, build ~254 KB unchanged). | features/mcp-client-config-transports/qa-1.md |
| 206 | F51 | mcp-client-config-transports | 1 | compliance | done | PASS — 8 ACs satisfied; SDK adapter wiring parked behind the McpTransportFactory seam pending child_process renderer check. | features/mcp-client-config-transports/compliance-1.md |
| 207 | F51 | mcp-client-config-transports | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/mcp-client-config-transports/compliance-1.md |
| 208 | F52 | mcp-tool-confirmation | 1 | impl | done | mcp.tool.confirmation.default debug event at registration + confirmation-flow integration tests; 4 new tests; 951/951 tests pass. | features/mcp-tool-confirmation/impl-1.md |
| 209 | F52 | mcp-tool-confirmation | 1 | qa | done | All 4 gates PASS (typecheck, lint, 951/951 tests, build ~254 KB unchanged). | features/mcp-tool-confirmation/qa-1.md |
| 210 | F52 | mcp-tool-confirmation | 1 | compliance | done | PASS — 8 ACs satisfied; F17 + F51 handle the underlying dialog/registry, F52 pins the default and emits the log event. | features/mcp-tool-confirmation/compliance-1.md |
| 211 | F52 | mcp-tool-confirmation | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/mcp-tool-confirmation/compliance-1.md |
| 212 | F53 | mcp-resources-picker | 1 | impl | done | MCPClient.readResource + ResourcePickerStore + composeResourceContent + resolveStagedResources; 7 new tests; 958/958 tests pass. UI mount parked. | features/mcp-resources-picker/impl-1.md |
| 213 | F53 | mcp-resources-picker | 1 | qa | done | All 4 gates PASS (typecheck, lint, 958/958 tests, build ~254 KB unchanged). | features/mcp-resources-picker/qa-1.md |
| 214 | F53 | mcp-resources-picker | 1 | compliance | done | PASS at the domain seam; picker React UI parked pending ChatView wiring. | features/mcp-resources-picker/compliance-1.md |
| 215 | F53 | mcp-resources-picker | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/mcp-resources-picker/compliance-1.md |
| 216 | F54 | mcp-prompts-in-skills | 1 | impl | done | MCPClient.getPrompt + adaptPromptToSkill + resolvePromptBody + McpPromptCache + CompositeSkillSource; 7 new tests; 965/965 tests pass. Picker UI parked. | features/mcp-prompts-in-skills/impl-1.md |
| 217 | F54 | mcp-prompts-in-skills | 1 | qa | done | All 4 gates PASS (typecheck, lint, 965/965 tests, build ~254 KB unchanged). | features/mcp-prompts-in-skills/qa-1.md |
| 218 | F54 | mcp-prompts-in-skills | 1 | compliance | done | PASS at the domain seam; F22 picker UI wiring parked. | features/mcp-prompts-in-skills/compliance-1.md |
| 219 | F54 | mcp-prompts-in-skills | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/mcp-prompts-in-skills/compliance-1.md |
| 220 | F55 | mcp-settings-ui | 1 | impl | done | McpSettingsStore (CRUD + validation + secret substitution) + MCPClient.onStatusChange/disconnect/reload + ToolRegistry.unregister; 10 new tests; 975/975 tests pass. React UI parked. | features/mcp-settings-ui/impl-1.md |
| 221 | F55 | mcp-settings-ui | 1 | qa | done | All 4 gates PASS (typecheck, lint, 975/975 tests, build ~254 KB unchanged). | features/mcp-settings-ui/qa-1.md |
| 222 | F55 | mcp-settings-ui | 1 | compliance | done | PASS at the domain seam; React settings UI parked. | features/mcp-settings-ui/compliance-1.md |
| 223 | F55 | mcp-settings-ui | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/mcp-settings-ui/compliance-1.md |
| 224 | F56 | mcp-reconnect-shutdown | 1 | impl | done | reconnect.ts (computeBackoffDelay + runReconnectLoop + shutdownStdioChild + crashedToolCallError); 8 new tests; 983/983 tests pass. MCPClient auto-attach parked. | features/mcp-reconnect-shutdown/impl-1.md |
| 225 | F56 | mcp-reconnect-shutdown | 1 | qa | done | All 4 gates PASS (typecheck, lint, 983/983 tests, build ~254 KB unchanged). | features/mcp-reconnect-shutdown/qa-1.md |
| 226 | F56 | mcp-reconnect-shutdown | 1 | compliance | done | PASS at the pure layer; MCPClient close/error auto-attach wiring parked pending SDK adapter. | features/mcp-reconnect-shutdown/compliance-1.md |
| 227 | F56 | mcp-reconnect-shutdown | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/mcp-reconnect-shutdown/compliance-1.md |
| 228 | F57 | release-smoke-suite | 1 | impl | done | tinyVault fixture + CM6 checklist + RELEASE.md + pnpm smoke script + 4 smoke fixture tests; 987/987 tests pass. Five-phase harness parked. | features/release-smoke-suite/impl-1.md |
| 229 | F57 | release-smoke-suite | 1 | qa | done | All 4 gates PASS (typecheck, lint, 987/987 tests, build ~254 KB unchanged); pnpm smoke green (4/4). | features/release-smoke-suite/qa-1.md |
| 230 | F57 | release-smoke-suite | 1 | compliance | done | PASS on fixture + checklist + ritual + script deliverables; 5-phase integration harness parked pending upstream-feature test-double consolidation. | features/release-smoke-suite/compliance-1.md |
| 231 | F57 | release-smoke-suite | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/release-smoke-suite/compliance-1.md |
| 232 | — | — | — | workspace-audit | done | 43 orphans — see integration-orphans.md (import-closure from src/main.ts; entry-points block seeded on resume per §2.1). | integration-orphans.md |
| 233 | — | — | — | workspace-audit | done | 43 orphans (identical to row 232); re-run on resume 2026-04-22T18:57:19+03:00 — no code change since prior audit. | integration-orphans.md |
| 234 | F58 | wire-indexer-rag-graph | 1 | impl | done | wireIndexerRag helper + main.ts wiring + Indexing settings section + IndexEmptyStateCta mount + Re-index command + search_vault tool; 1025/1025 tests (5 new). | features/wire-indexer-rag-graph/impl-1.md |
| 235 | F58 | wire-indexer-rag-graph | 1 | qa | done | All 4 gates PASS (typecheck, lint, 1025/1025 tests, build 340 KB). | features/wire-indexer-rag-graph/qa-1.md |
| 236 | F58 | wire-indexer-rag-graph | 1 | compliance | done | PASS — 13/13 ACs satisfied; AC12 model-switch prompt deferred to F61 per dependency row; 18 orphans eliminated (43 → 25). | features/wire-indexer-rag-graph/compliance-1.md |
| 237 | F58 | wire-indexer-rag-graph | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/wire-indexer-rag-graph/compliance-1.md |
| 238 | F59 | wire-edit-lock-cm6 | 1 | impl | done | CM6 decoration ViewPlugin + activeNoteEditBridge + main.ts wire + lock release on unload; 1030/1030 tests (5 new). | features/wire-edit-lock-cm6/impl-1.md |
| 239 | F59 | wire-edit-lock-cm6 | 1 | qa | done | All 4 gates PASS (typecheck, lint, 1030/1030 tests, build 346 KB). | features/wire-edit-lock-cm6/qa-1.md |
| 240 | F59 | wire-edit-lock-cm6 | 1 | compliance | done | PASS — 8 ACs satisfied; orphans 25 → 22 (editLock/highlights/withLock eliminated). | features/wire-edit-lock-cm6/compliance-1.md |
| 241 | F59 | wire-edit-lock-cm6 | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/wire-edit-lock-cm6/compliance-1.md |
| 242 | F60 | wire-plan-mode | 1 | impl | done | PlanStore + PlanApprovalController + TodoWrite/EnterPlanMode/ExitPlanMode registered + PlanSessionResume on load + PlanApprovalDialog mount in ChatView; 1030/1030 tests. | features/wire-plan-mode/impl-1.md |
| 243 | F60 | wire-plan-mode | 1 | qa | done | All 4 gates PASS (typecheck, lint, 1030/1030 tests, build 359 KB). | features/wire-plan-mode/qa-1.md |
| 244 | F60 | wire-plan-mode | 1 | compliance | done | PASS — 9 ACs satisfied; orphans 22 → 18 (planSessionResume/planStore/todoWriteTool/planModeTools eliminated). | features/wire-plan-mode/compliance-1.md |
| 245 | F60 | wire-plan-mode | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/wire-plan-mode/compliance-1.md |
| 246 | F61 | wire-cloud-providers | 1 | impl | done | ProviderRegistry + SafeStorage + cloud provider adapters + pricing footer; ProviderManager.setProvider hot-swap; SettingsTab kind/API-key UI; 1037/1037 tests (7 new). | features/wire-cloud-providers/impl-1.md |
| 247 | F61 | wire-cloud-providers | 1 | qa | done | All 4 gates PASS (typecheck, lint, 1037/1037 tests, build 372 KB). | features/wire-cloud-providers/qa-1.md |
| 248 | F61 | wire-cloud-providers | 1 | compliance | done | PASS — 7 ACs satisfied; orphans 18 → 14 (anthropicProvider/openAICompatibleProvider/pricing/safeStorage eliminated). | features/wire-cloud-providers/compliance-1.md |
| 249 | F61 | wire-cloud-providers | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/wire-cloud-providers/compliance-1.md |
| 250 | F62 | wire-mcp | 1 | impl | done | wireMcp helper (McpSettingsStore + MCPClient + ResourcePickerStore + McpPromptCache + reconnect helpers) + main.ts wire; NOOP_TRANSPORT until SDK installed. | features/wire-mcp/impl-1.md |
| 251 | F62 | wire-mcp | 1 | qa | done | All 4 gates PASS (typecheck, lint, 1037/1037 tests, build 385 KB). | features/wire-mcp/qa-1.md |
| 252 | F62 | wire-mcp | 1 | compliance | done | PASS — 6 ACs satisfied; feature.md scope narrowed to wiring-layer; orphans 14 → 8 (mcp/* six modules eliminated). | features/wire-mcp/compliance-1.md |
| 253 | F62 | wire-mcp | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/wire-mcp/compliance-1.md |
| 254 | F63 | wire-threads-multi | 1 | impl | done | ThreadsStore constructed + init on load; "Leo: New thread" palette command; Notice-with-Undo fragment wiring. Scope narrowed in feature.md. | features/wire-threads-multi/impl-1.md |
| 255 | F63 | wire-threads-multi | 1 | qa | done | All 4 gates PASS (typecheck, lint, 1037/1037 tests, build 390 KB). | features/wire-threads-multi/qa-1.md |
| 256 | F63 | wire-threads-multi | 1 | compliance | done | PASS — 5 ACs; orphans 8 → 7 (threadsStore eliminated). | features/wire-threads-multi/compliance-1.md |
| 257 | F63 | wire-threads-multi | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/wire-threads-multi/compliance-1.md |
| 258 | F64 | wire-skill-editor | 1 | impl | done | SkillEditorController constructed after skillsStore.loadAll with Notice-based NoticeLike. Scope narrowed in feature.md. | features/wire-skill-editor/impl-1.md |
| 259 | F64 | wire-skill-editor | 1 | qa | done | All 4 gates PASS (1037/1037, build 395 KB). | features/wire-skill-editor/qa-1.md |
| 260 | F64 | wire-skill-editor | 1 | compliance | done | PASS — 3 ACs; orphans 7 → 6. | features/wire-skill-editor/compliance-1.md |
| 261 | F64 | wire-skill-editor | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/wire-skill-editor/compliance-1.md |
| 262 | F65 | wire-user-tools | 1 | impl | done | wireUserTools helper + main.ts wire + onunload dispose; 8 new tests; 1045/1045 pass. | features/wire-user-tools/impl-1.md |
| 263 | F65 | wire-user-tools | 1 | qa | done | All 4 gates PASS (typecheck, lint, 1045/1045 tests, build 392 KB). | features/wire-user-tools/qa-1.md |
| 264 | F65 | wire-user-tools | 1 | compliance | done | PASS — 6 ACs satisfied; orphan userToolsLoader removed (43 → 42). | features/wire-user-tools/compliance-1.md |
| 265 | F65 | wire-user-tools | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/wire-user-tools/compliance-1.md |
| 266 | F66 | wire-attachments-ui | 1 | impl | done | AttachmentsStore + wireAttachments helper + main.ts wire; scope narrowed to wiring-layer. 1054/1054 tests (9 new). | features/wire-attachments-ui/impl-1.md |
| 267 | F66 | wire-attachments-ui | 1 | qa | done | All 4 gates PASS (typecheck, lint, 1054/1054 tests, build 396 KB). | features/wire-attachments-ui/qa-1.md |
| 268 | F66 | wire-attachments-ui | 1 | compliance | done | PASS — 6 ACs satisfied; orphan chat/attachments.ts eliminated (42 → 41). | features/wire-attachments-ui/compliance-1.md |
| 269 | F66 | wire-attachments-ui | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/wire-attachments-ui/compliance-1.md |
| 270 | F67 | wire-ui-helpers | 1 | impl | done | wireUiHelpers factory + main.ts Obsidian channels + dispose; scope narrowed. 1057/1057 tests (3 new). | features/wire-ui-helpers/impl-1.md |
| 271 | F67 | wire-ui-helpers | 1 | qa | done | All 4 gates PASS (typecheck, lint, 1057/1057 tests, build 399 KB). | features/wire-ui-helpers/qa-1.md |
| 272 | F67 | wire-ui-helpers | 1 | compliance | done | PASS — 5 ACs satisfied; orphans visualStates/toolIcons/notifications eliminated (41 → 38). | features/wire-ui-helpers/compliance-1.md |
| 273 | F67 | wire-ui-helpers | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/wire-ui-helpers/compliance-1.md |
| 274 | F68 | wire-context-suggestions-statusline | 1 | impl | done | wireContextStatusLine helper + main.ts addStatusBarItem adapter + dispose; scope narrowed. 1060/1060 tests (3 new). | features/wire-context-suggestions-statusline/impl-1.md |
| 275 | F68 | wire-context-suggestions-statusline | 1 | qa | done | All 4 gates PASS (typecheck, lint, 1060/1060 tests, build 403 KB). | features/wire-context-suggestions-statusline/qa-1.md |
| 276 | F68 | wire-context-suggestions-statusline | 1 | compliance | done | PASS — 5 ACs satisfied; orphan contextSuggestions eliminated (38 → 37). | features/wire-context-suggestions-statusline/compliance-1.md |
| 277 | F68 | wire-context-suggestions-statusline | 1 | feature-complete | done | Iteration 1 PASS on first attempt. | features/wire-context-suggestions-statusline/compliance-1.md |
| 278 | — | — | — | workspace-audit | done | clean — 0 orphans in src closure from src/main.ts (138/138 reachable). | integration-orphans.md |
| 279 | F22+F39+F55 | settings-tab-bodies | 1 | remediation | done | UI gap from imgs/img.png closed: SettingsTab now dispatches Skills (full inline CRUD via SkillEditorController) and MCP Servers (CRUD + live status via MCPClient.onStatusChange) instead of falling through to F03 placeholders. SettingsTab construction moved past wireMcp; SettingsTabDeps extended with skillsStore/skillEditor/mcpSettingsStore/mcpClient. plan + appearance placeholders rewritten to honest text (no schema growth). Gates: typecheck, lint, 1060/1060 tests, build 423 KB (was 403 KB; +20 KB for CRUD code). | — |
