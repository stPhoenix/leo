# Leo

Local-first chat, RAG, and agent plugin for [Obsidian](https://obsidian.md).

Leo embeds an AI assistant into your vault. The agent has live access to the active note, your cursor and selection, and the entire vault through a lazily built RAG / GraphRAG index. It can read, create, and edit notes while you watch the changes appear in the editor — under an explicit edit lock with accept / reject UI.

> **Status**: 0.0.1 — desktop only. Built against Obsidian `1.5.0+`.

---

## Features

### Chat & UI

- Sidebar chat panel with streaming markdown, code copy, syntax highlighting, and per-message actions (copy, regenerate, edit-and-resend, delete).
- Multiple conversation threads, persisted to `.leo/conversations/`.
- Composer with paste / drop attachments, `@`-mention vault files, and `/` slash-commands (`/context`, `/rag`, custom skills).
- Stop streaming mid-response — in-flight tool calls finish atomically, the rest are skipped.
- Inline tool-confirmation prompts (Allow once / Allow for thread / Deny) for any write or destructive tool.
- Token usage shown per message; cost shown when a cloud provider is configured.
- Fully themed via Obsidian CSS variables — light, dark, and custom themes work out of the box.

### Editor integration

- CM6 EditorBridge tracks cursor, selection, and viewport — debounced and cheap.
- Programmatic edits go through `EditorTransaction` under a single "Leo edit" undo step.
- Edit lock (CM6 readonly decoration) blocks user keystrokes in the range being modified, with a 3 s flash highlight on completion.
- Inline diff UI for accept / reject; reject reverts atomically.
- `open_note` and `reveal_in_note` tools — agent can jump you to a file, a line, or a selection.

### Agent

- LangGraph.js state-graph agent loop: gather-context → retrieve → model → tools → route.
- Built-in tools: `read_note`, `create_note`, `edit_note`, `append_to_note`, `delete_note`, `move_note`, `copy_note`, `create_folder`, `delete_folder`, `list_notes`, `search_vault`, `glob_vault`, `grep_vault`, `read_file`, `open_note`, `reveal_in_note`, `TodoWrite`, `AskUserQuestion`, `EnterPlanMode` / `ExitPlanMode`, `delegate_external`.
- Skills: reusable prompt presets (`{name, description, systemPrompt, allowedTools?, defaultModel?}`) stored in `.leo/skills/`. Built-in skills bundled; user skills user-editable.
- Plan mode: read-only exploration with plan-file authoring under `.leo/plans/<slug>.md`, gated by an Approve / Edit / Reject dialog.
- Per-thread tool allowlists — "Allow for thread" remembered until the thread is deleted.
- Cancellation everywhere via `AbortController`.
- External-agent delegation subgraph (refine → ready → running → writing) with adapter registry, per-thread one-slot concurrency, and a live widget.

### Retrieval (RAG / GraphRAG)

- Heading-based chunking with fixed-size fallback (~512-token overlap); markdown + canvas.
- Local embeddings via LM Studio (or any OpenAI-compatible `/v1/embeddings`).
- IndexedDB vector store with `{model, dim, version}` Index Header — reindex on model change.
- 1-hop + 2-hop graph boost from `metadataCache.resolvedLinks`, plus tag-shared boost.
- Tag and exclude (glob) filters.
- Lazy dirty-queue indexing yielding to the main thread; status-bar progress.
- `/rag` widget for live index status; `/context` widget for token breakdown and suggestions.

### Providers

- LM Studio (default) and any OpenAI-compatible local server.
- OpenAI, Anthropic via official SDKs.
- Streaming, FIFO request queue, exponential-backoff retries, 120 s per-request timeout.
- Auto-detect models via `/v1/models`.
- Cloud API keys stored in Electron `safeStorage` (OS keyring) — never plaintext in the vault.
- Langfuse tracing integration (optional).

### Compaction & context

- Layered: microcompaction (tool-result clearing) → autocompaction (threshold summarization) → full / partial / session-memory.
- 3-tier token counting (API usage → hybrid estimate → `len/4` fallback).
- Prompt-too-long recovery via group-based head truncation, max 3 retries.
- Preserves `tool_use` / `tool_result` pairing and thinking-block continuity through every slice.

### MCP (Model Context Protocol)

- Leo acts as an MCP host. Stdio + HTTP+SSE transports.
- Server config in `.leo/config.json` (`mcpServers` shape compatible with the standard MCP host config).
- Discovered tools registered as `mcp.<serverId>.<toolName>` (confirmation-gated by default).
- Resources insertable via picker; prompts surfaced as skills.
- Reconnect with exponential backoff; clean stdio shutdown on plugin unload.

### Privacy

- 100% local by default. No telemetry. No cloud calls unless you configure a cloud provider or cloud-backed MCP server.
- All vault state lives under `<vault>/.leo/` — config, conversations, skills, plans, logs. Embeddings live in IndexedDB.

---

## Install (users)

Leo is not yet in the Obsidian community plugin directory. Install manually:

1. Download the latest release artifacts: `main.js`, `manifest.json`, `styles.css`.
2. Copy them into `<your-vault>/.obsidian/plugins/leo/`. Create the folder if it does not exist.
3. In Obsidian → Settings → Community plugins → Installed plugins, enable **Leo**.
4. Open Leo from the ribbon icon or the command palette (`Leo: Open chat`).
5. Configure your provider in Settings → Leo. For LM Studio, point the endpoint at `http://localhost:1234/v1` (or whichever port LM Studio shows) and pick a chat model and an embedding model.

A first-time setup wizard guides you through provider configuration on first launch.

### Requirements

- Obsidian **desktop** ≥ 1.5.0 (mobile not supported — relies on Electron APIs).
- For local inference: a running OpenAI-compatible server. [LM Studio](https://lmstudio.ai/) is the reference target; Ollama with its OpenAI shim works too.

---

## Install (development)

### Prerequisites

- Node 20 LTS
- pnpm (`npm i -g pnpm`)
- An Obsidian vault you are willing to use as a dev vault

### Clone & build

```bash
git clone <repo-url> leo
cd leo
pnpm install
pnpm dev          # esbuild watch → main.js
```

### Wire into a dev vault

Symlink the repo as a plugin in your dev vault:

```bash
# from the repo root
mkdir -p /path/to/dev-vault/.obsidian/plugins
ln -s "$PWD" /path/to/dev-vault/.obsidian/plugins/leo
```

Reload Obsidian (or use the **Hot-Reload** community plugin to pick up `main.js` rebuilds automatically). Enable Leo in Settings → Community plugins.

### Scripts

| Command                             | What it does                                                    |
| ----------------------------------- | --------------------------------------------------------------- |
| `pnpm dev`                          | esbuild watch build → `main.js` (sourcemaps inline)             |
| `pnpm build`                        | Production bundle (minified)                                    |
| `pnpm check:bundle`                 | Bundle-size guard against `.agent/budgets/bundle-baseline.json` |
| `pnpm typecheck`                    | `tsc --noEmit`                                                  |
| `pnpm lint`                         | ESLint over `src/` and `tests/`                                 |
| `pnpm format` / `pnpm format:check` | Prettier write / check                                          |
| `pnpm test`                         | Default Vitest suite (unit + dom + integration + smoke)         |
| `pnpm test:llm`                     | Live-LLM tests (`vitest.llm.config.ts`, requires API keys)      |
| `pnpm smoke`                        | Release smoke only                                              |
| `pnpm bench`                        | Vitest benches                                                  |
| `pnpm storybook`                    | Storybook dev server (UI components in isolation)               |
| `pnpm build-storybook`              | Static Storybook build                                          |

### Repo layout

High-level — see `.agent/standards/project-structure.md` for the full tree.

```
src/
├── agent/        agent loop, compaction, plan mode, todos, context, streaming, external-agent subgraph
├── chat/         message store, streaming, attachments, usage, run state
├── editor/       CM6 edit lock, focused context, highlights, workspace navigation
├── graph/        link graph cache
├── indexer/      vault + canvas chunking, dirty queue, reindex
├── mcp/          MCP client, config, reconnect, resource picker, prompt-skill adapter
├── platform/     logger, sinks, error channel, langfuse tracer
├── providers/    LLM + embedding providers, langchain bridge, content normalization
├── rag/          RAG engine, graph traversal, scoring, exclude / tag matchers
├── settings/     settings tab, wizard, commands, exclude store
├── skills/       skill parse / store / editor, registry, runtime
├── storage/      IndexedDB stores, vault adapter, safeStorage, vectors
├── tools/        tool registry + builtin + user tool loader + zod adapter
├── ui/           chat view, blocks, widgets, composer, picker, dialogs
└── main.ts       Obsidian plugin entry
```

### Standards

Project-internal docs live under `.agent/`:

- `.agent/srs/` — software requirements (chat, editor, agent, RAG, MCP, plan mode, compaction, context, livestatus, external-agent, skills).
- `.agent/standards/` — `tech-stack.md`, `project-structure.md`, `code-style.md`, `best-practices.md`.
- `.agent/architecture/architecture.md` — module map, contracts, data flow.
- `.agent/budgets/bundle-baseline.json` — bundle-size baseline.

---

## License

MIT.
