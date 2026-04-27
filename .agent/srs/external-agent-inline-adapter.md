# Leo — Inline Agent Adapter (SRS)

Companion to `external-agent.md`. Specifies the **Inline Agent** adapter: a built-in `ExternalAgentAdapter` implementation that runs an LLM-driven LangGraph subgraph inside the Obsidian renderer with its own provider/model and an isolated sandbox toolset (web + scoped filesystem). The subgraph routes each request between a single-loop ReAct branch (simple tasks) and a plan→research→synthesize branch (deep research) based on a classifier node.

This SRS is the contract. Every requirement (`FR-IA-*` / `NFR-IA-*`) maps to at least one module in §10.

---

## 1. Purpose & Scope

### 1.1 Purpose

Give users a general-purpose, configurable "delegated worker" that the main assistant can hand off arbitrary research/composition tasks to. The Inline Agent:

- runs as a LangGraph `StateGraph` using a provider + model selected per-adapter (independent of the thread provider);
- routes each request through a classifier node into either a **simple** branch (`createReactAgent`) or a **multistep** branch (planner → per-step bounded research → synthesizer);
- has a fixed, code-defined toolset (web fetch, web search, sandbox file ops, artifact publishing, plus an internal `extract_note` tool used only by the multistep branch) — **no overlap with main-agent tools**;
- operates inside an OS-temp sandbox folder scoped to one `runId`, wiped on terminal state;
- emits `ExternalEvent`s (per §7 of `external-agent.md`) so the host subgraph, widget, and result writer treat it like any other adapter.

The adapter satisfies §3.9 of `external-agent.md` — it is one concrete `ExternalAgentAdapter` subclass registered at plugin load.

### 1.2 In Scope (v1)

- Single adapter id `inline-agent`, registered statically in `main.ts`.
- Configurable provider + model (any entry in `providers/registry.ts`), temperature, system-prompt override, iteration / token / wall-clock budgets.
- Sandbox under `<os.tmpdir>/leo-inline-agent/<runId>/`, created on `start()`, wiped in `finally`.
- **Routing**: classifier-driven dispatch between simple (`createReactAgent`) and multistep (planner → per-step research → synthesizer) branches; user-overridable via `routing.mode`.
- **Multistep state**: per-run note buffer + scratchpad; raw tool results discarded after `extract_note` consumption.
- Built-in tools: `fetch_url`, `search_web` (Tavily-backed), `read_file`, `write_file`, `list_dir`, `delete_file`, `publish_artifact`. Plus internal `classify_task` (structured-output only) and `extract_note` (multistep-only).
- Per-tool config: enabled toggle, allowlist/blocklist, byte/time caps, sandbox quota.
- Streaming text + tool-call logs surfaced as `text` / `log` `ExternalEvent`s.
- On `done`: published artifacts emitted as `file` events, sandbox wiped.

### 1.3 Out of Scope (v1)

- Process- or container-level isolation. Sandbox is **logical** (path-prefix guard inside the renderer process). Documented under §4 NFR-IA-02.
- Shell / subprocess execution from inside the agent.
- Persisting sandbox across runs or resuming partial runs.
- Cross-run artifact reuse (each run is fresh).
- User-supplied tools inside the inline agent (separate concern; user-tools loader is for the main agent only).
- Inline agent calling `delegate_external` recursively — explicitly disallowed.

### 1.4 Architectural Deviations

These are intentional departures from `architecture.md` rules. Each is documented here so reviewers don't mistake them for bugs.

| Deviation | Architecture rule | Why deviated |
|---|---|---|
| **Inline tools bypass `ToolRegistry`.** `fetch_url`, `search_web`, `read_file`, `write_file`, `list_dir`, `delete_file`, `publish_artifact`, `extract_note`, `classify_task` are LangChain `tool()` instances built per-run inside the adapter and never registered in the global `ToolRegistry`. | architecture.md §1 *Registry pattern for tools*: "All tools (built-in, user-defined, MCP) funnel through `ToolRegistry`." | Per-run isolation is core to the adapter contract (`external-agent.md` FR-EXT-31, NFR-EXT-02). Putting inline tools in the global registry would (a) expose them to the main agent — violating isolation, (b) break the recursion guard FR-IA-51 since the main agent could then call inline tools that operate on a non-existent sandbox, (c) require a `ToolCtx` shape they cannot satisfy (no `vault`, no `editor`). The `ToolRegistry` invariant "everything callable by the main agent is registered" remains intact: nothing inline is callable by the main agent. |
| **Inline tools are not `ToolSpec`s.** They use a different injected ctx shape and are not invoked through `ToolCtx`. | architecture.md §4 `ToolSpec` / `ToolCtx` contracts. | `ToolCtx` mandates `vault` + `editor`, both forbidden for adapters. Inline tools take `{ config, signal, sandbox, logger, runState }` instead. See §2 Glossary. |

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Inline Agent** | This adapter's runtime: a LangGraph `StateGraph` executing in the Obsidian renderer. |
| **Sandbox** | The temp working directory exclusively writable by the Inline Agent for one `runId`. |
| **Artifact** | A sandbox file the Inline Agent has nominated for publication via `publish_artifact`. Only artifacts cross the sandbox → vault boundary. |
| **Inline tool** | A LangChain `tool()` instance built per-run inside the adapter and bound to one `runState` + `sandbox`. **NOT** a `ToolSpec` (architecture.md §4) and **does not** receive `ToolCtx` (no `vault`, no `editor`). Injected ctx shape: `{ config, signal, sandbox, logger, runState }`. Never registered with the main `ToolRegistry` — see §1.4. |
| **Iteration** | One model → tool → model round-trip in any ReAct loop (simple branch or research-step sub-loop). Counted cumulatively against `maxIterations`. |
| **Route** | Resolved branch for the run: `'simple'` or `'multistep'`. Decided by the classifier or by `routing.mode` override. |
| **Plan** | Ordered list of sub-questions produced by the planner (or by the classifier as `initialPlan`). One plan step = one `researchStep` invocation. |
| **Note** | A `NoteRecord` written by `extract_note`. Compact, model-distilled snapshot of one source. The only multistep state that survives across plan steps. |
| **Scratchpad** | Multistep working buffer carried into `synthesize`. Optional; populated when a research-step writes notes summarizing intermediate reasoning. |

---

## 3. Functional Requirements

### 3.1 Adapter Declaration

| ID | Requirement |
|---|---|
| **FR-IA-01** | `InlineAgentAdapter extends ExternalAgentAdapter` is exported from `src/agent/externalAgent/adapters/inlineAgent/index.ts` and registered in `main.ts` plugin load via `adapterRegistry.register(new InlineAgentAdapter(deps))`. |
| **FR-IA-02** | `id = 'inline-agent'`, `label = 'Inline Agent'`, `defaultTimeoutMs = 300_000` (5 min), `capabilities = { files: true, stream: true }`. |
| **FR-IA-03** | `configSchema` is a Zod schema covering provider/model selection, prompt override, budgets, and per-tool config (§6). |
| **FR-IA-04** | The adapter file imports nothing from `src/agent/` (other than its own folder and `adapters/base.ts`), `src/chat/`, `src/ui/`, `src/storage/`, `src/editor/`, **or sibling adapters under `src/providers/`**. Allowed: `zod`, `@langchain/langgraph`, `@langchain/core/*` subpaths, `@langchain/openai`, `node:fs/promises`, `node:os`, `node:path`, `fetch`. Provider access is **dependency-injected** via the constructor (FR-IA-05a) — the adapter never imports `providers/registry.ts` directly. Enforced by ESLint `no-restricted-imports`. |
| **FR-IA-05a** | `InlineAgentAdapter` constructor accepts `{ providerFactory, logger }` where `providerFactory(providerId, model, opts) → ChatModel` is supplied by `main.ts` at registration time (DI root, mirrors `LeoContext` pattern in architecture.md §3.1). The adapter holds no module-level reference to the provider registry. |

### 3.2 Provider & Model Configuration

| ID | Requirement |
|---|---|
| **FR-IA-05** | Settings expose a `providerId` dropdown (sourced from `providers/registry.ts`) and a `model` text input. The pair is validated lazily on `start()` — invalid pair surfaces as `error.code = 'invalid_provider'`. |
| **FR-IA-06** | The adapter MUST NOT inherit the active thread's provider. The configured `providerId/model` is the only LLM call source. |
| **FR-IA-07** | `temperature` defaults to provider default; user-overridable in `[0, 2]`. |
| **FR-IA-08** | `systemPromptOverride` (optional). When unset, the adapter uses a built-in inline-agent system prompt (`src/agent/externalAgent/adapters/inlineAgent/systemPrompt.ts`) describing available tools, sandbox rules, artifact-publication contract, and termination expectations. The adapter prepends `ExternalAgentInput.systemPrompt` (core-owned) ahead of its own. |

### 3.3 Sandbox

| ID | Requirement |
|---|---|
| **FR-IA-09** | On `start()`, the adapter creates `<os.tmpdir>/leo-inline-agent/<runId>/` (mode `0o700`). All inline file tools are scoped to this directory. |
| **FR-IA-10** | Every inline file tool resolves user-supplied `relPath` via `path.resolve(sandboxRoot, relPath)` and rejects when the resolved absolute path does not start with `sandboxRoot + path.sep`. Rejected paths return `{ ok: false, error: 'path_outside_sandbox' }` from the tool. Symlinks under the sandbox are rejected (lstat check) to prevent escape. |
| **FR-IA-11** | The sandbox is wiped via `fs.rm(sandboxRoot, { recursive: true, force: true })` in a `finally` block guaranteed to run on done, error, abort, or unexpected throw. |
| **FR-IA-12** | Total sandbox bytes are capped by `sandboxQuotaBytes` (default 50 MB, max 500 MB). `write_file` checks projected total before writing and returns `{ ok: false, error: 'quota_exceeded' }` when over. |

### 3.4 Tool Surface

All inline tools are LangChain `tool()` definitions with Zod schemas. They are isolated from the main `ToolRegistry` — no inline tool is exposed to the main agent.

#### 3.4.1 `fetch_url`

| ID | Requirement |
|---|---|
| **FR-IA-13** | Inputs: `url: string` (must parse as `https:` or `http:` per config), `method?: 'GET'|'POST'` (default GET), `headers?: Record<string,string>`, `body?: string` (only with POST), `responseFormat?: 'text'|'json'` (default text). |
| **FR-IA-14** | Optional `allowlist: string[]` (host patterns, glob-style) and `blocklist: string[]` in config. Allowlist takes precedence: if non-empty, only matching hosts are reachable; blocklist filters within. Default config: empty allowlist, blocklist `['localhost', '127.0.0.1', '0.0.0.0', '169.254.0.0/16', '*.local']` to discourage SSRF into the user's network. |
| **FR-IA-15** | Per-call timeout = `fetchUrl.timeoutMs` (default 30 s). Response body capped at `fetchUrl.maxBytes` (default 5 MB). Truncation surfaces as `{ ok: true, data: { body, truncated: true, totalBytes } }`. |
| **FR-IA-16** | Each call emits a `log` `ExternalEvent` (`info`) with `{ url, method, status, durationMs, bytes }` — never headers or body. |

#### 3.4.2 `search_web` (Tavily)

| ID | Requirement |
|---|---|
| **FR-IA-17** | Inputs: `query: string` (1–400 chars), `maxResults?: number` (1–20, default 5), `searchDepth?: 'basic'|'advanced'` (default `'basic'`), `topic?: 'general'|'news'` (default `'general'`), `includeAnswer?: boolean` (default `true`), `includeDomains?: string[]` (max 32), `excludeDomains?: string[]` (max 32). |
| **FR-IA-18** | The tool POSTs `https://api.tavily.com/search` with body `{ api_key, query, search_depth, max_results, topic, include_answer, include_raw_content: false, include_images: false, include_domains, exclude_domains }`. `api_key` is read from `config.tools.searchWeb.apiKeyRef` (SafeStorage indirection per `external-agent.md` §11). `include_raw_content` and `include_images` are forced `false` in v1 to keep result payloads bounded. |
| **FR-IA-19** | Per-call timeout = `searchWeb.timeoutMs` (default 20 s). Response capped at `searchWeb.maxBytes` (default 256 KB); over-cap response → `{ ok: false, error: 'too_large' }`. |
| **FR-IA-20** | Result mapped to `{ ok: true, data: { answer?: string, results: Array<{ title: string, url: string, content: string, score: number }>, responseTimeMs: number } }`. Tavily's `raw_content` and `images` fields are dropped even if present. |
| **FR-IA-21** | When `enabled === true` but `apiKeyRef` is missing or `SafeStorage.decrypt` fails, the tool returns `{ ok: false, error: 'not_configured' }` and emits a one-shot `log` `warn` per run. When `enabled === false`, the tool is omitted from the agent's tool list entirely. |
| **FR-IA-22** | Each call emits a `log` `info` event with `{ queryLength, maxResults, depth, status, durationMs, resultCount }` — never the raw query, answer, URLs, or content (NFR-IA-05). Full request/response payloads are logged at `debug` only. |
| **FR-IA-23** | Tavily auth/rate/quota errors map by HTTP status: `401`/`403` → `error: 'auth_failed'`; `429` → `error: 'rate_limited'`; `5xx` → `error: 'upstream_error'`; other non-2xx → `error: 'http_error'` with `status` preserved. |

#### 3.4.3 Sandbox file ops

| ID | Requirement |
|---|---|
| **FR-IA-24** | `read_file(relPath, offset?, limit?)` — read text/bytes from sandbox; offset/limit in bytes; `maxBytes` cap (default 1 MB) enforced. Binary detection mirrors `tools/builtin/readFileShared.ts` logic but is reimplemented inline (no cross-import to main tools). |
| **FR-IA-25** | `write_file(relPath, content, encoding?)` — write text/bytes; creates parent dirs; respects sandbox quota (FR-IA-12). |
| **FR-IA-26** | `list_dir(relPath?)` — returns `{ entries: { name, type: 'file'|'dir', bytes? }[] }` for sandbox paths only; default `relPath = ''` (root). |
| **FR-IA-27** | `delete_file(relPath)` — removes a file or empty dir from sandbox. Returns `{ ok: false, error: 'not_empty' }` for non-empty dirs (no recursive delete). |

#### 3.4.4 `publish_artifact`

| ID | Requirement |
|---|---|
| **FR-IA-28** | `publish_artifact(relPath, summary?: string)` marks a sandbox file for publication. The adapter buffers the nomination; nothing crosses the sandbox boundary until terminal `done`. |
| **FR-IA-29** | At most `maxArtifacts` (default 32) may be published per run. Exceeding returns `{ ok: false, error: 'artifact_limit' }`. |
| **FR-IA-30** | On terminal `done`, the adapter reads each published artifact, emits one `ExternalEvent` of type `file` (`{ relPath, content, mime? }`) per artifact in nomination order, then emits `{ type: 'done' }`. The host `ResultWriter` (per `external-agent.md` FR-EXT-20) writes them under `externalAgentResults/<runId>/`. |
| **FR-IA-31** | If a published artifact has been deleted from the sandbox by the time `done` is processed, the adapter logs a `warn` event and skips it (does not abort the run). |

### 3.5 Task Routing

| ID | Requirement |
|---|---|
| **FR-IA-32** | A `classify_task` node runs first. Single LLM call against the configured provider/model with structured output via tool call: `{ route: 'simple' \| 'multistep', reasoning: string, initialPlan?: string[] }` (`initialPlan` ≤ `planMaxSteps` items, omitted when `route === 'simple'`). The classifier prompt includes the refined ask and the **runtime tool inventory** — `{ toolId, oneLineDescription }` for every inline tool that will be enabled in this run (i.e. post `enabled` filter). The classifier is given no tools other than `classify_task`. |
| **FR-IA-33** | When the classifier fails (LLM error, schema parse failure, or output mismatching the tool schema after one retry), the adapter falls back to `route: 'simple'` with empty `initialPlan` and emits a `log` `warn` event `{ reason }`. The run continues on the simple branch. |
| **FR-IA-34** | `config.routing.mode: 'auto' \| 'simple' \| 'deep'` (default `'auto'`). `'simple'` and `'deep'` skip the classifier entirely — `'simple'` enters the simple branch with no plan; `'deep'` enters the multistep branch and the planner (FR-IA-37) generates the plan from scratch. Mode is exposed in Settings and in adapter config. |

### 3.6 Simple Branch

| ID | Requirement |
|---|---|
| **FR-IA-35** | The simple branch instantiates `createReactAgent` (from `@langchain/langgraph/prebuilt`) with the configured `ChatModel` and the inline tool list **excluding** `extract_note` (which is multistep-only). |
| **FR-IA-36** | Termination: assistant message without tool calls → routes to the shared `publishArtifacts` node, then `done`. Reaching the per-branch iteration cap → `error.code = 'iteration_limit'` (partial published artifacts, if any, are still flushed). |

### 3.7 Multistep Branch

| ID | Requirement |
|---|---|
| **FR-IA-37** | A `planner` node accepts `initialPlan` from the classifier when present; otherwise it issues one LLM call with structured output `{ plan: string[] }`. Plan length is clamped to `[1, planMaxSteps]` (default 8, max 16). Empty / unparsable plan → fall back to simple branch (`log` `warn`). |
| **FR-IA-38** | For each step in `plan`, the adapter runs a `researchStep` node = a bounded `createReactAgent` over a tool subset that includes `search_web`, `fetch_url`, `read_file`, `write_file`, `list_dir`, `delete_file`, and a mandatory `extract_note`. `publish_artifact` is **excluded** from the research-step tool list — publication only happens in `synthesize`. |
| **FR-IA-39** | `extract_note({ sourceUrl?, title, summary, relevance })` appends a `NoteRecord` to the run's note buffer. Once `extract_note` is called referencing a prior `fetch_url` / `search_web` result, that raw tool-result message is replaced in subsequent model invocations within the same step by a one-line stub `[discarded — see note <id>]`. Cross-step state: only `notes`, `scratchpad`, and the original ask survive into the next step's prompt; raw tool messages are dropped at step boundary unconditionally. |
| **FR-IA-40** | After all steps complete (or any single step exits with `iteration_limit`), the `synthesize` node runs. Its prompt receives only `{ refinedAsk, plan, notes, scratchpad }` — no raw tool-result messages. It may call `publish_artifact` (only here) and emits final assistant text. Termination: assistant message without tool calls → `done`. |
| **FR-IA-41** | Per-step iteration budget = `floor(remainingIterations / remainingSteps)`, recomputed at step start. Unused budget rolls forward. Budget exhaustion mid-step terminates that step with `notes` intact, advances to the next step (does not abort the whole run). The `synthesize` node reserves a fixed minimum of 4 iterations regardless of remaining budget. |

### 3.8 Shared Run Budgets

| ID | Requirement |
|---|---|
| **FR-IA-42** | `maxIterations` caps cumulative model→tool round-trips across classifier + planner + research-steps + synthesize. Defaults: 12 when route resolves to `'simple'`, 32 when route resolves to `'multistep'`. Hard max: 64. |
| **FR-IA-43** | `maxTokens` (default 100_000, max 1_000_000) is the cumulative input+output token cap across the run, computed from `tokenEstimator.ts` over assembled messages and observed completion usage. Exceeding terminates with `error.code = 'token_limit'`. |
| **FR-IA-44** | `wallClockMs` is enforced via `AbortController` armed inside `start()`. Default = `min(ExternalAgentInput.timeoutMs, 300_000)`. The host's `signal` is composed with the inline timer — either firing terminates the run. |

### 3.9 Streaming → ExternalEvent Mapping

| ID | Requirement |
|---|---|
| **FR-IA-45** | LangGraph stream chunks of model token deltas → `ExternalEvent { type: 'text', chunk }`. The classifier and planner nodes do **not** stream `text` events (their output is structured-only); they emit a single `log` `info` event on completion (`{ node, route?, planLength?, durationMs }`). |
| **FR-IA-46** | Tool-call start: `log` event `info` with `{ tool, args }` where `args` is JSON-serialized with values longer than 256 chars elided. `fetch_url` `args.body` and `search_web` `args.query` / `args.includeDomains` / `args.excludeDomains` are elided to length / count only at `info`; `extract_note` `args.summary` elided to length only at `info`; full values at `debug` (per NFR-EXT-05). |
| **FR-IA-47** | Tool-call result: `log` event `debug` with `{ tool, ok, error?, durationMs }`. Result payloads themselves are not logged. |
| **FR-IA-48** | Adapter-level errors thrown out of LangChain (provider failure, schema validation) → `ExternalEvent { type: 'error', error: { code, message } }` and the iterable terminates. The adapter never throws synchronously out of `start()`. |

### 3.10 Cancellation

| ID | Requirement |
|---|---|
| **FR-IA-49** | The composed `AbortSignal` is passed to every `fetch`, `ChatModel.stream`, and `tool.invoke` across all nodes (classifier, planner, research-step, synthesize, simple-branch ReAct). |
| **FR-IA-50** | On abort, in-flight tools must reject within ≤ 1 s. The adapter awaits in-flight settlements with a 2 s grace, then forces termination. The sandbox cleanup `finally` block always runs. (Satisfies host NFR-EXT-01.) |

### 3.11 Recursion Guard

| ID | Requirement |
|---|---|
| **FR-IA-51** | No node's tool list ever contains `delegate_external` or any other `ExternalAgentAdapter`-driving tool. There is no path by which the inline agent can invoke another external agent. |

---

## 4. Non-Functional Requirements

| ID | Requirement |
|---|---|
| **NFR-IA-01** | The sandbox guarantees only **logical** isolation (path-prefix + lstat checks). It does not protect against bugs in the renderer process or against the configured LLM extracting the user's data via tool arguments. The Settings UI surfaces this in a one-line caveat under the adapter section. |
| **NFR-IA-02** | All tool inputs are validated by Zod at the tool boundary. No `as any` / `unknown` casts past the boundary. |
| **NFR-IA-03** | The adapter adds ≤ 25 KB minified to `main.js` (LangGraph + LangChain core are already paid for by the main agent). Verified via `pnpm check:bundle` after registration. |
| **NFR-IA-04** | All file IO uses `node:fs/promises` with explicit error mapping (no thrown `ENOENT` leaks past the tool). |
| **NFR-IA-05** | Logging namespace `externalAgent.adapter.inlineAgent.*`. URLs, queries, body content above `info` level are elided to lengths only. |
| **NFR-IA-06** | Unit tests cover: sandbox path-escape rejection, symlink rejection, quota enforcement, `fetch_url` allow/block/timeout/byte cap, ReAct termination at iteration/token/wall-clock cap, abort cleanup, artifact publication ordering, missing-artifact warn-and-skip, recursion guard absence in tool list. Mocked provider via `msw` + injected `ChatModel` for stream control. |
| **NFR-IA-07** | The adapter is fully unit-testable without spawning a real provider: tool node + sandbox + budget enforcement are exercisable with a fake `ChatModel` that emits scripted tool-call sequences. |

---

## 5. Inline Agent State

The adapter does not expose a public state shape — its state lives inside the LangGraph ReAct subgraph. Externally observable state is the `ExternalEvent` stream and the buffered artifact nominations. Internal counters tracked for budget enforcement:

```ts
type InlineRoute = 'simple' | 'multistep';

interface NoteRecord {
  readonly id: string;                  // 'n1', 'n2', ...
  readonly stepIndex: number | null;    // null when produced outside a step (rare)
  readonly sourceUrl?: string;
  readonly title: string;
  readonly summary: string;             // distilled, bounded length (≤ 2 KB)
  readonly relevance: number;           // 0..1, model-supplied
  readonly createdAt: number;
}

interface InlineAgentRunState {
  readonly runId: string;
  readonly sandboxRoot: string;

  // Routing
  route: InlineRoute | null;            // null until classifier resolves
  routingMode: 'auto' | 'simple' | 'deep';

  // Multistep state (undefined on simple branch)
  plan?: readonly string[];
  currentStep?: number;
  notes: NoteRecord[];                  // empty on simple branch
  scratchpad: string;                   // multistep synthesizer working buffer

  // Budgets
  iterations: number;                   // cumulative across all nodes
  cumulativeTokens: number;
  sandboxBytes: number;

  // Output
  publishedArtifacts: Array<{ relPath: string; summary?: string }>;
  startedAt: number;
}
```

These counters live on the adapter instance per `start()` call, not in the host subgraph state.

---

## 6. Configuration

`data.json` excerpt:

```json
{
  "externalAgents": {
    "inline-agent": {
      "enabled": true,
      "config": {
        "providerId": "openai-compatible",
        "model": "gpt-4o-mini",
        "temperature": 0.2,
        "systemPromptOverride": null,
        "routing": {
          "mode": "auto"
        },
        "planner": {
          "planMaxSteps": 8
        },
        "budgets": {
          "maxIterationsSimple": 12,
          "maxIterationsMultistep": 32,
          "maxTokens": 100000,
          "wallClockMs": 300000
        },
        "sandbox": {
          "quotaBytes": 52428800,
          "maxArtifacts": 32
        },
        "tools": {
          "fetchUrl": {
            "enabled": true,
            "allowlist": [],
            "blocklist": [
              "localhost", "127.0.0.1", "0.0.0.0",
              "169.254.0.0/16", "*.local"
            ],
            "timeoutMs": 30000,
            "maxBytes": 5242880
          },
          "searchWeb": {
            "enabled": true,
            "apiKeyRef": "safeStorage:externalAgents.inline-agent.tavilyApiKey",
            "defaultMaxResults": 5,
            "defaultSearchDepth": "basic",
            "defaultTopic": "general",
            "includeAnswer": true,
            "timeoutMs": 20000,
            "maxBytes": 262144
          },
          "fileOps": {
            "enabled": true
          }
        }
      }
    }
  }
}
```

The Settings tab section renders this from `configSchema` introspection (per `externalAgentResolver.ts` `describeConfigSchema`). No bespoke React form.

---

## 7. Tool Schemas (summary)

```ts
fetch_url: { url: string; method?: 'GET'|'POST'; headers?: Record<string,string>;
             body?: string; responseFormat?: 'text'|'json' }
  → { ok: true; data: { status: number; headers: Record<string,string>;
                        body: string|object; truncated?: boolean; totalBytes: number } }
  | { ok: false; error: 'blocked'|'timeout'|'too_large'|'invalid_url'|'http_error'; status?: number }

search_web: { query: string; maxResults?: number; searchDepth?: 'basic'|'advanced';
              topic?: 'general'|'news'; includeAnswer?: boolean;
              includeDomains?: string[]; excludeDomains?: string[] }
  → { ok: true; data: { answer?: string;
                        results: Array<{ title: string; url: string; content: string; score: number }>;
                        responseTimeMs: number } }
  | { ok: false; error: 'not_configured'|'auth_failed'|'rate_limited'
                       |'upstream_error'|'http_error'|'timeout'|'too_large'|'invalid_query';
      status?: number }

read_file:  { relPath: string; offset?: number; limit?: number }
  → { ok: true; data: { content: string; encoding: 'utf-8'|'base64'; bytesRead: number; eof: boolean } }
  | { ok: false; error: 'path_outside_sandbox'|'not_found'|'too_large'|'is_directory' }

write_file: { relPath: string; content: string; encoding?: 'utf-8'|'base64' }
  → { ok: true; data: { bytesWritten: number; sandboxBytes: number } }
  | { ok: false; error: 'path_outside_sandbox'|'quota_exceeded' }

list_dir:   { relPath?: string }
  → { ok: true; data: { entries: Array<{ name: string; type: 'file'|'dir'; bytes?: number }> } }
  | { ok: false; error: 'path_outside_sandbox'|'not_found'|'not_directory' }

delete_file: { relPath: string }
  → { ok: true; data: { deleted: true } }
  | { ok: false; error: 'path_outside_sandbox'|'not_found'|'not_empty' }

publish_artifact: { relPath: string; summary?: string }
  → { ok: true; data: { published: number; remaining: number } }
  | { ok: false; error: 'path_outside_sandbox'|'not_found'|'artifact_limit'|'duplicate' }

// Internal nodes — exposed only inside the inline agent graph, never to the host.
classify_task: { route: 'simple'|'multistep'; reasoning: string;
                 initialPlan?: string[] }                                 // structured-output only

extract_note: { sourceUrl?: string; title: string;
                summary: string; relevance: number }                       // multistep-only tool
  → { ok: true; data: { id: string; noteCount: number } }
  | { ok: false; error: 'summary_too_large'|'note_limit' }
```

All schemas declared in `src/agent/externalAgent/adapters/inlineAgent/tools/schemas.ts`, `z.infer`-typed, fields `.describe()`d for the LLM.

---

## 8. Sandbox Layout

```
<os.tmpdir>/leo-inline-agent/
└── <runId>/                          # mode 0o700, created in start(), removed in finally
    ├── <agent-created-files>...      # working files; only `publish_artifact`-nominated ones cross the boundary
```

`runId` reuses the host subgraph `runId` (per `runId.ts`). On collision (extreme: same ms + tail), `start()` rejects with `error.code = 'sandbox_collision'`. The sandbox does not survive plugin reload — orphaned directories from prior runs are swept on adapter construction (best-effort: `fs.rm` of any `leo-inline-agent/<runId>` whose mtime is > 1 hour old; failures logged at `warn`, not fatal).

---

## 9. Error Handling

| Failure | Handling |
|---|---|
| Configured `providerId` missing from registry | `error.code = 'invalid_provider'` before any tool call. |
| Configured `model` rejected by provider | First model call surfaces provider error → `error.code = 'provider_error'`, message preserved. |
| Sandbox `mkdir` fails | `error.code = 'sandbox_init_failed'`, no tools invoked, `start()` iterable terminates. |
| Tool input fails Zod parse | LangChain surfaces validation error → tool returns `{ ok: false, error: 'invalid_args', details }`. Loop continues; LLM may retry. |
| `fetch_url` host blocked | `{ ok: false, error: 'blocked' }`. Logged at `info`. |
| `fetch_url` body exceeds `maxBytes` | Body truncated and `truncated: true` returned. Not an error. |
| `write_file` exceeds `quotaBytes` | `{ ok: false, error: 'quota_exceeded' }`. |
| Artifact missing at flush time | `log` `warn` `{ relPath, reason: 'artifact_missing' }`, skip; other artifacts still emitted. |
| Iteration / token / wall-clock budget hit | `error.code = 'iteration_limit'` / `'token_limit'` / `'timeout'`. |
| AbortSignal fires (host cancel) | Loop exits, sandbox cleanup runs, no `done`. Host treats as cancellation. |
| Sandbox cleanup `fs.rm` fails | Logged at `warn`. Does not affect run outcome. |
| Classifier returns garbage / fails | Fall back to `route: 'simple'` (FR-IA-33). Run continues. |
| Planner returns empty / unparsable plan | Fall back to simple branch (FR-IA-37). Run continues. |
| Research-step exhausts per-step iteration budget | Step terminates with current `notes` intact, advances to next step (FR-IA-41). Whole-run termination only when *cumulative* `maxIterations` is hit. |
| `extract_note` `summary` exceeds size cap | `{ ok: false, error: 'summary_too_large' }`. Loop continues; LLM may retry with shorter summary. |
| Inline agent attempts `delegate_external` (cannot — not in toolset) | N/A (FR-IA-51). |

---

## 10. Module Map

All new modules live under `src/agent/externalAgent/adapters/inlineAgent/`. Layer rule: Agent (Adapter). No imports from `src/chat/`, `src/ui/`, `src/storage/`, `src/editor/`.

| Module | Responsibility |
|---|---|
| `adapters/inlineAgent/index.ts` | `InlineAgentAdapter` class. Constructor takes `{ providerFactory, logger }` (DI per FR-IA-05a — no module-level import of `providers/registry.ts`). Implements `ExternalAgentAdapter`. Exports a factory used by `main.ts`. |
| `adapters/inlineAgent/configSchema.ts` | Full Zod schema for the config object in §6. Secret-flagged fields (none in v1) tagged with `.describe('secret')`. |
| `adapters/inlineAgent/systemPrompt.ts` | Pure. Returns the inline-agent base system prompt (tool list, sandbox rules, artifact-publication contract, termination instructions). |
| `adapters/inlineAgent/sandbox.ts` | `Sandbox` class: `init()`, `resolve(relPath)`, `check(absPath)`, `bytes()`, `addBytes(n)`, `cleanup()`. Owns the path guard and quota counter. |
| `adapters/inlineAgent/runState.ts` | Per-run mutable state: route, plan, currentStep, notes, scratchpad, iterations, tokens, sandboxBytes, publishedArtifacts. Pure data + tick helpers. |
| `adapters/inlineAgent/budgets.ts` | Pure helpers: per-branch iteration cap selection, per-step budget split (FR-IA-41), token tick, wallClock controller wiring, threshold comparisons. |
| `adapters/inlineAgent/tools/schemas.ts` | All Zod schemas from §7 (including internal `classify_task`, `extract_note`). |
| `adapters/inlineAgent/tools/fetchUrl.ts` | `fetch_url` tool factory. Takes `{ config, signal, sandbox, logger }`. |
| `adapters/inlineAgent/tools/searchWeb.ts` | `search_web` Tavily-backed factory. POSTs `https://api.tavily.com/search`; reads `apiKey` from `SafeStorage` via `apiKeyRef`. |
| `adapters/inlineAgent/tools/fileOps.ts` | `read_file`, `write_file`, `list_dir`, `delete_file` factories. |
| `adapters/inlineAgent/tools/publishArtifact.ts` | `publish_artifact` factory. |
| `adapters/inlineAgent/tools/extractNote.ts` | `extract_note` factory. Mutates `runState.notes`; returns `{ id, noteCount }`. Multistep-only. |
| `adapters/inlineAgent/eventBridge.ts` | LangGraph stream → `ExternalEvent` translator. Owns elision rules (NFR-IA-05) and node-level metadata logging (FR-IA-45). |
| `adapters/inlineAgent/router.ts` | `classify_task` node. Builds the runtime tool inventory snapshot, calls the classifier LLM, parses structured output, applies routing-mode override (FR-IA-34), surfaces fallback (FR-IA-33). |
| `adapters/inlineAgent/branches/simpleBranch.ts` | Builds the simple branch: `createReactAgent` over the inline tool list minus `extract_note`. |
| `adapters/inlineAgent/multistep/planner.ts` | `planner` node — accepts `initialPlan` or generates one via single LLM call (structured output). |
| `adapters/inlineAgent/multistep/researchStep.ts` | `researchStep` node — bounded `createReactAgent` per plan step over the multistep tool subset; rewrites consumed tool-result messages to stubs after `extract_note` (FR-IA-39). |
| `adapters/inlineAgent/multistep/synthesize.ts` | `synthesize` node — receives `{ refinedAsk, plan, notes, scratchpad }` only; may call `publish_artifact`; emits final assistant text. |
| `adapters/inlineAgent/multistep/messageRewriter.ts` | Pure helper for FR-IA-39 message-history rewriting (replace consumed raw tool results with stubs; drop raw messages at step boundaries). |
| `adapters/inlineAgent/graph.ts` | Top-level `StateGraph`: classifier → conditional-edge → simple OR planner→loop(researchStep)→synthesize → publishArtifacts → done. Receives `providerFactory` from the adapter constructor (no direct registry import per FR-IA-04 / FR-IA-05a); calls it once per node to materialize the `ChatModel`. Tool list assembly per branch (filtered by `enabled` config), stream wiring. |
| `tests/unit/externalAgent/adapters/inlineAgent/*.test.ts` | NFR-IA-06 coverage including: classifier fallback, routing-mode override, planner empty-plan fallback, per-step budget split + rollover, `extract_note` discard rewrite, `synthesize` receives no raw tool messages, `publish_artifact` not callable from research-step. |

### 10.1 Touchpoints to existing modules

| Module | Change |
|---|---|
| `main.ts` | Import + register `InlineAgentAdapter` after `AdapterRegistry` is created. **DI root**: `main.ts` constructs `providerFactory` (closure over `providers/registry.ts`) and passes it into the adapter constructor (FR-IA-05a). |
| `settings/externalAgentResolver.ts` | No change — `describeConfigSchema` already handles nested object/array/string/number/boolean/secret per its existing introspection. |
| `settings/ExternalAgentsSection.tsx` | No change — auto-generated from `configSchema`. The "logical sandbox" caveat (NFR-IA-01) is added as a description on the top-level config schema so it renders inline. |
| `providers/registry.ts` | Read-only consumption; no API change. |
| `platform/Logger.ts` | New namespace `externalAgent.adapter.inlineAgent.*` documented in `loggingNamespaces.ts` (existing). |
| ESLint config (`.eslintrc.cjs`) | Extend `no-restricted-imports` adapter-isolation rule to apply to `src/agent/externalAgent/adapters/inlineAgent/**`. |

---

## 11. Data Flow

High-level node graph:

```
                                  ┌── route='simple'   → simpleBranch (createReactAgent, full tools − extract_note)
classify_task ──(routingMode)─────┤
                                  └── route='multistep'
                                          │
                                          ▼
                                       planner
                                          │
                                          ▼
                                ┌── researchStep[i] ──┐    (loop i = 0..plan.length-1;
                                │   tools: search/    │     publish_artifact NOT in this set)
                                │   fetch/file/       │
                                │   extract_note      │
                                └─────────┬───────────┘
                                          ▼
                                      synthesize  (notes-only prompt; may call publish_artifact)
                                          │
            ┌─────────────────────────────┘
            ▼
       publishArtifacts (flush ExternalEvent.file × N)
            │
            ▼
          done
```

`routingMode === 'simple'` / `'deep'` skips `classify_task` and routes directly to the corresponding branch.

```mermaid
sequenceDiagram
    participant SG as ExternalAgent Subgraph
    participant IA as InlineAgentAdapter
    participant SB as Sandbox
    participant CL as classify_task
    participant SM as simpleBranch
    participant PL as planner
    participant RS as researchStep
    participant SY as synthesize
    participant PR as Provider (configured)
    participant TL as Inline Tools
    participant NET as fetch / Tavily

    SG->>IA: start({ refinedAsk, systemPrompt, signal, timeoutMs, config })
    IA->>SB: init() — mkdir <tmp>/leo-inline-agent/<runId>
    alt routingMode == 'auto'
        IA->>CL: classify_task(refinedAsk, toolInventory)
        CL->>PR: structured-output call
        PR-->>CL: { route, reasoning, initialPlan? }
    else routingMode in {'simple','deep'}
        IA->>IA: skip classifier, set route directly
    end
    alt route == 'simple'
        IA->>SM: createReactAgent.stream({ messages, signal })
        loop ReAct
            SM->>PR: chat (stream)
            PR-->>SM: tokens / tool calls
            SM->>TL: invoke (search/fetch/file/publish)
            TL-->>SM: { ok, data | error }
            SM-->>IA: text deltas + log events
        end
    else route == 'multistep'
        IA->>PL: planner({ refinedAsk, initialPlan? })
        PL-->>IA: plan: string[]
        loop step in plan
            IA->>RS: researchStep(step, perStepBudget)
            loop bounded ReAct
                RS->>PR: chat (stream)
                PR-->>RS: tokens / tool calls
                RS->>TL: search/fetch/file
                TL->>NET: …
                TL-->>RS: result
                RS->>TL: extract_note(...)
                TL-->>RS: { id, noteCount }
                RS->>RS: rewrite consumed tool-result → stub
            end
            RS-->>IA: notes appended; raw messages dropped at step boundary
        end
        IA->>SY: synthesize({ refinedAsk, plan, notes, scratchpad })
        SY->>PR: chat (stream, may call publish_artifact)
        SY-->>IA: final text + buffered artifacts
    end
    loop publishedArtifacts
        IA->>SB: read artifact
        IA-->>SG: ExternalEvent.file
    end
    IA-->>SG: ExternalEvent.done
    IA->>SB: cleanup() (finally — also runs on error/abort)
```

---

## 12. SRS → Module Mapping

| FR / NFR | Modules |
|---|---|
| FR-IA-01..04 | `adapters/inlineAgent/index.ts`, `main.ts`, `.eslintrc.cjs` |
| FR-IA-05, FR-IA-05a, FR-IA-06..08 | `adapters/inlineAgent/index.ts` (constructor DI), `adapters/inlineAgent/configSchema.ts`, `adapters/inlineAgent/graph.ts`, `adapters/inlineAgent/systemPrompt.ts`, `main.ts` (DI root) |
| FR-IA-09..12 | `adapters/inlineAgent/sandbox.ts`, `adapters/inlineAgent/index.ts` (init/finally) |
| FR-IA-13..16 | `adapters/inlineAgent/tools/fetchUrl.ts`, `adapters/inlineAgent/tools/schemas.ts`, `adapters/inlineAgent/eventBridge.ts` |
| FR-IA-17..23 | `adapters/inlineAgent/tools/searchWeb.ts`, `adapters/inlineAgent/tools/schemas.ts`, `storage/safeStorage.ts`, `adapters/inlineAgent/eventBridge.ts` |
| FR-IA-24..27 | `adapters/inlineAgent/tools/fileOps.ts`, `adapters/inlineAgent/sandbox.ts` |
| FR-IA-28..31 | `adapters/inlineAgent/tools/publishArtifact.ts`, `adapters/inlineAgent/index.ts` (flush loop) |
| FR-IA-32..34 | `adapters/inlineAgent/router.ts`, `adapters/inlineAgent/graph.ts`, `adapters/inlineAgent/configSchema.ts` |
| FR-IA-35..36 | `adapters/inlineAgent/branches/simpleBranch.ts`, `adapters/inlineAgent/graph.ts` |
| FR-IA-37 | `adapters/inlineAgent/multistep/planner.ts` |
| FR-IA-38 | `adapters/inlineAgent/multistep/researchStep.ts`, `adapters/inlineAgent/graph.ts` |
| FR-IA-39 | `adapters/inlineAgent/tools/extractNote.ts`, `adapters/inlineAgent/multistep/messageRewriter.ts`, `adapters/inlineAgent/multistep/researchStep.ts` |
| FR-IA-40 | `adapters/inlineAgent/multistep/synthesize.ts` |
| FR-IA-41 | `adapters/inlineAgent/budgets.ts`, `adapters/inlineAgent/multistep/researchStep.ts` |
| FR-IA-42..44 | `adapters/inlineAgent/budgets.ts`, `adapters/inlineAgent/runState.ts`, `adapters/inlineAgent/index.ts` |
| FR-IA-45..48 | `adapters/inlineAgent/eventBridge.ts` |
| FR-IA-49..50 | `adapters/inlineAgent/index.ts`, all nodes + tools (signal threading) |
| FR-IA-51 | `adapters/inlineAgent/graph.ts`, `adapters/inlineAgent/branches/simpleBranch.ts`, `adapters/inlineAgent/multistep/researchStep.ts` (tool-list assembly, no `delegate_external`) |
| NFR-IA-01 | `adapters/inlineAgent/configSchema.ts` (caveat description), `settings/ExternalAgentsSection.tsx` (auto-render) |
| NFR-IA-02 | `adapters/inlineAgent/tools/*.ts` (Zod boundary) |
| NFR-IA-03 | `scripts/checkBundle.mjs` |
| NFR-IA-04 | `adapters/inlineAgent/sandbox.ts`, `adapters/inlineAgent/tools/fileOps.ts` |
| NFR-IA-05 | `adapters/inlineAgent/eventBridge.ts`, `loggingNamespaces.ts` |
| NFR-IA-06..07 | `tests/unit/externalAgent/adapters/inlineAgent/*.test.ts` |

---

## 13. Open Decisions

| # | Decision | Notes |
|---|---|---|
| OD-IA-1 | ~~Use `createReactAgent` (prebuilt) vs hand-rolled `StateGraph`.~~ | **Resolved: hybrid.** Top-level hand-rolled `StateGraph` (router → simple/multistep → publish → done). Simple branch and per-step research sub-loops use `createReactAgent` (prebuilt) for the inner ReAct mechanics. Buys deep-research correctness without rebuilding a tool loop. |
| OD-IA-2 | Per-run sandbox in `os.tmpdir` vs `<vault>/.leo/inline-agent-sandbox/<runId>/`. | SRS picks `os.tmpdir` to keep working files out of vault sync, simplify cleanup, and avoid accidental indexer pickup. Revisit only if users need post-mortem inspection of intermediates. |
| OD-IA-3 | Should the adapter write a session transcript artifact automatically? | v1 = no. The host already writes `request.md`/`response.md`. If users want intermediate-tool transcripts, the agent can `publish_artifact` a self-written log. |
| OD-IA-4 | Token counting source. | Use existing `tokenEstimator.ts` for input estimation; trust provider `usage` field for completion tokens. Mismatched providers lacking `usage` fall back to estimator. |
| OD-IA-5 | ~~`search_web` provider~~ | **Resolved: Tavily** (`https://api.tavily.com/search`). Single provider in v1; pluggable provider abstraction deferred until a second one is requested. |
| OD-IA-6 | Should `fetch_url` follow redirects? | Default: yes, ≤ 5 hops, each subject to allow/block list. Document explicitly in tool description. |