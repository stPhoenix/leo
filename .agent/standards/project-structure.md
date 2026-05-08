# Project Structure

Directory map. One-line purpose per folder. For per-file detail, read the code — annotations rot.

```
leo/
├── .agent/                              # Planning, standards, scripts (not shipped)
│   ├── architecture/                    # Module map, contracts, data flows
│   ├── budgets/                         # Bundle-size baseline + caps
│   ├── features/                        # Sliced feature planning workspaces (per-slice)
│   ├── scripts/                         # Runbooks + shell scripts (precommit, vault-encryption)
│   ├── srs/                             # Software requirements specs (per slice)
│   └── standards/                       # tech-stack, code-style, best-practices, this file
├── src/
│   ├── agent/                           # Agent loop, plan mode, todo, context, compaction, streaming
│   │   ├── canvas/                      # Canvas slice — create/content_edit/layout_edit subgraphs, sidecar, layouts, palette
│   │   │   ├── layouts/                 # Pure layout engines (grid/tree/radial/force/timeline/bipartite) + sizing + palette
│   │   │   ├── tools/                   # delegate_canvas_* + reveal_in_canvas + shared confirm flow
│   │   │   └── widget/                  # Live widget controller, terminal snapshot, phase state
│   │   ├── compact/                     # /compact live + terminal widget, phaseSink
│   │   ├── externalAgent/               # External-agent delegation — adapter contract, refine, FSM, slot, writer, widget
│   │   │   └── adapters/                # Adapter base + inline-agent network/sanitize helpers
│   │   ├── toolSearch/                  # Deferred-tool fetcher — request assembly, gating, mapping, session
│   │   └── wiki/                        # Wiki slice — ingest, lint, search, inbox; mutex-gated
│   │       ├── inbox/                   # wiki-inbox.md pipe-table parser/serializer
│   │       ├── ingest/                  # FSM ingest pipeline (refine→fetch→plan→extract→reduce→write)
│   │       ├── lint/                    # Wiki page lint pipeline (scan→check→propose→confirm→write)
│   │       └── seed/                    # Initial wiki tree seed content
│   ├── chat/                            # Message store, streaming, attachments, usage, run state
│   ├── editor/                          # CM6 edit lock, editor bridge, focused context, highlights, navigators
│   ├── graph/                           # Link graph cache
│   ├── indexer/                         # Vault + canvas chunking, dirty queue, reindex
│   ├── mcp/                             # MCP client, config, reconnect, resource picker, prompt-skill adapter
│   ├── platform/                        # Logger, sinks, error channel, langfuse tracer, ALS init
│   ├── providers/                       # LLM + embedding providers, langchain bridge, manager, registry, trace
│   ├── rag/                             # RAG engine, graph traversal, scoring, exclude/tag matchers, snapshot
│   ├── settings/                        # Settings tab, wizard, commands, exclude store, external-agents UI
│   ├── skills/                          # Skill parse/store/runtime — conditional, hooks, perms, shell, slash, dynamic
│   ├── storage/                         # VaultAdapter-backed stores (vectors, conversations, threads, plans, safeStorage)
│   ├── tools/                           # Tool registry + builtins + user loader + zod adapter
│   │   ├── builtin/                     # First-party tools (read/write notes, search, glob/grep, askUserQuestion, delegate_*)
│   │   ├── toolSearch/                  # Deferred-tool fetcher tool wiring
│   │   └── user/                        # User-defined tool loader
│   ├── ui/                              # ChatView, blocks, widgets, composer, dialogs, header, notifications
│   │   └── chat/
│   │       ├── blocks/                  # Assistant message blocks (text/thinking/tool/diff/agent/grouped/widgets)
│   │       ├── widgets/                 # Read-only status widgets (/context, /rag, /wiki, /canvas)
│   │       └── hooks/                   # Shared chat-UI hooks
│   ├── util/                            # Generic utils (debounce, delay, fifo)
│   └── main.ts                          # Obsidian plugin entry
├── tests/
│   ├── helpers/                         # Cross-suite test helpers (in-memory VaultAdapter, etc.)
│   ├── unit/                            # Vitest unit suite (happy-dom)
│   ├── dom/                             # React/DOM component tests
│   ├── integration/                     # MSW-backed provider/embedding integration
│   ├── smoke/                           # Release smoke + CM6 checklist + tinyVault fixture
│   ├── perf/                            # Perf fixtures + benches + report
│   └── llm/                             # Live LLM tests (vitest.llm.config.ts)
├── .storybook/                          # Storybook config + mocks + obsidian theme vars
├── scripts/                             # Build/CI helpers (bundle-size guard, etc.)
├── CLAUDE.md                            # Root agent instructions
├── data.json                            # Plugin runtime data
├── esbuild.config.mjs                   # Bundler config
├── main.js                              # Bundled plugin output
├── manifest.json                        # Obsidian plugin manifest
├── package.json
├── pnpm-lock.yaml
├── styles.css                           # Plugin styles (scoped under .leo-* roots)
├── tsconfig.json
├── vitest.config.ts                     # Default vitest config
└── vitest.llm.config.ts                 # Live-LLM vitest config
```

## Conventions

- One folder per slice/concern. Subgraph + widget + tool wiring live together (see `agent/canvas/`, `agent/wiki/`, `agent/externalAgent/`).
- Live widget pattern per slice: `liveControllerRegistry.ts` + `widgetController.ts` + `widgetState.ts` + `terminalSnapshot.ts`. Renderers under `ui/chat/blocks/<Slice>{Live,Terminal}Block.tsx`.
- Status widgets (read-only) under `ui/chat/widgets/`, paired with a `/<slice>StatusCommand.ts` slash command.
- Tools split: `src/tools/builtin/` for first-party, `src/tools/user/` for user-loaded, slice-owned tools nested under the slice (e.g. `agent/canvas/tools/`).
- Path alias `@/*` → `src/*`.
- Naming: `camelCase.ts` modules, `PascalCase.tsx` React components, `kebab-case.md` docs.

## Test suites

- `pnpm test` — default vitest (unit + dom + integration + smoke).
- `pnpm test:llm` — live provider tests (`vitest.llm.config.ts`), requires env keys.
- `pnpm smoke` — release smoke only.
- `pnpm bench` — vitest bench.
- `pnpm lint` — eslint over `src/**` and `tests/**`.
- `pnpm format` / `pnpm format:check` — prettier write / check.
- `pnpm typecheck` — `tsc --noEmit`.
- `pnpm dev` / `pnpm build` — esbuild (dev watch / prod bundle).
- `pnpm check:bundle` — `node scripts/checkBundle.mjs` — asserts `main.js` size delta within cap.
- `pnpm storybook` / `pnpm build-storybook` — Storybook dev server / static build.
