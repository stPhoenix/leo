# Project Structure

```
leo/
├── .agent/
│   ├── architecture/
│   │   └── architecture.md              # Module map, contracts, data flows
│   ├── budgets/
│   │   └── bundle-baseline.json         # main.js size baseline + maxDeltaBytes for `pnpm check:bundle`
│   ├── features/
│   │   ├── arch-alignment_plan_20260424-005915/
│   │   ├── external-agent_slice_20260427-022536/  # Sliced feature planning workspace for external-agent delegation (F01–F13)
│   │   ├── leo_slice_20260419-190449/   # Sliced feature planning workspace (per-feature docs)
│   │   ├── livestatus_plan_20260425-185758/
│   │   └── wiki_slice_20260429-014102/  # Sliced feature planning workspace for wiki ingest/lint/search slice
│   ├── scripts/
│   │   └── precommit.md                 # Precommit runbook
│   ├── srs/
│   │   ├── compact.md
│   │   ├── context.md
│   │   ├── external-agent.md            # External-agent delegation SRS (subgraph + adapters + widget)
│   │   ├── leo-wiki.md                  # Leo + wiki integration SRS
│   │   ├── livestatus.md
│   │   ├── plan.md
│   │   ├── skill-doc.md
│   │   ├── srs.md                       # Software requirements spec
│   │   ├── toolsearch.md                # ToolSearch (deferred-tool fetcher) SRS
│   │   └── wiki.md                      # Wiki slice SRS (ingest pipeline, lint, search, inbox)
│   └── standards/
│       ├── best-practices.md
│       ├── code-style.md
│       ├── project-structure.md         # This file
│       └── tech-stack.md
├── src/
│   ├── agent/                           # Agent loop, compaction, plan mode, todo, context assembly, graph + streaming events
│   │   ├── externalAgent/                # External-agent delegation subgraph (F01–F13 slice): adapter contract, refine sub-agent, FSM driver, slot-per-thread, result writer, widget controller, terminal snapshot, logging
│   │   │   ├── adapters/
│   │   │   │   ├── base.ts               # ExternalAgentAdapter abstract class + ExternalEvent discriminated union (log/text/file/done/error) + AdapterCapabilities — adapter-only ESLint isolation enforced
│   │   │   │   └── inlineAgent/tools/    # Inline-Agent network/sanitize helpers (`fetch_url` + `search_web` hardening — SSRF/DNS-rebind + prompt-injection envelope)
│   │   │   │       ├── ipGuard.ts        # parseIp (v4/v6 incl. IPv4-mapped + brackets), cidrContains (v4 + v6, prefix>64), isPrivateOrLoopbackIp (RFC1918/CGNAT/link-local/IPv6 ULA/loopback/64:ff9b::/96), resolveAndCheck (Electron renderer `globalThis.require('dns').promises.lookup` — fail-closed when require unavailable; previous `import('node:dns/promises')` broke in CJS bundle)
│   │   │   │       ├── sanitize.ts       # stripInvisible (zero-width + bidi controls), stripHtmlScriptStyleComments, sanitizeBody(body, contentType?) — html-strip only when text/html
│   │   │   │       └── untrustedWrap.ts  # wrapUntrusted(text, origin) → `<untrusted-content origin="…">…</untrusted-content>` (escapes nested close, scrubs origin); wrapToolResultForLLM(name, result) maps fetch_url body + search_web answer/per-row content
│   │   │   ├── adapterRegistry.ts        # AdapterRegistry — register/freeze/list (alphabetical)/get/defaultId/isEnabled
│   │   │   ├── applyPiiDecisions.ts      # applyPiiDecisions(text, findings, decisions) — splice mask/remove per finding (right-to-left walk to keep offsets valid); maskTokenFor(kind) returns per-kind mask token (`[email]`, `[api-key]`, …)
│   │   │   ├── liveControllerRegistry.ts # In-memory map<runId, ExternalAgentWidgetController> bridging serialized widget block props ↔ live controller; EXTERNAL_AGENT_LIVE_KIND
│   │   │   ├── loggingNamespaces.ts      # EXTERNAL_AGENT_LOG namespace tree + SENSITIVE_FIELD_KEYS — adapter/maintainer reference + lint policy declaration
│   │   │   ├── orchestrator.ts           # ExternalAgentOrchestrator — start({threadId,…}) → {ok,handle,terminal} | {ok:false,busy}, liveHandles map, persistSnapshot callback wiring; optional `beginTrace` constructor opt forwarded to subgraph deps for Langfuse export
│   │   │   ├── piiDetectAgent.ts         # PiiDetectAgent — chunked LLM-based privacy scan (PiiKind union: email/phone/governmentId/paymentCard/apiKey/jwt/iban/ipAddress/urlWithAuth/other); detect(text, signal) → readonly PiiFinding[] via main-assistant provider with bounded chunks + parallelism + report_findings tool call
│   │   │   ├── piiDetectPrompt.ts        # getPiiDetectSystemPrompt() — snapshot system prompt for the PII detection sub-agent (forces single `report_findings` tool call, verbatim spans, no prose)
│   │   │   ├── refinePrompt.ts           # Pure getRefineSystemPrompt() snapshot
│   │   │   ├── refineSubAgent.ts         # createRefineSubAgent({provider,model,…}) — REFINE_TOOLS (emit_final_prompt / ask_clarifying_question), parses tool calls, throws refine_invalid_tool / refine_prompt_too_large; refine input accepts optional `traceConfig` → ProviderChatRequest.trace for Langfuse export
│   │   │   ├── resultWriter.ts           # ResultWriter.write({runId,threadId,adapterId,…}) — sanitizeRelPath, buildRequestMarkdown, EXTERNAL_AGENT_RESULTS_PREFIX
│   │   │   ├── runId.ts                  # generateRunId({now,tail}) → YYYYMMDD-HHmmss-<6-char>
│   │   │   ├── runPhase.ts               # buildToolResult(state,…) terminal→DelegateExternalToolResult; createResultWriterDeps; SUMMARY_MAX_CHARS
│   │   │   ├── slotManager.ts            # Per-thread one-slot concurrency: acquire/release/active
│   │   │   ├── state.ts                  # ExternalAgentState, ExternalPhase, applyExternalEvent, isTerminal, TERMINAL_PHASES
│   │   │   ├── subgraph.ts               # startExternalAgentRun(deps,input)→RunHandle — hand-rolled FSM driver, abort/timeout race, refine→ready→running→writing→terminal; optional `beginTrace({runId,threadId})` deps factory threads `traceConfig` into refine and `end()`s exactly once on terminal phase (BeginExternalAgentTrace + ExternalAgentTraceHandle types)
│   │   │   ├── terminalSnapshot.ts       # TerminalSnapshotSchema (Zod, schemaVersion:1) + buildTerminalSnapshot + filterSecretFields + tryParseTerminalSnapshot + EXTERNAL_AGENT_WIDGET_KIND
│   │   │   └── widgetController.ts       # ExternalAgentWidgetController({runId,threadId,…}) — viewModel(), onSelectAdapter/SetTimeout/SetBudget/AnswerClarification/Send/Edit/Cancel; reload rehydration to error.code='reload'
│   │   ├── toolSearch/                   # Deferred-tool fetcher — assemble fetch requests, model-gating, result→tool-list mapping, per-thread session
│   │   │   ├── assembleToolRequest.ts
│   │   │   ├── modelGating.ts
│   │   │   ├── toolResultMapper.ts
│   │   │   └── toolSearchSession.ts
│   │   ├── wiki/                         # Wiki slice — ingest pipeline, lint, search, inbox; mutex-gated single-active-op; widget + status + paths + logging
│   │   │   ├── inbox/
│   │   │   │   └── parse.ts                 # wiki-inbox.md pipe-table parser/serializer (cols `Source | Status | Note`, status `open|done|error`); appendRow seeds header when missing; annotateErrorOnRef flips row→error and appends `error: <code>: <msg>` into Note; round-trips non-table lines verbatim
│   │   │   ├── ingest/                   # Hand-rolled FSM ingest pipeline: refine → fetch/persist → plan → extract → reduce → write
│   │   │   │   ├── duplicateDetect.ts
│   │   │   │   ├── duplicatePrompt.ts
│   │   │   │   ├── fetchSource.ts          # fetchIngestSource entrypoint + per-kind fetchers (url/vaultPath/attachment/conversation/inbox); folder paths return distinct `fetch_vault_not_file`; missing → `fetch_vault_missing`
│   │   │   │   ├── inboxBatch.ts            # runInboxBatch(threadId, signal, deps, providerOverride?) — drain wiki-inbox.md sources sequentially with shared override
│   │   │   │   ├── llmAdapter.ts          # createLlmJsonInvoker — bindTools(tool_choice:'auto') + RunnableLambda extract + .withRetry({stopAfterAttempt:4}); LM Studio qwen3.6 reasoning_content workaround
│   │   │   │   ├── persistRaw.ts
│   │   │   │   ├── processSource.ts        # processSourceFetchPersist — fetch → dedupe → persist; logs `wiki.ingest.fetch.failed` with kind+code+ref+message for diagnostics
│   │   │   │   ├── refine.ts
│   │   │   │   ├── runBatched.ts          # Semaphore-bounded Promise.all worker (per-item failures don't abort batch)
│   │   │   │   ├── schemas.ts             # PageOp, ExtractorOutput, ReducerOutput, PlannerOutput Zod schemas
│   │   │   │   ├── semaphore.ts
│   │   │   │   ├── sha256.ts
│   │   │   │   ├── slug.ts
│   │   │   │   ├── subagents.ts           # runPlanner/runExtractor/runReducer + invokeStructured (single try/catch — withRetry lives in llmAdapter chain)
│   │   │   │   ├── subgraph.ts            # startIngestRun — LangGraph StateGraph (Annotation.Root, MemorySaver, interrupt for duplicate prompt); abort/timeout race; mutex acquire/release; optional `traceConfig {callbacks?,metadata?,tags?}` on deps merged into LangGraphRunnableConfig (callbacks/metadata/tags) so node-internal model.invoke calls export to Langfuse
│   │   │   │   ├── types.ts
│   │   │   │   └── writer.ts
│   │   │   ├── lint/                     # Wiki page lint pipeline (scan → check → propose → confirm → write)
│   │   │   │   ├── checkers.ts            # runLlmChecker + tryProposeSchemaPatch (single-call invoke; retry inside llmAdapter chain)
│   │   │   │   ├── markdownPatch.ts       # applyMarkdownPatch(currentBody, patch) — splitFrontmatter + stripSourcesSection + section-range scan, supports replace_section/replace_body kinds with body-size drift guard (REPLACE_BODY_DRIFT_THRESHOLD=0.5); typed ApplyMarkdownPatchFailReason union (`section_not_found`/`unsupported_kind`/`invalid_input`/`body_size_drift`)
│   │   │   │   ├── scan.ts
│   │   │   │   ├── schemas.ts
│   │   │   │   └── subgraph.ts            # startLintRun — LangGraph StateGraph (Annotation.Root, MemorySaver, interrupt for confirm); abort/timeout race; mutex acquire/release; optional `traceConfig` on deps merged into LangGraphRunnableConfig for Langfuse export (same shape as ingest)
│   │   │   ├── seed/
│   │   │   │   ├── introduction.ts
│   │   │   │   └── schema.ts
│   │   │   ├── bootstrap.ts                 # bootstrapWiki — seeds wiki/ tree + wiki-inbox.md (with pipe-table header `| Source | Status | Note |`), registers default RAG excludes (`wiki/**` via ensureDefaultPrefix + literal `wiki-inbox.md` via ensureDefaultPattern); idempotent
│   │   │   ├── budgets.ts                 # WIKI_BUDGETS + resolveWikiBudgets (dynamic factory by contextWindow + maxOutputTokens) + WIKI_RUN_DEFAULTS
│   │   │   ├── indexReader.ts
│   │   │   ├── liveControllerRegistry.ts  # Map<runId, WikiWidgetController> bridging serialized live blocks ↔ controller
│   │   │   ├── loggingNamespaces.ts       # WIKI_LOG namespace tree + WIKI_SENSITIVE_FIELD_KEYS (rawBody/extractorOutput/etc — no info+ logs)
│   │   │   ├── mutex.ts                   # WikiMutex — per-vault single-op gate (ingest|lint), busy with activeOp/runId
│   │   │   ├── mutexTypes.ts
│   │   │   ├── paths.ts                   # WIKI_SCHEMA_PATH, WIKI_INDEX_PATH, WIKI_RAW_DIR, WIKI_PAGES_DIR, WIKI_SOURCES_DIR, WIKI_LOG_PATH
│   │   │   ├── runIdRegistry.ts
│   │   │   ├── searchWarning.ts
│   │   │   ├── terminalSnapshot.ts        # Wiki terminal snapshot Zod schema + builder for reload rehydration
│   │   │   ├── restrictedVaultAdapter.ts  # Path-restricted VaultAdapter wrapper for wiki workflows — SandboxViolation, normalizePath, createWikiSandbox (allowlist `wiki/**` + `externalAgentResults/**` + `wiki-inbox.md`), restrictedVaultAdapter proxy (rename/copy dual-check, list filter)
│   │   │   ├── widgetController.ts        # WikiWidgetController(runId, threadId, op) — viewModel + setPhase/update/recordError/resolveDuplicate/answerClarification + startConfigPhase (provider/model picker pre-run) → onSelectProvider/onSelectModel/onConfirm/onCancel/onRetryLoadModels
│   │   │   ├── widgetState.ts             # WikiPhase union (incl. `awaiting_config`) + WikiViewModel + WikiConfigDraft + WikiModelsState + TERMINAL_WIKI_PHASES + isTerminal
│   │   │   └── wikiStatus.ts              # Wiki status snapshot for /wiki widget
│   │   ├── acceptRejectController.ts
│   │   ├── agentRunner.ts
│   │   ├── autocompact.ts
│   │   ├── autocompactBreaker.ts
│   │   ├── clarifyingQuestionController.ts # Promise-based main-agent clarifying-question controller backing AskUserQuestion (mirrors PlanApprovalController: present()/resolve()/subscribe(); single-pending semantics; outcomes answer | answerMulti | cancel)
│   │   ├── compactConstants.ts
│   │   ├── compactPrompts.ts
│   │   ├── confirmationController.ts
│   │   ├── contextAnalyzer.ts
│   │   ├── contextAssembler.ts             # System-prompt assembler — prepends LEO_PREAMBLE + PLAN_MODE_RULE to systemParts, then activeNote + RAG hits; renderPrompt emits one system msg per turn
│   │   ├── contextSnapshotStore.ts       # Reactive cached ContextData (debounced refresh, abort-aware) shared by /context widget + HeaderStat
│   │   ├── graph.ts
│   │   ├── messageBreakdown.ts           # Pure: per-message-type token tally (toolCall/toolResult/attachment/assistantText/userText) — SRS §6.6
│   │   ├── microcompact.ts
│   │   ├── planApprovalController.ts
│   │   ├── planModeController.ts           # Per-thread plan/normal mode FSM, allowlist gate (read tools + TodoWrite + AskUserQuestion + open_note + reveal_in_note + ExitPlanMode), buildPlanEnterReminder(planFilePath) + buildStaleTodoReminder(todos) + PLAN_EXIT_REMINDER, subscribe(cb) for reactive UI
│   │   ├── planSessionResume.ts
│   │   ├── ptlRetry.ts
│   │   ├── skillTokenCount.ts            # Pure: skill frontmatter token counter (name+description+whenToUse+systemPrompt)
│   │   ├── streamEvents.ts
│   │   ├── todoStore.ts
│   │   ├── tokenCount.ts
│   │   ├── tokenEstimator.ts
│   │   ├── toolTokenCount.ts             # Pure: tool descriptor token counter with -500/tool overhead per SRS §5.3
│   │   ├── truncator.ts
│   │   └── types.ts                       # LEO_PREAMBLE + PLAN_MODE_RULE always-on system-prompt segments; ThreadId, AgentHistoryMessage, RagHit, AssembledPrompt typings
│   ├── chat/                            # Chat message store, streaming, attachments, usage, diff, run state, group read-only
│   │   ├── attachments.ts
│   │   ├── attachmentsStore.ts
│   │   ├── contextBridge.ts             # ChatMessageRecord[] → analyzer inputs (preserve blocks; mirror record.tokens to estimator usage shape)
│   │   ├── diff.ts
│   │   ├── groupReadOnly.ts
│   │   ├── messageStore.ts
│   │   ├── runStateStore.ts
│   │   ├── streamingController.ts
│   │   ├── tokenUsage.ts
│   │   ├── types.ts
│   │   └── wireAttachments.ts
│   ├── editor/                          # CM6 edit lock, editor bridge, focused context, highlights, workspace navigation
│   │   ├── activeNoteEditBridge.ts
│   │   ├── cm6LockDecoration.ts
│   │   ├── editLock.ts
│   │   ├── editorBridge.ts
│   │   ├── focusedContext.ts
│   │   ├── focusedContextChannel.ts
│   │   ├── highlights.ts
│   │   ├── types.ts
│   │   ├── withLock.ts
│   │   ├── workspaceFocusProbe.ts
│   │   └── workspaceNavigator.ts        # WorkspaceNavigator adapter — open/reveal a note in a leaf, set cursor/selection, fire 3s flash highlight
│   ├── graph/
│   │   └── GraphCache.ts                # Link graph cache
│   ├── indexer/                         # Vault + canvas chunking, dirty queue, reindex
│   │   ├── CanvasChunker.ts
│   │   ├── chunker.ts
│   │   ├── chunkIteration.ts
│   │   ├── dirtyQueue.ts
│   │   ├── indexHeader.ts
│   │   ├── indexerStatusBar.ts
│   │   ├── indexerStatusTap.ts          # Read-only DrainListener tap exposing latest IndexerStatusSnapshot for /rag widget
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
│   ├── platform/                        # Logger, sinks, error channel, langfuse tracer, langgraph ALS init
│   │   ├── asyncLocalStorageInit.ts     # Side-effect: init AsyncLocalStorage for langgraph interrupts in browser bundle
│   │   ├── Logger.ts
│   │   ├── logTypes.ts
│   │   ├── obsidianSinkFs.ts
│   │   ├── obsidianUserErrorChannel.ts
│   │   ├── rotatingFileSink.ts
│   │   └── tracer.ts                    # TracerService — per-thread Langfuse trace, per-turn span
│   ├── providers/                       # LLM + embedding providers, langchain bridge, content normalization, manager, registry, trace config
│   │   ├── anthropicFetchPatch.ts        # Fetch wrapper for ChatAnthropic — beta header/headers injection (cache-control, prompt-caching) + retry shaping
│   │   ├── anthropicProvider.ts
│   │   ├── connectionState.ts
│   │   ├── contentNormalize.ts          # OpenAI-compatible normalizer: inline document blocks as text (images pass through; provider/server is vision authority)
│   │   ├── embeddingClient.ts
│   │   ├── langchainMessages.ts
│   │   ├── langchainStream.ts            # AIMessageChunk → StreamEvent bridge — emits text/tool_use plus thinking blocks (content[].type 'thinking'/'reasoning'/'redacted_thinking' + additional_kwargs.reasoning_content), drains all open blocks on error
│   │   ├── lmStudioProvider.ts
│   │   ├── openAICompatibleProvider.ts     # OpenAI-compatible factory + concrete builders: createOpenAIProvider / createOllamaProvider (local) / createOllamaCloudProvider (Bearer apiKey, default endpoint `https://ollama.com`) / createCustomProvider
│   │   ├── providerManager.ts
│   │   ├── registry.ts                     # ProviderKind switchboard (`lmstudio | openai | anthropic | ollama | ollama-cloud | custom`) — createProviderForKind, defaultEndpointFor, kindRequiresApiKey (openai/anthropic/ollama-cloud/custom)
│   │   ├── traceConfig.ts               # ProviderTraceContext → LangChain RunnableConfig
│   │   └── types.ts
│   ├── rag/                             # RAG engine, graph traversal, scoring, exclude/tag matchers
│   │   ├── excludeMatcher.ts
│   │   ├── GraphTraversal.ts
│   │   ├── ragEngine.ts
│   │   ├── ragSnapshot.ts               # Pure abortable RagSnapshot collector (vector store + indexer + graph + exclude) for /rag widget
│   │   ├── scorer.ts
│   │   └── tagMatcher.ts
│   ├── settings/                        # Settings tab, wizard, commands, exclude store, external-agents section
│   │   ├── commands.ts
│   │   ├── excludeListStore.ts            # ExcludeListStore — user patterns + runtime defaults (Set<string>); ensureDefaultPrefix(prefix) appends `<prefix>/**`, ensureDefaultPattern(pattern) adds literal (e.g. `wiki-inbox.md`); defaults survive set() merges
│   │   ├── externalAgentResolver.ts      # effectiveDefaultAdapterId + resolveAdapterConfig (walks `safeStorage:` indirection) + describeConfigSchema (Zod 4 introspection: string/secret/number/boolean/array/object)
│   │   ├── ExternalAgentsSection.tsx     # Settings UI: header + global-default dropdown (enabled-only) + per-adapter blocks with enable toggle + auto-generated form (SecretField writes via SafeStorage)
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
│   ├── storage/                         # Filesystem-backed stores via VaultAdapter (vectors, conversations, threads, plans, safeStorage)
│   │   ├── conversationSchema.ts
│   │   ├── conversationStore.ts
│   │   ├── planStore.ts                  # Slug-per-sessionId Map<sessionId,slug>; currentSlug/writePlan/readPlan/resetSlug/setSlug all take sessionId; path-traversal guard on configuredDir; default `.leo/plans`
│   │   ├── safeStorage.ts
│   │   ├── threadsStore.ts
│   │   ├── vaultAdapter.ts                # VaultAdapter contract + Obsidian wrapper; VaultStat = {mtimeMs, size, kind?: 'file'|'folder'} (kind passed through from raw `Stat.type`)
│   │   └── vectorStore.ts                 # In-memory map persisted as single JSON file (`.leo/index/vectors/index.json`) via VaultAdapter; atomic tmp+rename writes with stale-tmp recovery; CorruptIndexError reasons (`open-failed`/`missing-store`/`version-mismatch`/`dim-mismatch`/`shape-invalid`); schemaVersion=1; subscribe() emits corruption events
│   ├── tools/                           # Tool registry + builtin + user tool loader + zod adapter
│   │   ├── builtin/
│   │   │   ├── appendToNote.ts
│   │   │   ├── askUserQuestion.ts        # AskUserQuestion tool — schema {question, header?, options?[2..4], multiSelect?}; isReadOnly, forbidden in subagent; routes to ClarifyingQuestionController; allowed in plan mode
│   │   │   ├── createFolder.ts
│   │   │   ├── createNote.ts
│   │   │   ├── delegateExternal.ts       # delegate_external tool — schema enforces 1–16384 char ask, owns own confirmation (requiresConfirmation:false), wraps DelegateExternalToolResult in {ok:true,data:…} so structured payload survives serializer
│   │   │   ├── delegateWikiIngest.ts     # delegate_wiki_ingest tool — flat hand-authored JSON Schema (required `kind` enum + flat per-kind fields, no oneOf/anyOf); pre-picker folder fan-out (vault.stat → recursive .md walk capped at VAULT_FOLDER_FANOUT_MAX=50, sorted) returns N sources via single startRun; sandbox-validated vaultPath; busy returns activeOp
│   │   │   ├── delegateWikiLint.ts       # delegate_wiki_lint tool — flat hand-authored JSON Schema (optional scope object with required kind enum `all|pages|orphans` + optional glob); mutex-gated
│   │   │   ├── deleteFolder.ts           # delete_folder tool — empty-only (errors `folder not empty` on non-empty), pre-confirm via AcceptRejectController (accept→rmdir, reject→no-op); blocked in plan mode
│   │   │   ├── editNote.ts
│   │   │   ├── globVault.ts             # glob_vault tool — minimatch-based vault file enumeration with cap + truncation
│   │   │   ├── grepVault.ts             # grep_vault tool — regex search across vault with content/files/count modes + context lines
│   │   │   ├── inboxAdd.ts               # inbox_add tool — append source ref as a new row in the wiki-inbox.md pipe-table (`Source | Status | Note`); read-only wrt wiki content, no confirmation
│   │   │   ├── listNotes.ts
│   │   │   ├── openNote.ts              # open_note tool — open or reveal a note in an Obsidian leaf
│   │   │   ├── readFile.ts              # Generic any-file reader with binary detection + offset/limit + maxBytes cap
│   │   │   ├── readFileShared.ts        # Shared helpers — byteLength, looksBinary, range-read primitives
│   │   │   ├── readFileState.ts         # ReadFileStateStore — tracks last-read mtime/range per path for write freshness guard
│   │   │   ├── readNote.ts
│   │   │   ├── revealInNote.ts          # reveal_in_note tool — open + cursor/select + flash highlight
│   │   │   ├── searchVault.ts
│   │   │   ├── searchWiki.ts             # search_wiki tool — query wiki index for relevant pages
│   │   │   ├── skillTool.ts
│   │   │   └── writeGuard.ts            # ensureFreshRead — blocks write tools until target was read and mtime matches
│   │   ├── toolSearch/                  # Deferred-tool fetcher tool wiring — discovery, search algorithm, render-text schemas, deferral rules
│   │   │   ├── announcement.ts
│   │   │   ├── deferralRules.ts
│   │   │   ├── discovery.ts
│   │   │   ├── renderTextSchemas.ts
│   │   │   ├── searchAlgorithm.ts
│   │   │   ├── toolSearchTool.ts
│   │   │   └── types.ts
│   │   ├── user/
│   │   │   ├── userToolsLoader.ts
│   │   │   └── wireUserTools.ts
│   │   ├── planModeTools.ts              # EnterPlanMode + ExitPlanMode tools — note-authoring long descriptions; EnterPlanMode resolves planFilePath via planStore.currentSlug(threadId); ExitPlanMode writes plan on approve and edit, returns buildApprovedPlanMessage with file-path line; subagent + empty-plan short-circuits
│   │   ├── todoWriteTool.ts              # TodoWrite tool — note-authoring long description (when/when-not-to-use, examples, states, one-in-progress invariant); schema {id, content, status, priority?, activeForm?}
│   │   ├── toolRegistry.ts
│   │   ├── types.ts
│   │   └── zodAdapter.ts
│   ├── ui/                              # Chat view, context UI, notifications, icons
│   │   ├── chat/
│   │   │   ├── __stories__/
│   │   │   │   └── mocks/
│   │   │   │       └── sources.ts       # Shared Storybook mocks (sources, conversations, renderers)
│   │   │   ├── blocks/                  # Assistant message block views (text, thinking, tool use/result, diff, progress, agent tree, grouped tools)
│   │   │   │   ├── AgentProgressTree.stories.tsx
│   │   │   │   ├── AgentProgressTree.tsx
│   │   │   │   ├── AssistantBlocks.tsx
│   │   │   │   ├── DiffView.stories.tsx
│   │   │   │   ├── DiffView.tsx
│   │   │   │   ├── ExternalAgentLiveBlock.tsx     # Renderer registered under EXTERNAL_AGENT_LIVE_KIND — looks up live ExternalAgentWidgetController by runId from liveControllerRegistry and renders <ExternalAgentWidget controller=…>
│   │   │   │   ├── ExternalAgentTerminalBlock.tsx # Renderer for persisted ExternalAgentTerminalSnapshot (post-reload / post-terminal); collapsed summary + expand reveals refine transcript + response + error + files + log count
│   │   │   │   ├── ExternalAgentWidget.stories.tsx
│   │   │   │   ├── ExternalAgentWidget.tsx        # Live widget — phase-dispatched (preparing/awaiting_clarify/ready/running/writing/terminal); useSyncExternalStore + 1Hz elapsed; collapsed terminal summary expandable
│   │   │   │   ├── GroupedToolUses.stories.tsx
│   │   │   │   ├── GroupedToolUses.tsx
│   │   │   │   ├── index.ts
│   │   │   │   ├── piiDetectorContext.ts            # React context — PiiDetectorContext + usePiiDetector() hook; falls back to no-op detector (returns []) when provider is unmounted
│   │   │   │   ├── PiiReviewBanner.stories.tsx
│   │   │   │   ├── PiiReviewBanner.tsx              # Composer-side banner — renders scanning spinner / per-finding rows (mask/remove/ignore decisions via aria role="group") / error retry; status union `idle | scanning | ready | error`; KIND_LABELS mapping (`email`→Email, `apiKey`→API key, `urlWithAuth`→URL with credentials, …)
│   │   │   │   ├── ProgressLines.stories.tsx
│   │   │   │   ├── ProgressLines.tsx
│   │   │   │   ├── TextBlockView.tsx
│   │   │   │   ├── ThinkingBlockView.stories.tsx
│   │   │   │   ├── ThinkingBlockView.tsx
│   │   │   │   ├── ToolResultBlockView.stories.tsx
│   │   │   │   ├── ToolResultBlockView.tsx
│   │   │   │   ├── ToolUseBlockView.stories.tsx
│   │   │   │   ├── ToolUseBlockView.tsx
│   │   │   │   ├── toolUseStatus.tsx
│   │   │   │   ├── WikiLiveBlock.tsx              # Renderer for WIKI_LIVE_KIND — looks up live WikiWidgetController by runId from liveControllerRegistry
│   │   │   │   ├── WikiTerminalBlock.tsx          # Renderer for persisted WikiTerminalSnapshot post-reload
│   │   │   │   ├── WikiWidget.stories.tsx
│   │   │   │   └── WikiWidget.tsx                 # Live wiki widget — phase-dispatched (awaiting_config/preparing/fetching/persisting/planning/extracting/reducing/writing/scanning/checking/proposing/done/cancelled/error); ConfigBody (provider/model selects, loading/error/retry, api-key gate, Start/Cancel); useSyncExternalStore
│   │   │   ├── hooks/
│   │   │   │   └── useBlink.ts
│   │   │   ├── widgets/
│   │   │   │   ├── ContextWidget.tsx
│   │   │   │   ├── RagWidget.stories.tsx        # Storybook fixtures for RagWidget (idle/indexing/paused/errored/unavailable/empty/large-vault)
│   │   │   │   ├── RagWidget.tsx                # `rag` widget — read-only RAG/index status panel rendered from RagSnapshot
│   │   │   │   ├── registry.ts
│   │   │   │   ├── WikiStatusWidget.stories.tsx
│   │   │   │   └── WikiStatusWidget.tsx         # `wiki` widget — read-only wiki status (mutex active op, last run, page counts) rendered from WikiStatus snapshot
│   │   │   ├── AttachmentChip.stories.tsx
│   │   │   ├── AttachmentChip.tsx                  # Composer staged-attachment chip (image thumb / doc icon, remove btn)
│   │   │   ├── AttachmentRejectedNotice.stories.tsx
│   │   │   ├── AttachmentRejectedNotice.tsx        # Inline notice for oversize / limit / unsupported / upload-failed
│   │   │   ├── AttachmentTray.stories.tsx
│   │   │   ├── AttachmentTray.tsx                  # Horizontal list of staged attachment chips above the textarea
│   │   │   ├── BottomLiveIndicator.stories.tsx
│   │   │   ├── BottomLiveIndicator.tsx
│   │   │   ├── ChatRoot.stories.tsx
│   │   │   ├── ChatRootBlocks.stories.tsx
│   │   │   ├── ChatRoot.tsx                          # Chat shell — useSyncExternalStore over planModeSource; toggles is-plan-mode class + data-plan-mode attr on root; forwards planModeActive to HeaderBar
│   │   │   ├── ClarifyingQuestionDialog.stories.tsx  # Storybook fixtures for ClarifyingQuestionDialog (idle/single-select 2/single-select 4/multi-select/freeform-only)
│   │   │   ├── ClarifyingQuestionDialog.tsx          # Inline dialog for AskUserQuestion — radio/checkbox/textarea variants, Send/Cancel, Esc cancels; mirrors PlanApprovalDialog source/subscribe pattern
│   │   │   ├── codeBlockEnhancer.ts
│   │   │   ├── ComposerInput.stories.tsx
│   │   │   ├── ComposerInput.tsx                   # Textarea + slash picker + @ mention picker + paste/drop + paperclip
│   │   │   ├── ContextIndicator.stories.tsx
│   │   │   ├── ContextIndicator.tsx
│   │   │   ├── fuzzyMatch.ts
│   │   │   ├── HeaderBar.stories.tsx
│   │   │   ├── HeaderBar.tsx               # Chat header — title, optional stats slot, optional `Plan mode` pill (data-slot="plan-mode-pill") gated by planModeActive prop
│   │   │   ├── HeaderStat.tsx
│   │   │   ├── HeaderStatsLive.tsx
│   │   │   ├── headerStatsSources.ts
│   │   │   ├── IndexStatusBlock.stories.tsx
│   │   │   ├── IndexStatusBlock.tsx
│   │   │   ├── InlineConfirmation.stories.tsx     # Storybook fixtures for InlineConfirmation (idle/pending-read/pending-write/after-applied variants)
│   │   │   ├── InlineConfirmation.tsx
│   │   │   ├── InlineDialog.stories.tsx           # Storybook fixtures for InlineDialog (idle/pending-editor/pending-vault/after-applied variants)
│   │   │   ├── InlineDialog.tsx
│   │   │   ├── MentionPicker.stories.tsx
│   │   │   ├── MentionPicker.tsx                   # Vault-file fuzzy picker for `@` operator (mirrors SlashPicker pattern)
│   │   │   ├── MessageActionBar.stories.tsx
│   │   │   ├── MessageActionBar.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── PlanApprovalDialog.stories.tsx
│   │   │   ├── PlanApprovalDialog.tsx
│   │   │   ├── planModeSource.ts          # makePlanModeSource(controller, getActiveThread) — { getMode, subscribe } adapter for useSyncExternalStore-driven plan-mode UI
│   │   │   ├── scrollAnchoring.ts
│   │   │   ├── SentAttachmentList.stories.tsx
│   │   │   ├── SentAttachmentList.tsx              # Chips on the sent user bubble (renders `record.blocks` image/document)
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
│   │   ├── ragCommand.ts                # Abortable handle for /rag slash command (mirrors contextCommand)
│   │   ├── responsiveCollapse.ts
│   │   ├── wikiStatusCommand.ts         # Abortable handle for /wiki slash command (mirrors contextCommand/ragCommand)
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
│   ├── helpers/                         # Cross-suite test helpers
│   │   └── inMemoryVaultAdapter.ts      # InMemoryVaultAdapter — Map-backed VaultAdapter impl for unit tests (files/folders Maps, list with prefix scan, stat returns kind)
│   ├── unit/                            # Vitest unit suite (happy-dom)
│   ├── dom/                             # React/DOM component tests
│   ├── integration/                     # MSW-backed provider/embedding integration
│   │   ├── _mswServer.ts
│   │   ├── embeddingClient.test.ts
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
│       ├── inlineAgentCanonDownload.live.test.ts  # Live inline-agent canon-download autoresearch loop
│       ├── provider.live.test.ts
│       ├── toolCalling.live.test.ts
│       └── wikiIngestCanon.live.test.ts           # Live wiki-ingest canon harness — claude-as-judge loop, state.md row writer
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
├── scripts/
│   └── checkBundle.mjs                  # Bundle-size guard — reads main.js size, compares against .agent/budgets/bundle-baseline.json, fails when delta > maxDeltaBytes (invoked via `pnpm check:bundle`)
├── styles.css                           # Plugin styles — chat block collapse uses `.leo-*-body-wrap` grid-template-rows 1fr↔0fr trick (180ms); blocks fade in via `@keyframes leo-block-in` (160ms); message actions reveal via opacity + pointer-events on `.leo-bubble:hover` (140ms); `.leo-wiki-config*` styles ConfigBody (dashed yellow-tinted container, two-column row layout, api-key/validation panels, Start button uses `--interactive-accent`)
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
- `pnpm check:bundle` — `node scripts/checkBundle.mjs` — asserts `main.js` size delta vs `.agent/budgets/bundle-baseline.json` is within cap (run after `build`).
- `pnpm storybook` / `pnpm build-storybook` — Storybook dev server / static build.
