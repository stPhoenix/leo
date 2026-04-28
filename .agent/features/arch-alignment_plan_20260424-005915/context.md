# Context — align code with architecture

Source of truth: [/home/bs/PycharmProjects/leo/.agent/architecture/architecture.md](../../architecture/architecture.md) and [/home/bs/PycharmProjects/leo/.agent/srs/srs.md](../../srs/srs.md).

Task driver: user request "we need to align code with the architecture and fix drifted/broken implementation". SRS functional behaviors are mostly satisfied; architecture-level implementation contract has drifted. Goal = bring code to match architecture contract, not the reverse.

## Scope

- Align runtime orchestration layer (`src/agent/`) to architecture §1, §3.2, §4, §5.3.
- Align tool-system contract (`src/tools/`) to architecture §4 `ToolSpec` signature.
- Align UI → agent stream contract to architecture §4 `StreamEvent`.
- Close file-layout gaps against architecture §9 (only where missing modules are referenced — not cosmetic casing).
- Remove stale metadata that lies about implementation (e.g. `package.json` `keywords: ["langgraph"]`).

## Out of scope

- Rewriting SRS functional requirements (FR-*) — those are intact.
- Pure cosmetic file renames PascalCase↔camelCase unless the arch doc references a missing module name.
- Net-new features beyond the alignment set.
- Phase-6 MCP work not yet scheduled.
- Performance re-tuning (NFR-PERF-*) — covered by existing modules.
- Doc-side edits to architecture.md (goal is code-first alignment).

## Actors

- **User of Leo plugin** — unaffected behaviorally; sees same chat stream, tool confirmations, plan mode.
- **Plugin developer** — primary beneficiary; code matches docs again.
- **LLM provider** (LM Studio, Anthropic, OpenAI-compatible) — contract unchanged.
- **MCP servers** — future; uniform `ToolSpec` keeps integration path.

## Functional requirements

Each FR is a drift gap between the committed architecture contract and current code. IDs below are local to this plan.

### Runtime orchestration

- **FR-01** — AgentRunner SHALL dispatch turns through a LangGraph `StateGraph` (per architecture §1 "Interrupt-driven tool flow", §2 layer diagram `GRAPH[LangGraph StateGraph]`, §3.2 `GraphBuilder`).
- **FR-02** — A `GraphBuilder` module SHALL construct and return a compiled graph per thread given `{provider, tools, skill, RAG}` (architecture §3.2 row "GraphBuilder").
- **FR-03** — Tool-confirmation gating SHALL be implemented via the graph's `interrupt()` + resume mechanism, not an ad-hoc `confirmTool` callback (architecture §1 "Interrupt-driven tool flow", §5.3 sequence).
- **FR-04** — `AgentRunner.send(msg, thread)` SHALL return `AsyncIterable<StreamEvent>` (architecture §4 `AgentRunner` interface). Current `EventChannel` push API SHALL be replaced or wrapped.

### Stream contract

- **FR-05** — The `StreamEvent` union exposed to the UI SHALL include all variants from architecture §4: `token`, `tool_call`, `tool_confirmation` (with `resolve` callback), `tool_result`, `usage`, `done`, `error`. Current provider-level events (`token|tool_call|usage|done|error`) SHALL be normalised by `AgentRunner` into the architectural union before reaching the UI.

### Tool schema

- **FR-06** — `ToolSpec` SHALL expose a `schema: z.ZodType` field (architecture §4 `ToolSpec`). The current `JsonSchema`+`validate` pair SHALL be derived from the zod schema (e.g. `zod-to-json-schema`) for OpenAI tool serialization.
- **FR-07** — `ToolCtx` SHALL surface `vault: VaultAdapter` and `editor: EditorBridge` fields (architecture §4 `ToolCtx`). Current closure-injected access SHALL migrate to context fields.

### Missing modules

- **FR-08** — `src/agent/graph.ts` SHALL exist and house the StateGraph build logic (architecture §9 layout).
- **FR-09** — Built-in tools SHALL live under `src/tools/builtin/` (architecture §9 `src/tools/builtin/readNote.ts`, `createNote.ts`, `editNote.ts`, `appendToNote.ts`, `searchVault.ts`). Current flat `src/tools/*.ts` layout SHALL be consolidated.

### Metadata truth

- **FR-10** — `package.json` SHALL declare actual dependencies required by the aligned runtime (`@langchain/langgraph`, `zod`, `zod-to-json-schema`). The "langgraph" keyword SHALL remain accurate only after FR-01 ships.

## Non-functional requirements

- **NFR-01** — No regression in SRS §3 functional surface during migration. All existing Vitest suites SHALL pass on every merged PR (reference: [tech-stack.md](../../standards/tech-stack.md), [best-practices.md](../../standards/best-practices.md)).
- **NFR-02** — Incremental rollout: each feature SHALL ship as an independently mergeable change with its own tests (reference: [best-practices.md](../../standards/best-practices.md)).
- **NFR-03** — Token/streaming throughput SHALL not degrade past 60fps rendering target (SRS NFR-PERF-05). Benchmark before/after graph migration.
- **NFR-04** — Graph migration SHALL preserve microcompact, autocompact, PTL retry, plan-mode gating, skill envelope injection, and tool-allowlist semantics — no behavior removed in transit.
- **NFR-05** — Public `AgentRunner` API surface change SHALL be typed; callers (ChatView, tests) migrated in the same commit that flips the return type (reference: [code-style.md](../../standards/code-style.md)).

## Constraints

- Language / build / editor: per [tech-stack.md](../../standards/tech-stack.md).
- Obsidian plugin desktop-only; no Node-only APIs in paths reachable from the renderer except those already whitelisted (child_process for MCP, safeStorage for secrets).
- Vitest-only test framework; `msw` for provider fixtures (SRS NFR-TEST-*).
- `@langchain/langgraph` is JS package on npm; confirm license + bundle-size cost before adoption.
- Must keep `fetch`-based SSE parsing for non-graph providers (graph does not replace provider transport).

## Glossary

| Term | Definition |
|---|---|
| Drift | Divergence between committed doc (architecture.md) and current code. |
| StateGraph | LangGraph construct representing the agent turn as a node/edge machine. |
| Interrupt | LangGraph primitive that pauses execution at a node until resumed with external input. |
| Graph build | Per-thread compilation of `StateGraph` with bound provider/tools/skill. |
| EventChannel | Current push-based event bus in `agentRunner.ts:711–752`. |
| ToolSpec | Tool registration record; shape specified in architecture.md §4. |
| Skill envelope | Result shape produced by skill-invocation tools that injects messages + context modifier into the agent loop. |

## Open questions

1. **LangGraph variant** — TypeScript `@langchain/langgraph` has both functional and graph APIs. Which matches architecture §5.3 (`AR→G: stream(state)` implies graph with streaming)? Assume graph API unless user objects.
2. **Interrupt-based confirmation** — Does migration require swapping the existing `ConfirmationController` / `confirmTool` plumbing entirely, or can the graph interrupt wrap it? Default plan: graph interrupt as the single source, controller becomes a consumer.
3. **File-casing convention** — Architecture §9 uses PascalCase filenames; existing code uses lowerCamelCase; project [code-style.md](../../standards/code-style.md) likely codifies lowerCamel. Assumption: do **not** rename existing files solely for casing. Only create missing files (e.g. `graph.ts`) using project convention.
4. **Zod adoption cost** — Does zod add unacceptable bundle weight for an Obsidian plugin? If yes, counter-proposal is to update architecture.md to describe the current `JsonSchema` + `validate` pair instead of zod. Flag to user before detail phase of FR-06.
5. **Tool layout consolidation** — Moving `readNoteTool.ts` → `builtin/readNote.ts` (FR-09) breaks all import paths. Worth the churn vs doc patch? Default: perform move once at feature-ship time with a single codemod commit.
6. **Remove vs keep `EventChannel`** — Simplest migration: AgentRunner internal still uses EventChannel, adapts to `AsyncIterable<StreamEvent>` at the public boundary. Confirm acceptable.
