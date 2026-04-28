# Context — External Agent Delegation

Source: [`.agent/srs/external-agent.md`](../../srs/external-agent.md). IDs preserved verbatim from source so cross-references stay traceable.

## Scope

The main Leo assistant gains a structured, user-controlled escape hatch for tasks it cannot complete with its built-in tool set (no matching tool, long-running research, web access required, third-party agent invocation). The escape hatch:

- exposes a built-in trigger tool `delegate_external` that requires user confirmation;
- runs a per-thread LangGraph subgraph independent of the main agent loop;
- includes an LLM-driven refine phase with optional clarifying questions to the user;
- delegates execution to a pluggable, code-defined `ExternalAgentAdapter` (concrete adapters such as Claude Code over stdio or OpenAI-compatible HTTP are sketched in the SRS but **deferred out of v1** per user direction during planning — see Out of scope);
- streams progress through an inline widget the user can edit, cancel, retime;
- persists request + response + auxiliary files to a vault folder excluded from RAG;
- returns a single tool result so the main agent can resume reasoning from produced files.

v1 plan ships the contract + registry + subgraph + widget + settings UI with **zero concrete adapters**. Settings UI must render gracefully when the registry is empty (empty-state with a "Configure adapter" hint).

## Out of scope

- **Concrete built-in adapter implementations** (`claude-code`, `openai-compatible`, etc.) — deferred to a follow-up phase per user direction. v1 plan ships only the contract + registry + plumbing.
- User-supplied adapter `.js` modules loaded from `.leo/adapters/` (deferred to phase 2; same sandbox concerns as user tools).
- Cross-thread / parallel external calls (one slot per thread).
- Resuming an in-flight RUNNING subgraph across plugin reload.
- Auto-attaching produced files to the next user turn — main agent reads them via existing `read_note` / `read_file`.
- Tool ACL prompts on file writes from external agents (all writes confined to one excluded folder).
- Adapters that need direct vault context (refine sub-agent must inline note content into the refined prompt instead).

## Actors

| Actor | Role |
|---|---|
| **End user** | Issues original ask; confirms or denies escalation; answers clarifying questions; edits / sends / cancels the refined prompt; reads result folder. |
| **Main agent** | LangGraph in `src/agent/graph.ts`. Decides when to call `delegate_external` based on tool description + task fit. Resumes after subgraph terminal state. |
| **Refine sub-agent** | LLM loop inside the subgraph. Uses thread provider + core-owned refine system prompt. Emits clarifying questions or `final_prompt`. Restricted to `ask_clarifying_question` and `emit_final_prompt` actions. |
| **External agent** | The third-party system reached through an `ExternalAgentAdapter` (Claude Code CLI, OpenAI-compatible HTTP endpoint, etc.). |
| **Plugin author** (extension actor) | Authors new built-in adapters by subclassing `ExternalAgentAdapter` and registering them at plugin load. |

## Functional requirements

IDs match `.agent/srs/external-agent.md` §3.

### Trigger & confirmation
- **FR-EXT-01** — Built-in `delegate_external` tool registered in `ToolRegistry` at plugin load with description guiding the model to escalate when no other tool fits and the task plausibly needs an external system.
- **FR-EXT-02** — `delegate_external` declares `requiresConfirmation: true`; surface = existing `confirmationController` inline prompt with two actions: **Prepare external agent request** / **Deny**.
- **FR-EXT-03** — Deny → tool returns `{ ok:false, denied:true }`; main agent continues normally; no subgraph started.
- **FR-EXT-04** — Prepare → subgraph mounts an inline widget block in the same thread (assistant-side message); the `delegate_external` tool call enters a suspended state until the subgraph reaches a terminal state.

### One-slot concurrency
- **FR-EXT-05** — At most one external-agent subgraph active per thread; multiple threads may each have one.
- **FR-EXT-06** — Second `delegate_external` call in same thread while one is active returns immediately with `{ ok:false, error:'busy', activeRunId }`; no new widget mounted.

### Refine phase
- **FR-EXT-07** — Subgraph enters `PREPARING`. Refine sub-agent runs an LLM loop using the thread's current provider + the core-owned refine system prompt (`src/agent/externalAgent/refinePrompt.ts`). Adapter has no influence on this prompt.
- **FR-EXT-08** — Refine sub-agent may either (a) emit a clarifying question (triggers LangGraph `interrupt()`; widget renders question; user replies in widget) or (b) emit a `final_prompt`.
- **FR-EXT-09** — Refine iterations are budgeted. Default 3. Configurable in widget before any iteration completes. Reaching budget without `final_prompt` forces transition to `READY` with sub-agent's current best draft.
- **FR-EXT-10** — Refine sub-agent never calls vault tools, web tools, or `delegate_external` recursively. Allowed actions: only `ask_clarifying_question` and `emit_final_prompt`.

### Ready phase
- **FR-EXT-11** — On `READY`, widget shows refined prompt in editable textarea + three actions: **Send**, **Edit**, **Cancel**. Adapter picker and timeout control are visible and modifiable.
- **FR-EXT-12** — **Edit** → back to `PREPARING`; user's edited prompt is next refine input; refine budget is **not** reset.
- **FR-EXT-13** — **Cancel** → `CANCELLED`; tool returns `{ ok:false, cancelled:true, phase:'ready' }`.
- **FR-EXT-14** — **Send** → `RUNNING`. Adapter selected in widget picker (defaulting to global default) is invoked with refined prompt.

### Running phase
- **FR-EXT-15** — Adapter invoked via `adapter.start({ refinedAsk, systemPrompt, signal, timeoutMs, config })`; yields `AsyncIterable<ExternalEvent>`.
- **FR-EXT-16** — Each event updates widget: `text` chunks → streaming response panel; `log` events → collapsible log; `file` events → placeholder until written.
- **FR-EXT-17** — Timeout (`timeoutMs`, default = `adapter.defaultTimeoutMs`, overridable in widget) starts at `start()`; fire → `AbortSignal` → transition to `ERROR` with `error.code='timeout'`.
- **FR-EXT-18** — **Cancel** during `RUNNING` triggers `AbortSignal`; adapter must terminate ≤ 2 s (NFR-EXT-01); partial output discarded; no result folder written; tool returns `{ ok:false, cancelled:true, phase:'running' }`.

### Writing phase
- **FR-EXT-19** — On `done`, transition to `WRITING`; `ResultWriter` creates `externalAgentResults/<runId>/` via `VaultAdapter`.
- **FR-EXT-20** — Always written: `request.md` (refined prompt + adapter id + start/end times), `response.md` (streamed text buffer). Adapter `file` events written under same folder using event's `relPath`; absolute paths or `..` segments rejected.
- **FR-EXT-21** — Folder prefix `externalAgentResults/` added to default RAG exclude list in `excludeListStore` on plugin load (idempotent); also filtered out at `dirtyQueue` intake.
- **FR-EXT-22** — After `WRITING` succeeds, transition to `DONE`; `delegate_external` tool resumes with `{ ok:true, folder, files:string[], summary:string, adapterId, durationMs }`. `summary` = first 500 chars of `response.md`.

### Error handling
- **FR-EXT-23** — Adapter `error` event, unhandled subgraph throw, or timeout → `ERROR`; `ResultWriter` writes `error.md` (code, message, timestamps, adapter id, refined prompt); partial `response.md` flushed.
- **FR-EXT-24** — On `ERROR`, tool returns `{ ok:false, error:{code,message}, folder, files }`; main agent sees structured error and may apologize / suggest retry.

### Widget lifecycle
- **FR-EXT-25** — Widget is an inline assistant message block in the thread (mirrors `PlanApprovalDialog`); part of the conversation record.
- **FR-EXT-26** — After `DONE` / `CANCELLED` / `ERROR`, widget collapses to one-line summary (status icon + adapter label + folder link + duration); remains visible in chat history when thread is reopened; expandable to show recorded refine transcript and final prompt.
- **FR-EXT-27** — Widget exposes: adapter picker (default from settings), timeout input (default from selected adapter), refine-budget input (default 3), Send / Edit / Cancel buttons (state-dependent), live event log, response stream panel.

### Adapters & registry
- **FR-EXT-28** — All adapters are concrete subclasses of `ExternalAgentAdapter`. Built-in adapters imported and registered statically at plugin load.
- **FR-EXT-29** — `AdapterRegistry` (mirrors `ToolRegistry`) exposes `list()`, `get(id)`, `defaultId()`. Default id stored in plugin settings (`externalAgents.defaultAdapterId`).
- **FR-EXT-30** — Adapter declares Zod `configSchema`. Settings tab renders one section per adapter, parsing/saving config under `data.json: externalAgents.<id>.config`. Secret fields (`format:'secret'`) persisted via `SafeStorage`.
- **FR-EXT-31** — Adapter MUST NOT receive `VaultAdapter`, `EditorBridge`, or any vault handle. Only inputs are `ExternalAgentInput`. All file persistence via core `ResultWriter`.
- **FR-EXT-32** — **Deferred from v1.** Concrete built-in adapter implementations are out-of-scope for this v1 plan. The contract, registry, and surrounding plumbing must be such that registering an adapter in a follow-up phase is a purely additive change (single new file under `src/agent/externalAgent/adapters/<id>.ts` + one registration line in `main.ts` + one `data.json` entry).

### Configuration & settings
- **FR-EXT-33** — Settings tab gains "External Agents" section with: global default adapter dropdown, per-adapter config blocks (rendered from `configSchema`), per-adapter `enabled: boolean`.
- **FR-EXT-34** — Disabled adapters do not appear in widget picker. If global default is disabled, first enabled adapter (alphabetical by id) becomes runtime default.

## Non-functional requirements

- **NFR-EXT-01** — Cancel surfaces ≤ 2 s wall-clock from button press to subgraph terminal state. Adapters must respect `AbortSignal` and surface abort as non-error termination.
- **NFR-EXT-02** — Adapter implementations have no access to vault, editor, or other plugin state. Enforced by passing only `ExternalAgentInput` to `start()` (no ambient `LeoContext`).
- **NFR-EXT-03** — Result folder writes are atomic per-file. Mid-write failure must still produce `error.md` describing what was/was not flushed.
- **NFR-EXT-04** — Subgraph state in-memory only. Plugin reload during `RUNNING` discards request; widget rehydrates as `ERROR { code:'reload' }`. Documented in widget collapsed summary.
- **NFR-EXT-05** — Logging: every state transition + adapter event at `debug`; errors at `error`. Refined-prompt and response content NOT logged above `debug` level.
- **NFR-EXT-06** — Bundle: external-agent contract + registry + widget + settings together ≤ 30 KB minified added to `main.js`. No new top-level dependency. (Concrete adapters track their own bundle impact when added in a follow-up phase.)
- **NFR-EXT-07** — All subgraph nodes that touch IO wrapped in `try/finally` for `AbortController` cleanup, `child_process` kill, HTTP body cancellation.
- **NFR-EXT-08** — Subgraph unit-testable end-to-end with a mock adapter (`AsyncIterable` of canned events); no msw or real provider required for state machine tests.

## Constraints

- **C-01** Architecture compliance: must respect `UI → Agent → Domain/Adapters → Platform` rule with no back-edges per [`architecture.md`](../../architecture/architecture.md) §1, §2.
- **C-02** Tech stack fixed: TypeScript 5 strict, React 18, LangGraph.js, Zod, esbuild, IndexedDB via idb, Tailwind, Obsidian APIs only on desktop. See [`tech-stack.md`](../../standards/tech-stack.md).
- **C-03** Local-first: no network egress except user-configured adapter endpoints. Per [`architecture.md`](../../architecture/architecture.md) §1.
- **C-04** No new top-level production dependency unless an adapter genuinely needs one (NFR-EXT-06).
- **C-05** Adapter file imports restricted (NFR-EXT-02): nothing from `src/agent/`, `src/chat/`, `src/ui/`, `src/storage/`, `src/editor/`. Allowed: `zod`, `node:child_process`, `fetch`, adapter-local helpers. Enforced by ESLint `no-restricted-imports` (per [`code-style.md`](../../standards/code-style.md) §"Imports & Module Boundaries").
- **C-06** All UI components must have Storybook fixtures matching existing pattern (`ComponentName.stories.tsx` colocated). User explicitly requested: "don't forget storybooks".
- **C-07** Test stack pinned: Vitest + msw + happy-dom; `fake-indexeddb` for storage tests; live LLM tests in separate config (per [`tech-stack.md`](../../standards/tech-stack.md) §Testing).
- **C-08** Widget block must be persisted in thread JSON via `messageStore` and rehydrate as collapsed summary across thread reopens (FR-EXT-26).
- **C-09** Secrets: any secret config field must use `SafeStorage` indirection per existing convention (`storage/safeStorage.ts`).

## Glossary

| Term | Definition |
|---|---|
| **Main agent** | The thread's primary LangGraph defined in `src/agent/graph.ts`. |
| **Subgraph** | The external-agent LangGraph defined under `src/agent/externalAgent/`. Runs outside main graph; main graph only sees the suspended tool call and its eventual result. |
| **Adapter** | A subclass of `ExternalAgentAdapter` that knows how to call one external system. |
| **Refine sub-agent** | LLM loop inside subgraph that turns the user's original ask into a final, well-scoped prompt. |
| **Refined prompt** | Output of the refine phase. The exact text sent to the adapter. |
| **Widget** | The inline chat message block surfacing subgraph state and accepting user input. |
| **Result folder** | `externalAgentResults/<runId>/` (vault-relative). Holds `request.md`, `response.md`, optional adapter-produced files, and `error.md` on failure. |
| **`runId`** | `YYYYMMDD-HHmmss-<6-char-ulid-tail>`. Sortable, collision-resistant. |
| **`ExternalEvent`** | Discriminated union: `log`, `text`, `file`, `done`, `error`. The only message type yielded by adapters. |
| **`ExternalAgentInput`** | Parameter object passed to `adapter.start()`: `refinedAsk`, `systemPrompt`, `signal`, `timeoutMs`, `config`. |
| **Refine budget** | Max iterations of the refine loop before forcing transition to `READY`. Default 3, widget-configurable. |
| **Confirmation surface** | Existing `confirmationController` inline prompt pattern, reused for the Prepare/Deny gate. |
| **Result writer** | `src/agent/externalAgent/resultWriter.ts`. Sole module that writes adapter outputs to vault. |

## Open questions

Carried from SRS §15 (resolved defaults proposed there; deferred to implementation discretion):

- **OQ-01** Refine sub-agent model: same as thread provider, or per-adapter override? **Proposed default**: same as thread; per-adapter override deferred.
- **OQ-02** Refine sub-agent control surface: tool calls (`ask_clarifying_question`, `emit_final_prompt`) vs structured-output JSON. **Proposed default**: tool calls (reuses LangGraph machinery; streams cleanly).
- **OQ-03** Widget rendering inside main thread vs dedicated tab. **SRS lock**: inline-block (FR-EXT-25). Revisit only if widgets dominate viewport.
- **OQ-04** `runId` format. **SRS lock**: ISO + 6-char ULID tail.
- **OQ-05** Retry button on ERROR widget. **v1**: no. User can re-issue; refine transcript preserved in `messageStore`.

Additional questions surfaced during analysis:

- **OQ-06** When the refine sub-agent emits a clarifying question, does it also append context (e.g. cited vault notes) into the question, or only the question text? Affects widget rendering and `messageStore` payload size. **Proposed default**: question text only; sub-agent inlines any needed context into the *final* prompt.
- **OQ-07** When `Edit` is used at READY, do prior refine messages remain in `refineHistory` or are they pruned to the user's new draft? Affects token cost on re-refine. **Proposed default**: keep history; sub-agent receives the edit as a new turn.
- **OQ-08** Does the collapsed widget summary include adapter-config snapshot (e.g. model name)? Useful for debugging old runs but may surface secrets. **Proposed default**: include non-secret fields only (filtered via `configSchema` `format:'secret'` metadata).
