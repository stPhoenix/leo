# Context — Leo Obsidian Plugin

Parsed from `.agent/srs/srs.md` and companion docs (`compact.md`, `context.md`, `plan.md`). IDs preserved verbatim from the SRS. Heading anchors enable cross-doc linking (e.g. `context.md#fr-chat-01`).

## Scope

- Desktop-only Obsidian community plugin (Electron) embedding an AI chat assistant directly into the editor.
- Local-first operation: all indexing, embedding, and inference run on the user's machine via LM Studio (or any OpenAI-compatible local server).
- Real-time access to the active note, cursor/selection/viewport (Focused Context), and the full vault through a lazily-updated RAG/GraphRAG index.
- Agent can read, create, and modify notes while the user watches live edits under an edit lock.
- Phase 1 — Foundation (MVP): chat sidebar with LM Studio, active note context, single thread, streaming + stop, settings, rotating log.
- Phase 2 — Vault Actions + Tool Confirmation + Basic Skills: built-in tools (`read_note`, `create_note`, `edit_note`, `append_to_note`), real-time edit injection with edit lock and accept/reject, conversation persistence, tool confirmation prompts with per-thread allowlist, basic skills (bundled + `.leo/skills/` file load), Todos and Plan mode (`.leo/plans/`, approval dialog, write-tool gating).
- Phase 3 — RAG: VaultIndexer (dirty queue, markdown-only, heading chunks, frontmatter/tag metadata), LM Studio embeddings, IndexedDB vector store with Index Header, cosine search with exclude list, `search_vault` tool, status-bar progress, reindex-on-model-switch.
- Phase 4 — GraphRAG + Canvas: symmetric graph cache, incremental graph updates, 1-hop + 2-hop + tag-shared boosts, graph-aware context assembly, canvas file parsing (JSON node text).
- Phase 5 — Polish, Skill Editor, User Tools, More Providers: multiple threads, token/cost UI ($ for cloud), smart window truncation, provider adapters (OpenAI, Anthropic, Ollama, custom), API keys via `safeStorage`, in-plugin skill editor UI, user-defined tools, CompactionEngine (microcompaction, autocompaction, partial/session-memory compaction, PTL retry), ContextAnalyzer + `/context` (breakdown, grid, suggestions, status-line), image/file attachments, 10k+ vault perf, reindex polish.
- Phase 6 — MCP: stdio + HTTP+SSE transports, `.leo/config.json mcpServers`, parallel non-blocking startup, namespaced tool registration (`mcp.<server>.<tool>`), resource picker, MCP prompts in skill picker, server management UI, reconnect with backoff, clean shutdown, secret storage via `safeStorage`.

## Out of scope

- Mobile / web Obsidian builds (desktop Electron only per §6).
- Cloud providers in v1 (deferred to phase 5; LM Studio / OpenAI-compatible local only initially).
- PDFs and images for indexing (deferred post-v1 per FR-IDX-05). Binaries are always skipped.
- Canvas file indexing in v1 (added in phase 4 per FR-IDX-05).
- In-plugin Skill Editor UI in phase 2 (files edited manually; GUI deferred to phase 5 per FR-SKILL-04 / Phase 5 deliverables).
- User-defined custom tools before phase 5 (sandboxed JS / config-driven tool declarations).
- Multiple conversation threads before phase 5 (single thread through phase 2 per Phase 5 deliverables).
- Image paste → vision model and file-drop attachments deferred to phase 5.
- MCP support before phase 6.
- CompactionEngine and `/context` deferred to phase 5.
- Telemetry, analytics, or cloud calls that the user has not explicitly enabled (NFR-DATA-03).
- Prompt-only plan-mode enforcement (disallowed; must live in the permission system — NFR-REL-07, plan.md §10).
- Session memory compaction layer (compact.md §8) — experimental upstream; not listed in Leo phases, so treated as out of scope for v1/v5 unless later scoped.
- `@modelcontextprotocol/sdk` beyond standard host-config shape.

## Actors

- **End user (Obsidian vault owner)** — writes notes, invokes the chat, approves/rejects tool calls and plans, edits skills, manages MCP servers.
- **Obsidian host application** — provides plugin lifecycle (`onload`/`onunload`), workspace events (`active-leaf-change`, `file-open`, `editor-change`), Vault API (`create`/`modify`/`delete`/`rename`), `metadataCache.resolvedLinks`, `metadataCache.on('resolved')`, `MarkdownRenderer.render`, `setIcon`, `Notice`, status bar, ribbon, command palette, Settings tab, CM6 editor.
- **CodeMirror 6 editor** — hosts the EditorBridge CM6 extension (cursor/selection/viewport tracking, readonly decorations for edit lock, `EditorTransaction` for grouped edits).
- **LM Studio (or OpenAI-compatible local server)** — serves chat and embedding models via `http://localhost:<port>/v1`, `/v1/models`, SSE streaming, tool-use parameter.
- **Future cloud LLM providers** (phase 5) — OpenAI, Anthropic, Ollama, custom adapters behind the Provider interface.
- **MCP servers** (phase 6) — external stdio child processes or HTTP+SSE endpoints exposing tools/resources/prompts to the MCPClient.
- **Filesystem (vault root + sub-directories)** — stores `.leo/conversations/`, `.leo/skills/`, `.leo/plans/`, `.leo/logs/leo.log`, `.leo/index/`, `.leo/config.json`.
- **Electron `safeStorage` / OS keyring** — stores cloud API keys and secret-bearing MCP env.
- **IndexedDB** — stores embeddings, chunk metadata, and Index Header.
- **Vault filesystem** — source of markdown notes and link graph consumed by VaultIndexer and RAGEngine.

## Functional requirements

### Chat interface (FR-CHAT-*)

- **FR-CHAT-01**: The plugin SHALL register a sidebar view (`ItemView`) accessible via a ribbon icon and command palette.
- **FR-CHAT-02**: The chat view SHALL display a scrollable message history with distinct user and assistant message styles.
- **FR-CHAT-03**: The chat view SHALL provide a text input area with multi-line support and send on Enter (Shift+Enter for newline).
- **FR-CHAT-04**: The chat view SHALL stream assistant responses token-by-token as they arrive.
- **FR-CHAT-05**: The user SHALL be able to stop a streaming response mid-generation via `AbortController`. In-flight tool calls complete atomically; remaining queued tool calls are skipped. UI SHALL indicate "cancelled after N tools".
- **FR-CHAT-06**: The chat view SHALL render assistant messages as full markdown using Obsidian's `MarkdownRenderer.render`. Code blocks SHALL have syntax highlighting and a copy-to-clipboard button.
- **FR-CHAT-07**: Each message SHALL expose per-message actions: copy content, regenerate (assistant only), edit-and-resend (user only), delete. Assistant messages are not inline-editable.
- **FR-CHAT-08**: Conversation history SHALL be persisted to `.leo/conversations/` so it survives plugin reloads.
- **FR-CHAT-09**: The chat view SHALL display a context indicator showing active note, viewport range, and selection currently included as context.
- **FR-CHAT-10**: The chat view SHALL queue user messages submitted while a prior request is in-flight (FIFO).
- **FR-CHAT-11**: Token usage per message (input / output / total) SHALL be shown. Cost in $ is shown only when a cloud provider is configured (phase 5).
- **FR-CHAT-12**: The chat view SHALL expose a skill picker (dropdown or command) to select the active skill for the current thread. The selected skill's name SHALL be visible in the thread header.
- **FR-CHAT-13**: When the agent requests a tool call that requires confirmation (FR-AGENT-10), the chat view SHALL render an inline confirmation prompt with: tool name, arguments (pretty-printed), Allow once / Allow for thread / Deny buttons.

### Editor bridge (FR-EDIT-*)

- **FR-EDIT-01**: The plugin SHALL register a CM6 extension tracking cursor position, selection range, and visible viewport line range.
- **FR-EDIT-02**: The editor bridge SHALL expose Focused Context to the AgentController on every change, debounced to ≤ 1/300ms.
- **FR-EDIT-03**: Listen for `workspace.on('active-leaf-change')` and `workspace.on('file-open')`.
- **FR-EDIT-04**: Listen for `workspace.on('editor-change')` for user edit detection.
- **FR-EDIT-05**: Apply programmatic edits via `Editor.replaceRange()` / `EditorTransaction`, grouped under a single "Leo edit" undo step.
- **FR-EDIT-06**: Install an edit lock (CM6 readonly decoration + highlight) over the range being modified. User keystrokes in the locked range are blocked with a Notice.
- **FR-EDIT-07**: Edit locks SHALL release on accept / reject / cancel / failure.
- **FR-EDIT-08**: Modified region highlighted for 3s after edit completes.
- **FR-EDIT-09**: User SHALL accept or reject AI edits via inline diff UI or undo. Reject reverts atomically.

### Agent controller (FR-AGENT-*)

- **FR-AGENT-01**: Receive user message + current Focused Context.
- **FR-AGENT-02**: Query RAGEngine before constructing the LLM prompt.
- **FR-AGENT-03**: Construct system prompt from: active skill's system prompt (FR-SKILL-*), active note content, retrieved RAG context, conversation history. Priority on truncation: active note > RAG > history > skill examples.
- **FR-AGENT-04**: Support tool-use via the ToolRegistry. Built-in tools: `read_note(path)`, `create_note(path, content)`, `edit_note(path, line_start, line_end, new_content)`, `append_to_note(path, content)`, `search_vault(query, tags?)`.
- **FR-AGENT-05**: Active-note modifying tools SHALL apply via EditorBridge (under edit lock).
- **FR-AGENT-06**: Non-active-note tools SHALL apply via Vault API.
- **FR-AGENT-07**: One agent request in-flight at a time. Tool calls serial within a request.
- **FR-AGENT-08**: Context window overflow handled by CompactionEngine (FR-COMPACT-*). Pre-compaction fallback: truncate oldest history first, then RAG context, preserving active note context.
- **FR-AGENT-09**: Each request cancellable via `AbortController`. Cancel finishes current tool (atomicity), skips remaining.
- **FR-AGENT-10**: Each tool SHALL declare a `requiresConfirmation` flag (default: true for write/destructive, false for read). Before calling such a tool, the agent SHALL pause and emit a confirmation event handled by FR-CHAT-13. Resumes on Allow; aborts with a tool-error message on Deny.
- **FR-AGENT-11**: Tools allowed via "Allow for thread" SHALL be remembered in the thread's metadata until thread deletion.
- **FR-AGENT-12**: Tool allowlist: when a Skill defines `allowedTools`, only those tools are exposed to the LLM for the thread. Default skill = all registered tools.

### Vault indexer (FR-IDX-*)

- **FR-IDX-01**: On load, verify Index Header `{model, dim, version}` matches settings. Mismatch prompts reindex (now / later / revert model).
- **FR-IDX-02**: Diff vault state against index to determine files needing (re-)indexing.
- **FR-IDX-03**: Listen to `vault.on('create'/'modify'/'delete'/'rename')` → add to dirty queue.
- **FR-IDX-04**: Process dirty queue lazily: idle timer (default 30s) or on-demand RAG query.
- **FR-IDX-05**: v1 indexes markdown files only. Canvas files added phase 4. PDFs/images deferred post-v1. Binaries skipped.
- **FR-IDX-06**: Chunking: heading-based (default), fallback fixed-size ~512-token overlapping.
- **FR-IDX-07**: Chunk metadata: `{path, line_start, line_end, heading_path, frontmatter_tags, inline_tags}`.
- **FR-IDX-08**: Embed chunks via ProviderManager's embedding model.
- **FR-IDX-09**: Store embeddings + metadata in IndexedDB with Index Header.
- **FR-IDX-10**: Graph cache from `metadataCache.resolvedLinks` as undirected graph (forward + back symmetric).
- **FR-IDX-11**: Incremental graph updates via `metadataCache.on('resolved')`.
- **FR-IDX-12**: Indexing yields to main thread (`requestIdleCallback` chunked loops); never blocks editor.
- **FR-IDX-13**: Manual "re-index vault" command via command palette.
- **FR-IDX-14**: Status bar progress (files remaining, current file).

### RAG engine (FR-RAG-*)

- **FR-RAG-01**: Embed query; cosine similarity search against chunk index.
- **FR-RAG-02**: 1-hop graph boost (default 1.5x) for chunks in notes linked to active note.
- **FR-RAG-03**: 2-hop graph boost (default 1.2x).
- **FR-RAG-04**: Tag-shared boost (default 1.1x, additive with graph boost).
- **FR-RAG-05**: Optional tag filter: only chunks whose note carries any requested tag returned.
- **FR-RAG-06**: Top-K return (default K=10) with `{path, line_start, line_end, score}`.
- **FR-RAG-07**: Merge overlapping chunks from same file.
- **FR-RAG-08**: Respect exclude list (glob patterns).

### Provider manager (FR-PROV-*)

- **FR-PROV-01**: Support LM Studio via OpenAI-compatible API `http://localhost:<port>/v1`.
- **FR-PROV-02**: Auto-detect models via `/v1/models`.
- **FR-PROV-03**: SSE streaming (`stream: true`).
- **FR-PROV-04**: Tool-use via OpenAI-compatible `tools` parameter.
- **FR-PROV-05**: FIFO request queue per provider. Timeout 120s/request.
- **FR-PROV-06**: Retry on connection failure with exponential backoff (max 3). Persistent failure surfaces Notice + status bar indicator.
- **FR-PROV-07**: Provider interface for future providers (OpenAI, Anthropic, Ollama, custom).
- **FR-PROV-08**: Embedding model configurable separately.
- **FR-PROV-09**: Settings tab: endpoint URL, model, temperature, max tokens.
- **FR-PROV-10**: Cloud API keys via Electron `safeStorage` (OS-keyring). Fallback obfuscated with user warning. Never plaintext in vault.

### Skills (FR-SKILL-*)

- **FR-SKILL-01**: A Skill is defined as JSON/markdown with fields: `{id, name, description, systemPrompt, allowedTools?, examples?, defaultModel?}`.
- **FR-SKILL-02**: Skills SHALL be stored in `.leo/skills/` as individual files (one per skill). User-editable.
- **FR-SKILL-03**: Leo SHALL ship a set of built-in skills (bundled, non-editable but clonable): "General", "Write assistant", "Research", "Code helper".
- **FR-SKILL-04**: The user SHALL be able to create, edit, delete, duplicate skills from a settings page or dedicated skill-editor view.
- **FR-SKILL-05**: Each thread SHALL have one active skill. Default is "General". The skill can be changed mid-thread.
- **FR-SKILL-06**: Changing a skill mid-thread SHALL apply the new system prompt from the next turn onward; prior turns are not re-sent.
- **FR-SKILL-07**: If a skill declares `allowedTools`, the ToolRegistry SHALL restrict agent-visible tools to that allowlist.
- **FR-SKILL-08**: If a skill declares `defaultModel`, that model overrides the global chat model for threads using the skill.

### Context compaction (FR-COMPACT-*)

Top-level FRs preserved from srs.md §3.8; companion-doc-derived invariants added as sub-bullets to surface numerically-stated requirements in compact.md without inlining verbatim prompt text (which stays in compact.md §10 per FR-COMPACT-04).

- **FR-COMPACT-01**: AgentController SHALL implement layered compaction: microcompaction (tool-result clearing), autocompaction (threshold-based summarization), full/partial compaction, session-memory compaction. See compact.md §5–§9.
- **FR-COMPACT-02**: Token counting SHALL follow 3-tier strategy (API usage → hybrid estimation → rough `len/4`). See compact.md §4.
  - Per compact.md §4, per-block estimation: text = `len/4`; image/document = 2,000 tokens; thinking = text only; tool_use = `name + JSON(input)`; final total multiplied by 4/3 (conservative padding).
- **FR-COMPACT-03**: Autocompact threshold, buffers, retry limits, and circuit breaker SHALL match constants in compact.md §3.
  - `MODEL_CONTEXT_WINDOW_DEFAULT` = 200,000; `COMPACT_MAX_OUTPUT_TOKENS` = 20,000; `AUTOCOMPACT_BUFFER_TOKENS` = 13,000; `WARNING_THRESHOLD_BUFFER_TOKENS` = 20,000; `ERROR_THRESHOLD_BUFFER_TOKENS` = 20,000; `MANUAL_COMPACT_BUFFER_TOKENS` = 3,000; `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` = 3 (circuit breaker).
  - Post-compact budgets: `POST_COMPACT_MAX_FILES_TO_RESTORE` = 5; `POST_COMPACT_TOKEN_BUDGET` = 50,000; `POST_COMPACT_MAX_TOKENS_PER_FILE` = 5,000; `POST_COMPACT_MAX_TOKENS_PER_SKILL` = 5,000; `POST_COMPACT_SKILLS_TOKEN_BUDGET` = 25,000.
  - Thresholds: `effectiveContextWindow = contextWindow - min(maxOutputTokens, 20_000)`; `autoCompactThreshold = effectiveContextWindow - 13_000`; `blockingLimit = effectiveContextWindow - 3_000`.
- **FR-COMPACT-04**: Summarization prompt SHALL use verbatim text from compact.md §10 (analysis + summary XML blocks).
- **FR-COMPACT-05**: Post-compaction message assembly order: boundary marker → summary → preserved → attachments → hook results. See compact.md §11.
- **FR-COMPACT-06**: Prompt-too-long recovery via group-based head truncation with max 3 retries. See compact.md §13.
  - `MAX_PTL_RETRIES` = 3; drop 20% of API-round groups per retry when token gap is unparseable (minimum 1 group); never drop all groups; prepend synthetic `[earlier conversation truncated for compaction retry]` marker if the result starts with an assistant message.
- **FR-COMPACT-07**: API invariants (tool_use/tool_result pairing, thinking-block continuity) SHALL be preserved on all slicing ops. See compact.md §15.
  - Every `tool_result` must have a matching `tool_use` in a kept assistant message; streaming chunks that share `message.id` must remain adjacent; images/documents replaced with `[image]`/`[document]` markers before the summarization API call; `skill_discovery` / `skill_listing` attachments stripped pre-summary and re-injected post-compact.

### Context visualization — `/context` (FR-CTX-*)

Top-level FRs preserved from srs.md §3.9; numerically-stated thresholds and layout rules from context.md surfaced as sub-bullets.

- **FR-CTX-01**: ChatView SHALL expose a `/context` command rendering category breakdown + grid visualization. See context.md §10.
- **FR-CTX-02**: Data pipeline: post-compact-boundary filter → microcompact → `analyzeContextUsage()`. See context.md §3.
- **FR-CTX-03**: Category ordering, colors, and deferred-category handling per context.md §8.
  - Fixed category order: System prompt, System tools, MCP tools, MCP tools (deferred), System tools (deferred), Custom agents, Memory files, Skills, Messages, Autocompact buffer / Manual compact buffer, Free space. Deferred categories excluded from usage percentage and grid; still listed in detail breakdown.
- **FR-CTX-04**: Grid sizing responsive to terminal/panel width per context.md §9.1; partial-square fullness per §9.3.
  - Grid dimensions: 5×5 (<1M, <80 cols), 10×10 (<1M, ≥80 cols), 5×10 (≥1M, <80 cols), 20×10 (≥1M, ≥80 cols).
  - Allocation: `allocatedSquares = max(1, round(exactSquares))` for non-free categories; free space rounded (may be 0); last square of a category carries fractional fullness.
- **FR-CTX-05**: Suggestions generated with thresholds from context.md §12 (near-capacity, large-tool-results, memory-bloat, etc.).
  - `NEAR_CAPACITY_PERCENT` = 80; `LARGE_TOOL_RESULT_PERCENT` = 15; `LARGE_TOOL_RESULT_TOKENS` = 10,000; `READ_BLOAT_PERCENT` = 5; `MEMORY_HIGH_PERCENT` = 5; `MEMORY_HIGH_TOKENS` = 5,000. Suggestions sorted warnings-first, then by `savingsTokens` descending.
- **FR-CTX-06**: Token warning state and status-line integration per context.md §13–§14.
  - Status line reports `{total_input_tokens, total_output_tokens, context_window_size, current_usage, used_percentage, remaining_percentage}` updated on last-assistant-message-id change, debounced 500ms.

### Plan mode & todos (FR-PLAN-*)

Top-level FRs preserved from srs.md §3.10; additional invariants from plan.md surfaced as sub-bullets.

- **FR-PLAN-01**: ToolRegistry SHALL expose `TodoWrite` tool with in-memory per-agent storage, keyed by `agentId ?? sessionId`. See plan.md §3.
  - Todo item schema `{content: string (imperative, non-empty), activeForm: string (present-continuous, non-empty), status: 'pending' | 'in_progress' | 'completed'}`. Exactly one `in_progress` at any time (prompt-enforced, not schema). Todos are NOT persisted to disk.
  - Call logic: if every submitted todo is `completed`, persist an empty list but still return original `newTodos` so the model sees what it just finished.
- **FR-PLAN-02**: TodoWrite prompt text SHALL be copied verbatim from plan.md §3.3.
- **FR-PLAN-03**: Stale-todo reminder SHALL be injected at turn boundaries per plan.md §3.8, rate-limited.
  - Reminder fires only when list is non-empty AND the last reminder is more than N messages ago AND the model did non-trivial work without calling TodoWrite; wrapped in `<system-reminder>` tags; never mentioned to the user.
- **FR-PLAN-04**: ToolRegistry SHALL expose `EnterPlanMode` and `ExitPlanMode`; forbidden in subagent contexts per plan.md §4.3.
- **FR-PLAN-05**: Permission system SHALL block all write-capable tools while `mode === 'plan'`; only Read/Grep/Glob/WebFetch/plan-file-write allowed. See plan.md §4.5.
- **FR-PLAN-06**: Plan files stored under `.leo/plans/<slug>.md`; slug cached per session; path-traversal guard required. See plan.md §2.2.
  - Slug generator: two-word kebab, lazily generated on first plan-file access; retry up to 10 times on filename collision.
  - Subagent path variant: `.leo/plans/<slug>-agent-<agentId>.md`.
- **FR-PLAN-07**: ExitPlanMode SHALL present plan via approval dialog (Approve / Edit / Reject) per plan.md §5.6; edited plans synced to disk.
  - On Edit outcome, tool sets `planWasEdited = true` and rewrites plan file to disk before returning.
  - Result message for main-agent non-empty plan uses "Approved Plan" header (or "Approved Plan (edited by user)" when edited); subagent-context result collapses to "User has approved the plan. There is nothing else needed from you now. Please respond with 'ok'"; empty plan falls back to "User has approved exiting plan mode. You can now proceed."
- **FR-PLAN-08**: Mode-transition attachments (enter/exit reminders) injected on next turn per plan.md §6.
  - Opposing-flag rule: rapid toggle in/out clears the pending attachment so both reminders aren't sent.
- **FR-PLAN-09**: Session resume recovers todos from transcript and plan slug/content per plan.md §8.
  - Todo rehydration: scan transcript backwards for most recent `TodoWrite` tool_use input.
  - Plan-content recovery fallback chain: (1) `file_snapshot` system messages; (2) `ExitPlanMode` tool_use `input.plan`; (3) user `planContent` / `plan_file_reference` attachments. First non-empty hit is written back to the plan file.

### MCP integration (FR-MCP-*)

- **FR-MCP-01**: Leo SHALL act as an MCP host, connecting to one or more configured MCP servers.
- **FR-MCP-02**: Transports supported: stdio (spawn child process) and HTTP+SSE.
- **FR-MCP-03**: MCP server config stored in `.leo/config.json` under `mcpServers`, shape compatible with standard MCP host config (`{ command, args, env }` for stdio; `{ url }` for SSE).
- **FR-MCP-04**: On plugin load, MCPClient SHALL connect to all enabled servers in parallel. Failed connections log a warning but do not block plugin startup.
- **FR-MCP-05**: MCPClient SHALL discover and register: tools (via `tools/list`), resources (via `resources/list`), prompts (via `prompts/list`).
- **FR-MCP-06**: MCP-exposed tools SHALL be added to the ToolRegistry with namespace prefix `mcp.<serverId>.<toolName>` to avoid collisions.
- **FR-MCP-07**: All MCP tool calls SHALL default to `requiresConfirmation: true` (FR-AGENT-10) unless the user has pre-approved the tool for the thread.
- **FR-MCP-08**: MCP-exposed resources SHALL be surfacable in the chat view via a resource picker, inserting their content as context for the next message.
- **FR-MCP-09**: MCP-exposed prompts SHALL appear in the skill picker (FR-CHAT-12) as a separate section "From MCP", selectable per-thread.
- **FR-MCP-10**: Settings tab SHALL provide UI to add/edit/remove MCP servers, toggle enabled state, and view connection status per server.
- **FR-MCP-11**: MCP client SHALL reconnect with exponential backoff on disconnect (max 5 attempts, then surface error).
- **FR-MCP-12**: On plugin unload, all MCP stdio child processes SHALL be terminated cleanly (`SIGTERM`, fallback `SIGKILL` after 2s).

### UI composition & visual (FR-UI-*)

- **FR-UI-01**: ChatView SHALL decompose into: `HeaderBar` (skill picker, thread title, token indicator), `ContextIndicator` (active note, viewport, selection), `MessageList` (virtualized scroll), `ComposerInput` (multi-line textarea + send/stop button), `InlineConfirmation` (tool prompts), `InlineDialog` (plan approval).
- **FR-UI-02**: ChatView SHALL mount in Obsidian's right sidebar by default; user can move to left sidebar or main workspace leaf via Obsidian's native view APIs.
- **FR-UI-03**: Styling SHALL use Obsidian CSS variables (`--background-primary`, `--text-normal`, `--interactive-accent`, etc.) so light/dark/custom themes apply automatically. No hardcoded colors.
- **FR-UI-04**: A ribbon icon (Obsidian ribbon API) SHALL toggle ChatView. Command palette entries: "Leo: Open chat", "Leo: New thread", "Leo: Toggle plan mode", "Leo: Re-index vault", "Leo: Show context".
- **FR-UI-05**: Per-tool icons SHALL be provided for built-in tools (read/write/search/edit) and rendered in confirmation prompts and message tool-use blocks. MCP tools get a generic MCP icon + server-name label.
- **FR-UI-06**: Visual states SHALL be defined for: idle, streaming (animated cursor), tool-running (spinner + tool name), awaiting-confirmation (amber), error (red), cancelled, edit-locked (editor highlight).
- **FR-UI-07**: Empty / onboarding states SHALL render: first-launch welcome with "Configure LM Studio" CTA; empty thread with example prompts; no-index state with "Index vault" CTA.
- **FR-UI-08**: Notifications policy: transient success/info via `Notice`; persistent state via status bar; blocking errors via inline modal; tool confirmation via inline dialog inside chat (never native modal).
- **FR-UI-09**: Plan approval dialog SHALL render the plan as Obsidian markdown, with an editable textarea for "Edit" mode, buttons: Approve / Edit / Reject. Dialog focus-trapped; Esc = reject.
- **FR-UI-10**: Settings tab hierarchy: Provider → Indexing → Skills → MCP Servers → Plan/Todos → Appearance → Advanced. Each section collapsible.
- **FR-UI-11**: All icons SHALL come from Obsidian's built-in icon set (`setIcon`) or be bundled SVG; no external icon font requests.
- **FR-UI-12**: Animations SHALL respect `prefers-reduced-motion`; streaming cursor, edit-lock pulse, diff transitions disabled when set.

## Non-functional requirements

### Performance (NFR-PERF-*)

- **NFR-PERF-01**: Editor context updates add ≤ 5ms latency.
- **NFR-PERF-02**: Indexing off main thread.
- **NFR-PERF-03**: RAG queries ≤ 200ms for vaults up to 10k notes.
- **NFR-PERF-04**: Initial index resumable across Obsidian restarts.
- **NFR-PERF-05**: Chat streaming target 60fps.
- **NFR-PERF-06**: MCP server startup (stdio spawn) SHALL not block plugin `onload` — connect asynchronously.
- **NFR-PERF-07**: Autocompact summarization call SHALL run with keep-alive and ≤ 2 streaming retries; ≤ 3 PTL truncation retries.
- **NFR-PERF-08**: `/context` analysis SHALL run seven counting ops in parallel (`Promise.all`); skill counting error-isolated.

### Data & privacy (NFR-DATA-*)

- **NFR-DATA-01**: All data local unless user opts into cloud provider or cloud-backed MCP server.
- **NFR-DATA-02**: Embedding index at `.leo/index/` (configurable).
- **NFR-DATA-03**: No telemetry or analytics.
- **NFR-DATA-04**: MCP server configs that include secrets (API keys in `env`) SHALL be stored via `safeStorage`, not vault plaintext.

### Reliability (NFR-REL-*)

- **NFR-REL-01**: LM Studio unreachable → connection indicator; chat disabled; indexing paused.
- **NFR-REL-02**: AI edits atomic.
- **NFR-REL-03**: Corrupt index detected on load; user prompted to rebuild.
- **NFR-REL-04**: Edit lock released on any failure path.
- **NFR-REL-05**: MCP server crash during a tool call SHALL surface as a tool error; agent continues.
- **NFR-REL-06**: Autocompact failures SHALL increment a circuit-breaker counter; 3 consecutive failures disable autocompact for the session.
- **NFR-REL-07**: Plan mode enforcement SHALL be implemented in the permission system (not prompt-only); write tools MUST be blocked while `mode === 'plan'`.
- **NFR-REL-08**: `plansDirectory` SHALL be resolved relative to vault root with path-traversal guard; violating config falls back to default.

### Usability & accessibility (NFR-USE-*)

- **NFR-USE-01**: All config in Obsidian settings tab.
- **NFR-USE-02**: First-time setup wizard for LM Studio.
- **NFR-USE-03**: All hotkeys configurable.
- **NFR-USE-04**: Tool confirmation prompts SHALL clearly distinguish read vs write tools (icon/color).
- **NFR-USE-05**: All interactive elements reachable via keyboard (Tab/Shift-Tab); visible focus ring using Obsidian focus styles.
- **NFR-USE-06**: Chat input: Enter sends; Shift+Enter newline; Cmd/Ctrl+K opens command palette within chat; Esc stops streaming / closes inline confirmations.
- **NFR-USE-07**: ARIA roles on ChatView: `log` for message list, `status` for streaming indicator, `dialog` + `aria-modal` for confirmations and plan approval.
- **NFR-USE-08**: Screen reader SHALL announce: new assistant message (polite live region), tool-confirmation requests (assertive), errors (assertive), streaming start/stop.
- **NFR-USE-09**: Minimum ChatView width 280px; below that, HeaderBar collapses into overflow menu, ContextIndicator collapses to single-line summary.
- **NFR-USE-10**: Colors SHALL maintain WCAG AA contrast against Obsidian default light and dark themes.
- **NFR-USE-11**: z-index layering (top → bottom): Notices → modals (plan approval, settings) → inline dialogs → tooltips → edit-lock decorations → message content.

### Logging & observability (NFR-LOG-*)

- **NFR-LOG-01**: `console.{debug,info,warn,error}` gated by `logLevel` setting (default `info`).
- **NFR-LOG-02**: Persistent log at `.leo/logs/leo.log`, rotated 1 MB × 5.
- **NFR-LOG-03**: User errors via `Notice` + status bar.
- **NFR-LOG-04**: Indexing, provider calls, tool invocations, MCP events logged with structured key/value fields.

### Testing (NFR-TEST-*)

- **NFR-TEST-01**: Vitest unit coverage: chunking, RAG scoring, graph boost, queue, truncation, skill system-prompt assembly, tool-confirmation state machine.
- **NFR-TEST-02**: `msw` fixture server for LM Studio provider tests.
- **NFR-TEST-03**: CM6 code validated via manual integration in dev vault.
- **NFR-TEST-04**: Release smoke: load → index tiny vault → RAG question → agent edit → accept.
- **NFR-TEST-05**: MCP client tested against a reference MCP server fixture (e.g., bundled stdio test server).
- **NFR-TEST-06**: Vitest coverage for CompactionEngine: token estimator tiers, PTL truncation, message grouping, tool_use/tool_result pairing preservation, circuit breaker.
- **NFR-TEST-07**: Vitest coverage for PlanModeController: mode transitions, write-tool blocking, slug generation + path-traversal guard, transcript-recovery fallback chain.
- **NFR-TEST-08**: Vitest coverage for ContextAnalyzer: category ordering, grid allocation (partial-square fullness), suggestion thresholds.

## Constraints

- Platform: Obsidian desktop (Electron) only.
- Minimum Obsidian version: 1.5.0, pinned in `manifest.json`.
- Language: TypeScript.
- Build tooling: esbuild.
- Editor: CodeMirror 6.
- Local inference: LM Studio running on the user's machine (OpenAI-compatible local HTTP API).
- Storage: IndexedDB for embeddings; vault filesystem for conversations, logs, config, skills, plans.
- Obsidian API: public plugin API only (no private / internal APIs).
- MCP: `@modelcontextprotocol/sdk` client; stdio transport requires Node `child_process` (available in Electron renderer via Obsidian).
- Testing stack: Vitest + `msw`; manual integration for CM6.

## Glossary

- **Vault** — The root directory of an Obsidian knowledge base.
- **Active note** — The markdown file currently open and focused in the editor.
- **Focused context** — Union of (a) the currently visible viewport line range, (b) the current selection, (c) the cursor line. All three are sent to the agent; the cursor line is flagged as the focal point.
- **RAG** — Retrieval-Augmented Generation: augmenting LLM prompts with relevant retrieved content.
- **GraphRAG** — RAG enhanced with the vault's link graph to improve retrieval relevance.
- **Dirty queue** — Set of files modified since last indexing and awaiting re-embedding.
- **LM Studio** — A local application serving LLMs via an OpenAI-compatible HTTP API.
- **Edit lock** — A CM6 readonly decoration placed over a range currently being modified by the agent.
- **Index header** — Metadata record `{model, dim, version}` stored alongside the embedding index; mismatch triggers reindex.
- **Tool** — A typed function the agent can call: built-in, user-defined, or MCP-exposed.
- **Tool confirmation** — A UI prompt requiring user approval before executing a destructive tool call.
- **Skill** — A reusable prompt preset `{name, description, systemPrompt, defaultTools?, examples?}` selectable in the chat view. (See FR-SKILL-01 for the authoritative field list, which uses `allowedTools` + optional `defaultModel`; see Open questions.)
- **MCP** — Model Context Protocol: open protocol for LLM agents to consume external tools, resources, and prompts from standalone servers.
- **MCP server** — External process (stdio / HTTP+SSE) exposing tools/resources/prompts to Leo.
- **MCP host** — Leo itself, when connecting to and aggregating MCP servers.
- **Context window** — Max token budget the LLM accepts per request; resolved per-model.
- **Compact boundary** — System marker inserted where prior messages have been summarized.
- **Microcompaction** — Lightweight pre-API pruning that clears old tool-result content without summarization.
- **Autocompaction** — Threshold-triggered full-conversation summarization via a secondary LLM call.
- **Plan mode** — Read-only agent mode for exploration + plan authoring before approval.
- **Plan file** — Markdown file on disk (`.leo/plans/<slug>.md`) containing the agent's proposed plan.
- **Todo list** — Per-session mutable checklist maintained by the agent via TodoWrite.

## Open questions

- **Skill field naming conflict (FR-SKILL-01 vs §1.3 Glossary)**: §1.3 lists skill fields as `{name, description, systemPrompt, defaultTools?, examples?}` but FR-SKILL-01 defines them as `{id, name, description, systemPrompt, allowedTools?, examples?, defaultModel?}`. Is there an `id` field? Is the tool-allowlist field `defaultTools` or `allowedTools`? Authoritative spelling must be settled before skill-file parsing is implemented.
- **Skill file format (FR-SKILL-01, FR-SKILL-02)**: "JSON/markdown" is ambiguous. Both formats? Markdown with YAML frontmatter like Obsidian convention? Single canonical format or either-or? Parser ambiguity.
- **Skill `defaultModel` override vs MCP-prompt Skills (FR-SKILL-08, FR-MCP-09)**: MCP-exposed prompts appear in the skill picker. Can an MCP prompt declare `defaultModel`? What happens if an MCP prompt and a thread skill both set `defaultModel`?
- **Skill mid-thread change (FR-SKILL-06) vs compaction summary recall**: When a skill changes mid-thread and autocompact later summarizes, does the summarization system prompt use the new skill or the skill at summary time? Not specified.
- **Edit lock behavior when target note is closed (FR-EDIT-06)**: If the agent calls `edit_note` on a note that is not currently open in the editor, does FR-EDIT-05 apply (via EditorBridge) or does FR-AGENT-06 (Vault API) take over? FR-AGENT-05 says "Active-note modifying tools" — the boundary between active and non-active notes for `edit_note` is implicit.
- **Inline diff UI for accept/reject (FR-EDIT-09)**: Only mentioned once, no acceptance criteria for what the diff looks like, how it is dismissed, or how conflicts resolve if the user types elsewhere while pending.
- **Context priority truncation policy units (FR-AGENT-03, FR-AGENT-08)**: "Priority on truncation: active note > RAG > history > skill examples" is qualitative. What token budget triggers truncation? Is this the pre-compaction fallback, or does it always apply? Relationship to `CompactionEngine` pre-compact path not defined.
- **Conversation storage format (FR-CHAT-08)**: `.leo/conversations/` mentioned but no file format, per-thread vs monolithic, naming convention, or schema for tool-use/tool-result round-tripping is specified.
- **Thread metadata storage (FR-AGENT-11)**: "Allow for thread" must persist in thread metadata until thread deletion. Where does thread metadata live? Same file as conversation (FR-CHAT-08) or separate sidecar?
- **Queue semantics during compaction (FR-CHAT-10, FR-AGENT-07)**: If a compaction call is in-flight (§3.8, NFR-PERF-07), do queued user messages wait for compaction to finish, or does compaction block queuing entirely? Cancellation behavior (FR-CHAT-05, FR-AGENT-09) during compaction is also unspecified.
- **Partial compaction trigger & UI (FR-COMPACT-01, compact.md §9)**: srs.md lists partial compaction as a layer, but no UI requirement exists for selecting a pivot (plan.md §9 is referenced for TodoWrite only; no FR-CHAT-* or FR-UI-* covers a `/compact` command or pivot picker). Is partial compaction exposed to users or only internally?
- **Session memory compaction prerequisites (compact.md §8)**: Depends on feature flags (`tengu_session_memory`, `tengu_sm_compact`) and a background session-memory extractor. The SRS does not name the extractor subsystem or declare whether session-memory compaction ships at all. Treated in Out of scope above pending clarification.
- **Circuit-breaker surface (NFR-REL-06)**: 3 consecutive failures disable autocompact for the session, but is this visible to the user via status bar / Notice? Not required explicitly.
- **PTL error in the main chat path vs compaction (FR-COMPACT-06, FR-AGENT-08)**: PTL recovery is spec'd for the summarization call (compact.md §13). Is PTL recovery also applied to the normal user turn, or does `FR-AGENT-08`'s pre-compaction fallback (oldest history → RAG) fully cover it?
- **`/context` command trigger (FR-CTX-01, FR-UI-04)**: FR-UI-04 lists a command palette entry "Leo: Show context". Is the `/context` command an in-chat slash command (like the upstream Claude Code command) AND/OR a palette command? Both? Do they render the same grid?
- **Grid sizing mapping to Obsidian (FR-CTX-04)**: context.md §9.1 defines grid dimensions in terminal columns (<80, ≥80). ChatView is a CSS pane, not a terminal. How does Leo map responsive breakpoints (panel px width, chars-per-line heuristic, or fixed layout)?
- **Tool-search (deferred tools) applicability to Leo (FR-CTX-03, context.md §6)**: context.md distinguishes "always-loaded" vs "deferred" tools based on tool-search feature flags. Leo does not ship tool search in any phase; does the deferred category simply collapse to zero, or is this feature dropped from `/context`?
- **Auto-mode permission / auto gate (plan.md §5.7)**: plan.md references an "auto" permission mode with circuit-breaker + strippedDangerousRules. srs.md lists only plan, confirmation, and standard modes. Is auto mode in scope for Leo's permission system or dropped?
- **Verification-nudge feature (plan.md §3.6)**: `verificationNudgeNeeded` on TodoWrite references a verification subagent. Leo has no subagent / verification role defined in srs.md. Is this nudge kept, dropped, or repurposed?
- **Plan mode in subagent contexts (FR-PLAN-04, plan.md §4.3)**: Leo has no documented subagent execution model in srs.md §2, yet the plan-mode spec explicitly prohibits plan mode in subagents. Does Leo need a subagent concept at all, or is the prohibition vacuous?
- **Plan file path anchor (FR-PLAN-06 vs plan.md §2.2)**: FR-PLAN-06 says `.leo/plans/<slug>.md` (vault-relative). plan.md §2.2 upstream default is `$CLAUDE_CONFIG_HOME/plans/`. Leo must pick: vault-relative only, or also support a user-level directory? NFR-REL-08 implies vault-relative only.
- **`plansDirectory` configurability (NFR-REL-08)**: "Resolved relative to vault root with path-traversal guard" — is the user allowed to point this outside the vault? If yes, does `safeStorage` or equivalent isolation apply?
- **Exclude-list scope (FR-RAG-08)**: Glob patterns are honored for RAG results, but is the exclude list also applied at indexing time (FR-IDX-02 / FR-IDX-03)? Not stated. Could cause useless indexing work.
- **Graph boost on non-indexed sources (FR-RAG-02, FR-RAG-03, FR-IDX-05)**: Graph cache is built from `metadataCache.resolvedLinks`, which includes canvas/non-markdown targets. In v1 only markdown is indexed; what happens when a 1-hop neighbor is a canvas file (phase 4) or a PDF (never indexed)? Are they ignored silently or flagged?
- **`.leo/config.json` vs settings tab (FR-MCP-03, FR-PROV-09, FR-UI-10)**: MCP servers live in `.leo/config.json`; provider settings live in the Obsidian settings tab (persisted via Obsidian's plugin data store). Are these two different storage backends on purpose, and what is the precedence if both disagree?
- **MCP reconnect disable (FR-MCP-11)**: Max 5 attempts then "surface error". Does the user have a way to re-trigger reconnection without reloading the plugin? Missing acceptance criterion.
- **MCP tool per-thread pre-approval semantics (FR-MCP-07 vs FR-AGENT-11)**: FR-MCP-07 defaults MCP tools to `requiresConfirmation: true` unless pre-approved; FR-AGENT-11 says "Allow for thread" persists in thread metadata. Does pre-approval carry over if the thread is later exported/imported, or when an MCP server is removed and re-added?
- **Plan-file writes allowed in plan mode (FR-PLAN-05, plan.md §5.3)**: FR-PLAN-05 names allowed tools as Read/Grep/Glob/WebFetch/plan-file-write. Is `plan-file-write` a distinct tool (e.g., `WritePlan`) or a whitelisted path for the existing `create_note`/`edit_note`? Implementation unclear.
- **Phase 2 CompactionEngine absence vs FR-AGENT-08 (FR-AGENT-08, Phase 2 deliverables)**: Phase 2 ships tool use and edit lock but not CompactionEngine (deferred to phase 5). How does FR-AGENT-08's "Context window overflow handled by CompactionEngine" behave in phases 2–4? Only the pre-compaction fallback (history → RAG truncation)? Hard limit with error?
- **Phase ordering for `/context` dependencies (FR-CTX-*, Phase 5)**: `/context` categorizes tools, skills, agents, memory files. In Leo, "memory files" are undefined (no Obsidian analogue to CLAUDE.md beyond system-prompt injection). Should `/context` omit the Memory Files category entirely, or reuse it for something Leo-specific (e.g., active note)?
- **`logLevel` default 'info' vs NFR-LOG-01 gating (FR-PROV-* calls)**: Provider retries (FR-PROV-06) log at what level? Not specified. Noise vs signal trade-off unstated.
- **Accept/reject UI for non-active-note edits (FR-EDIT-09, FR-AGENT-06)**: Inline diff UI assumes an open editor. How does a user accept/reject a `create_note`/`append_to_note` affecting a currently-closed note? Missing spec.
- **Token usage when cloud not configured (FR-CHAT-11)**: Cost in $ shown only when cloud provider is configured. LM Studio returns no cost by default; is input/output/total still populated from LM Studio's `usage` field (which is optional in OpenAI-compatible implementations)? What if usage is absent — estimate via compact.md §4 Tier 3?
- **`prefers-reduced-motion` scope (FR-UI-12)**: Does this also disable the 3-second modified-region highlight in FR-EDIT-08? Not clarified.
- **Thread-model for phase 2 persistence (FR-CHAT-08 vs Phase 5 "Multiple conversation threads")**: Phase 2 persists a single thread; phase 5 introduces thread CRUD. Is the phase-2 on-disk schema forward-compatible, or will migration be required? Migration path unspecified.
