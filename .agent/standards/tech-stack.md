# Tech Stack

Leo Obsidian plugin. Desktop-only. Local-first. TypeScript.

## Runtime & Build

| Layer           | Choice                               | Notes                                              |
| --------------- | ------------------------------------ | -------------------------------------------------- |
| Language        | TypeScript 5.x                       | Strict mode on.                                    |
| Target          | Obsidian desktop (Electron renderer) | `minAppVersion` 1.5.0 in `manifest.json`.          |
| Bundler         | esbuild                              | Obsidian plugin standard. Single `main.js` output. |
| Package manager | pnpm                                 | Faster installs, strict hoisting.                  |
| Node            | 20 LTS                               | Dev only. Runtime is Electron.                     |

## UI Layer

| Layer                | Choice                                                                                               | Notes                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Framework            | React 18                                                                                             | Mount via `createRoot` inside `ItemView.onOpen`. Unmount in `onClose`.                           |
| Chat UI              | **`@assistant-ui/react`**                                                                            | Streaming, markdown, tool-call rendering, abort, code-copy built in.                             |
| Assistant UI runtime | **LangGraph adapter** (`@assistant-ui/react-langgraph`)                                              | Wires LangGraph stream → Assistant UI message store.                                             |
| Styling              | Tailwind CSS + CSS scoping                                                                           | Scope to plugin root to avoid bleeding into notes. Obsidian CSS variables for theme integration. |
| Markdown render      | Obsidian `MarkdownRenderer.render` for inbound note content; Assistant UI markdown for chat messages | Two renderers — chat uses Assistant UI's `react-markdown`; note previews use native Obsidian.    |
| Icons                | `lucide-react`                                                                                       | Matches Obsidian's Lucide-based icon set.                                                        |

## Agent Layer

| Layer           | Choice                                              | Notes                                                                                                        |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Agent framework | **LangGraph.js** (`@langchain/langgraph`)           | State-graph agent loop. Nodes: gather-context → retrieve (RAG) → model → tools → route.                      |
| LLM bindings    | `@langchain/openai` `ChatOpenAI`                    | Point `configuration.baseURL` at `http://localhost:<port>/v1` for LM Studio.                                 |
| Tool schemas    | Zod via `@langchain/core/tools` `tool()`            | Typed tool inputs/outputs. Tools: `read_note`, `create_note`, `edit_note`, `append_to_note`, `search_vault`. |
| Streaming       | LangGraph `.stream()` with `streamMode: "messages"` | Token-level streaming into Assistant UI.                                                                     |
| Cancel          | `AbortController` → passed to `.stream({ signal })` | Implements FR-AGENT-09 / FR-CHAT-05.                                                                         |
| Checkpointing   | `MemorySaver` (v1) → file-based later               | Persists agent state per conversation.                                                                       |

## Retrieval Layer

| Layer          | Choice                                                                       | Notes                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Embeddings     | Direct `fetch` to LM Studio `/v1/embeddings`                                 | No lib. Small adapter class wraps call + retry.                                                                             |
| Vector store   | Naive in-memory cosine (v1 phase 3) → `hnswlib-wasm` (phase 5 if slow)       | Linear scan handles 10k × 1024-dim fine. Swap behind `VectorStore` interface.                                               |
| Persistence    | **IndexedDB via `idb`**                                                      | ~3 KB lib. Stores chunks, embeddings, Index Header.                                                                         |
| Graph cache    | `app.metadataCache.resolvedLinks` + own `Map<string, Set<string>>` adjacency | Built from Obsidian native, symmetric (merge forward + back).                                                               |
| Chunking       | Own module (no lib)                                                          | Heading-based split, fallback fixed-size 512-token overlap. Parse headings via `metadataCache.getFileCache(file).headings`. |
| Tag extraction | `metadataCache.getFileCache(file).tags` + frontmatter                        | Native.                                                                                                                     |

## Platform APIs

| API                                                               | Use                                                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Plugin`                                                          | Lifecycle (`onload`, `onunload`). Register views, commands, events.                            |
| `ItemView`                                                        | ChatView sidebar.                                                                              |
| `WorkspaceLeaf`                                                   | Open chat in right sidebar.                                                                    |
| `Vault`                                                           | File CRUD for non-active notes. Events: `create`, `modify`, `delete`, `rename`.                |
| `MetadataCache`                                                   | Links, tags, headings, frontmatter. Events: `resolved`, `changed`.                             |
| `Editor` + CodeMirror 6 (`@codemirror/state`, `@codemirror/view`) | EditorBridge. StateField for cursor/selection/viewport. Decorations for edit lock + highlight. |
| `MarkdownRenderer`                                                | Inbound note previews.                                                                         |
| `Notice` + `addStatusBarItem`                                     | User-visible errors, indexing progress, connection status.                                     |
| `PluginSettingTab`                                                | Settings UI (endpoint, models, temperature, etc.).                                             |
| `loadData` / `saveData`                                           | Plugin config persistence.                                                                     |
| Electron `safeStorage` (via `electron` global)                    | Future cloud provider API keys.                                                                |

## Storage Layout

```
<vault>/.leo/
├── config.json           # plugin settings (non-secret)
├── conversations/        # one JSON per thread
│   └── <id>.json
├── index/                # IndexedDB exports? No — IndexedDB lives in Obsidian's origin
│   └── header.json       # {model, dim, version} mirror for debugging
└── logs/
    ├── leo.log
    └── leo.log.1 ... .5  # rotated 1MB × 5
```

IndexedDB holds actual embeddings (not in vault filesystem — too big, binary unfriendly to git/sync).

## Testing

| Layer                     | Tool                | Notes                                                              |
| ------------------------- | ------------------- | ------------------------------------------------------------------ |
| Unit                      | **Vitest**          | Pure logic: chunking, RAG scoring, graph boost, queue, truncation. |
| Mock HTTP                 | **`msw`**           | Fixture LM Studio server for provider tests.                       |
| Integration (agent graph) | Vitest + `msw`      | Run LangGraph with mocked LLM responses.                           |
| CM6 / editor              | Manual in dev vault | CM6 hard to unit-test; doc test-vault recipe in repo.              |
| Release smoke             | Manual checklist    | Per NFR-TEST-04.                                                   |

## Tooling & Quality

| Tool                          | Use                                                                    |
| ----------------------------- | ---------------------------------------------------------------------- |
| ESLint + `@typescript-eslint` | Lint.                                                                  |
| Prettier                      | Format.                                                                |
| `tsc --noEmit`                | Type check in CI.                                                      |
| `obsidian-typings`            | Extended type defs beyond official `obsidian` package where needed.    |
| Hot reload (dev)              | `esbuild --watch` + Obsidian plugin reloader plugin for the dev vault. |

## Dependencies — Production

```
react, react-dom
@assistant-ui/react
@assistant-ui/react-langgraph
@langchain/langgraph
@langchain/core
@langchain/openai
@modelcontextprotocol/sdk   # phase 6 — MCP host client
zod
idb
lucide-react
obsidian  (peer / external)
```

## Dependencies — Dev

```
typescript
esbuild
vitest
msw
@types/react, @types/react-dom, @types/node
eslint, @typescript-eslint/*
prettier
obsidian  (types)
builtin-modules  (esbuild externals)
```

## Externals (not bundled)

`obsidian`, `electron`, Node built-ins. Configured in esbuild `external` list.

## Bundle Budget

Target < 1.5 MB minified `main.js`. Heavy hitters: React (~130 KB), LangGraph + LangChain core (~300 KB), Assistant UI (~200 KB). Rest < 200 KB. Tree-shake LangChain — import only used modules (`@langchain/core/messages`, not root).

## Agent / Tool / Skill / MCP Wiring

| Concept                      | Implementation                                                                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in tools               | `@langchain/core/tools` `tool()` with Zod schemas. Registered in `ToolRegistry` at plugin load.                                                                                                                                                                 |
| User-defined tools (phase 5) | Config-driven declarations in `.leo/tools/*.json`; optional sandboxed JS snippet via `Function` constructor (documented-risk; user owns).                                                                                                                       |
| Skills                       | Markdown/JSON files in `.leo/skills/`. Parsed into `Skill` objects. Selected skill's `systemPrompt` injected into LangGraph state at thread init. `allowedTools` filters ToolRegistry per thread.                                                               |
| Tool confirmation            | LangGraph `interrupt()` pattern — pause graph before tool node, emit confirmation event to ChatView, resume on user decision. Per-thread allowlist persisted with thread.                                                                                       |
| MCP client (phase 6)         | `@modelcontextprotocol/sdk/client` with `StdioClientTransport` and `SSEClientTransport`. Discovered tools wrapped as LangChain `DynamicStructuredTool` with namespace prefix, injected into ToolRegistry. MCP prompts → Skills. MCP resources → context insert. |

## Open Decisions

- Assistant UI theme: default tokens mapped to Obsidian CSS vars, or fully custom Tailwind theme? Defer to phase 1.
- Vector store upgrade trigger: measure at 5k notes. If p95 RAG > 200ms, swap to HNSW.
- LangGraph checkpoint storage: in-memory v1. File-based (`.leo/checkpoints/`) phase 2+ for resume.
- User-defined JS tools sandbox: `Function` constructor (simple, limited isolation) vs spawned Node worker (safer, more complex). Decide phase 5.
- MCP stdio child process lifecycle in Obsidian renderer: confirm `child_process` accessible without Electron preload gymnastics before phase 6 kickoff.
