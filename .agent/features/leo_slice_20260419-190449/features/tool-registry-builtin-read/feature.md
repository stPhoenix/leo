# F16 — Tool registry + `read_note`

## Purpose

Stand up the `ToolRegistry` that every agent tool funnels through, wire its catalogue into the provider's OpenAI-compatible `tools` parameter per [FR-PROV-04](../../context.md#fr-prov-04), extend [F10 agent-controller-core](../agent-controller-core/feature.md)'s serial turn loop to recognise `tool_call` / `tool_result` round-trips against built-in tools declared with `{name, description, parameters, requiresConfirmation}` per [FR-AGENT-04](../../context.md#fr-agent-04), and ship the first concrete entry — a read-only `read_note(path)` tool that resolves file contents through the `VaultAdapter` (i.e. Obsidian Vault API) because the target is a non-active note per [FR-AGENT-06](../../context.md#fr-agent-06). The registry is the seam every later feature (confirmation, write tools, `edit_note`, skill allowlists, MCP) plugs into; this slice proves the seam end-to-end with the safest possible tool.

## Scope

### In scope

- `ToolRegistry` module owning a map of `ToolSpec` entries (`{id, description, schema (Zod), requiresConfirmation, invoke(input, ctx), source: "builtin"}`) with `register / listFor(thread) / lookup(id) / invoke(id, input, ctx)` per the contract fixed in [architecture §4](../../../../architecture/architecture.md#4-key-contracts); skill `allowedTools` filtering is a pass-through hook here (applied by F22) and MCP entries are out of scope (F51).
- Declarative tool schema: every registered tool exposes a `name`, a one-line human/LLM-readable `description`, a Zod parameter schema convertible to JSON Schema for the provider payload, and a `requiresConfirmation` boolean defaulting `true` for write / destructive tools and `false` for read tools per [FR-AGENT-04](../../context.md#fr-agent-04).
- OpenAI-compatible `tools` parameter wiring: at prompt-build time `AgentRunner` asks `ToolRegistry.listFor(thread)` for the tools visible in the current turn, serialises each as `{type:"function", function:{name, description, parameters}}`, and hands the array to `ProviderManager.stream(prompt, {signal, tools})` per [FR-PROV-04](../../context.md#fr-prov-04).
- Serial tool-call loop integration: the [F10](../agent-controller-core/feature.md) turn loop routes provider `tool_call` events through `ToolRegistry.invoke(id, args, ctx)`, streams a `tool_result` event back into the graph, and keeps tool calls strictly serial inside a single turn per [FR-AGENT-04](../../context.md#fr-agent-04) — confirmation, pre-prompting, and Allow-for-thread allowlist are deferred to F17.
- Built-in read-only `read_note(path)` tool: Zod schema `{path: string}` (vault-relative, path-traversal-guarded), `requiresConfirmation: false`, implementation calls `VaultAdapter.read(path)` (Obsidian `Vault` API, the non-active-note surface per [FR-AGENT-06](../../context.md#fr-agent-06)), returns `{ok: true, data: {path, content}} | {ok: false, error}` per [code style — LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer).
- Bootstrap registration: at `Plugin.onload` the built-in `read_note` spec is registered once into the singleton `ToolRegistry`, matching the startup sequence in [architecture §5.1](../../../../architecture/architecture.md#51-plugin-startup).
- Structured log events (`tool.register`, `tool.invoke.start`, `tool.invoke.ok`, `tool.invoke.error`) through the F01 `Logger`; Vitest coverage for registry CRUD, JSON-Schema serialisation, serial-loop ordering, and `read_note` happy / not-found / traversal-blocked paths.

### Out of scope

- Inline tool-confirmation flow (pause turn, emit `tool_confirmation` event, Allow once / Allow for thread / Deny, thread-scoped allowlist) → ships with [F17 tool-confirmation-flow](../../features-index.md).
- Write tools (`create_note`, `append_to_note`) via `VaultAdapter` → ship with [F19 tools-write-vault](../../features-index.md).
- `edit_note(path, line_start, line_end, new_content)` via `EditorBridge` under edit lock with accept/reject → ships with [F20 tool-edit-note-with-lock](../../features-index.md).
- Skill `allowedTools` filtering and per-skill tool restriction → ships with [F22 skills-picker-active-skill](../../features-index.md); `ToolRegistry.listFor(thread)` exposes the hook but applies no filter yet.
- MCP-sourced tools, namespace `mcp.<server>.<tool>`, and parallel discovery → ship with [F51 mcp-client-config-transports](../../features-index.md) and later.

## Acceptance criteria

1. `ToolRegistry.register(spec)` accepts a `ToolSpec` with `{id, description, schema (Zod), requiresConfirmation, invoke, source: "builtin"}`; duplicate ids throw; `listFor(thread)` returns the full registry for now (skill-filter hook is a pass-through); `lookup(id)` returns the spec or undefined. (FR-AGENT-04)
2. At prompt-build time `AgentRunner` serialises `listFor(thread)` into the OpenAI-compatible `tools` array — each entry `{type:"function", function:{name, description, parameters}}` with `parameters` produced from the Zod schema as JSON Schema — and passes it to `ProviderManager.stream`; when the registry is empty the `tools` key is omitted. (FR-PROV-04)
3. When the provider emits a `tool_call` event during a turn, `AgentRunner` looks up the tool via `ToolRegistry.lookup(id)`, invokes `spec.invoke(args, ctx)` with the turn's `AbortSignal`, feeds the `ToolResult` back as a `tool_result` event, and only then resumes the provider stream; a second `tool_call` in the same turn starts only after the first `tool_result` is emitted (strict serial order). (FR-AGENT-04)
4. The built-in `read_note` tool is registered at `Plugin.onload` with `requiresConfirmation: false`, Zod schema `{path: string}`, and invokes `VaultAdapter.read(path)` — i.e. the non-active-note Vault API surface — returning `{ok:true, data:{path, content}}` on success. (FR-AGENT-06)
5. `read_note` rejects traversal-unsafe paths (e.g. `../`, absolute paths) with `{ok:false, error}` before touching the vault, and returns `{ok:false, error}` when the file does not exist; no exception escapes `invoke`. (FR-AGENT-04, FR-AGENT-06)
6. Structured log events `tool.register` (once per spec at load), `tool.invoke.start`, `tool.invoke.ok`, `tool.invoke.error` are emitted via the F01 `Logger` with `{toolId, thread, durationMs}` fields; `read_note` results are not logged verbatim (content may be large / sensitive — path + byte count only). (FR-AGENT-04)
7. Vitest unit suite covers: duplicate-id rejection, Zod → JSON-Schema serialisation shape, `tools` parameter omitted when registry is empty, serial `tool_call` → `tool_result` ordering against a mocked provider, `read_note` happy path via a fake `VaultAdapter`, missing-file error, and traversal-guard rejection. (FR-PROV-04, FR-AGENT-04, FR-AGENT-06)

## Dependencies

- [F10 agent-controller-core](../agent-controller-core/feature.md) — provides the `AgentRunner` singleton, serial turn loop, `AbortController` plumbing, and prompt-build seam that this feature extends with a `tools` parameter and a `tool_call` / `tool_result` branch per [FR-AGENT-01](../../context.md#fr-agent-01), [FR-AGENT-07](../../context.md#fr-agent-07), [FR-AGENT-09](../../context.md#fr-agent-09).
- Drives requirements [FR-PROV-04](../../context.md#fr-prov-04), [FR-AGENT-04](../../context.md#fr-agent-04), [FR-AGENT-06](../../context.md#fr-agent-06).
- Downstream consumers tracked in [features-index.md](../../features-index.md): F17 (tool confirmation), F19 (write tools), F20 (`edit_note` with lock), F22 (skill `allowedTools` filter), F33 (`search_vault`), F40 (user tools), F51 (MCP tools).

## Implementation notes

- [Architecture §1 — Registry pattern for tools](../../../../architecture/architecture.md#1-architectural-principles) — every tool funnels through `ToolRegistry`; the agent never imports tool implementations directly.
- [Architecture §3.2 Agent Layer — ToolRegistry](../../../../architecture/architecture.md#32-agent-layer) — places `ToolRegistry` beside `AgentRunner` / `GraphBuilder`; this feature delivers it with the `listFor(thread)` hook for skill filtering.
- [Architecture §3.4 Adapters — VaultAdapter](../../../../architecture/architecture.md#34-adapters) — `read_note` MUST go through `VaultAdapter.read`, never `app.vault.adapter` directly.
- [Architecture §4 Key Contracts — ToolSpec / ToolCtx / StreamEvent.tool_call](../../../../architecture/architecture.md#4-key-contracts) — pins the `{id, description, schema, requiresConfirmation, invoke, source}` shape and the `tool_call` / `tool_result` event types this feature implements.
- [Architecture §5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup) — `Plugin.onload` registers built-in tools into `ToolRegistry` alongside settings / skills / view.
- [Architecture §5.3 Chat Turn (with tool call + confirmation)](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation) — canonical flow this feature realises up to the `tool_call` → invoke → `tool_result` path; the confirmation branch is F17.
- [Architecture §8 Extension Points — New tool (built-in)](../../../../architecture/architecture.md#8-extension-points) — "Define `ToolSpec`, register in `ToolRegistry` on load" is the pattern `read_note` follows.
- [Architecture §11 Mapping SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules) — `FR-AGENT-*` routes to `AgentRunner` / `ToolRegistry` / `ContextAssembler` / `Truncator`.
- [Tech stack — Tool schemas](../../../../standards/tech-stack.md#core-stack) — pins Zod via `@langchain/core/tools` `tool()` for tool input/output typing.
- [Tech stack — Agent / Tool / Skill / MCP Wiring](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) — built-in tools registered via `@langchain/core/tools` `tool()` with Zod schemas at plugin load.
- [Code style — Zod & Tool Schemas](../../../../standards/code-style.md#zod--tool-schemas) — one Zod schema per tool input; `z.infer` for TS; no dual declaration.
- [Code style — LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer) — tool results typed `{ok: true, data} | {ok: false, error}`; no thrown errors escape tools; `AbortSignal` threaded through `invoke(ctx)`.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — never touch `app.vault.adapter` directly; go through `VaultAdapter`.
- [Code style — Error Handling](../../../../standards/code-style.md#error-handling) — adapters catch platform errors and surface typed `Result` / `ToolResult`; tools trust inputs only after Zod parse.
- [Code style — Logging](../../../../standards/code-style.md#logging) — fixes the `event: "tool.*"` structured field shape used by the four log events.
- [Code style — Comments & Docs](../../../../standards/code-style.md#comments--docs) — public tool specs get a one-line `description` field (the LLM reads it).
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — selects the harness; provider is mocked at the `ProviderManager` seam, `VaultAdapter` is faked in-memory.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — KISS + Single Responsibility: the registry is a pure lookup; invocation rules live in the turn loop; `read_note` does one thing.

## Open questions

- Zod → JSON Schema conversion library choice — SRS / standards don't name one; LangChain's `zodToJsonSchema` helper is the common path, but the verifier should confirm it is acceptable as a transitive dependency versus writing a minimal converter for the tiny shapes Leo needs.
- Maximum `read_note` response size — SRS is silent. Large notes could balloon the turn's token budget. Proposing a soft cap (e.g. 200 KB) with a `{ok:false, error:"note too large"}` fallback, deferred to F41 (`token-estimator-3tier`) for definitive sizing.
- Path-traversal guard semantics — FR-AGENT-06 names the Vault API but not the guard policy. Proposing: reject any path containing `..`, starting with `/`, or resolving outside the vault root via `normalize`; mirrors [NFR-REL-08](../../context.md#nfr-rel-08)'s plans-directory guard.
