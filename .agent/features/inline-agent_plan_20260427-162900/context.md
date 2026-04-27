# Context — Inline Agent Adapter

Source: [.agent/srs/external-agent-inline-adapter.md](../../srs/external-agent-inline-adapter.md). Companion to `external-agent.md` (host subgraph + `ExternalAgentAdapter` contract).

## Scope

Build the `inline-agent` adapter — a built-in `ExternalAgentAdapter` running an LLM-driven LangGraph subgraph inside the Obsidian renderer with its own provider/model and isolated sandbox toolset. Routes between a `createReactAgent` simple branch and a planner→researchStep→synthesize multistep branch via a classifier node. Sandbox lives under `<os.tmpdir>/leo-inline-agent/<runId>/`. Tool surface: `fetch_url`, `search_web` (Tavily), `read_file`, `write_file`, `list_dir`, `delete_file`, `publish_artifact`, internal `classify_task`, multistep-only `extract_note`. Emits `ExternalEvent`s consumed by the existing host subgraph + widget.

## Out of scope

- Process or container isolation (logical sandbox only).
- Shell / subprocess execution.
- Persisting sandbox across runs; partial-run resume.
- Cross-run artifact reuse.
- User-supplied tools inside the inline agent.
- Inline agent invoking `delegate_external` recursively.
- Pluggable web-search providers beyond Tavily (v1).
- Bespoke React form for adapter config — `ExternalAgentsSection.tsx` auto-renders from `configSchema`.

## Actors

- **Main agent** — invokes `delegate_external` with a refined ask; consumes `ExternalEvent`s through host subgraph.
- **Inline agent (this adapter)** — runs classifier + branches against configured provider/model; calls inline tools.
- **Configured LLM provider** — any entry from `providers/registry.ts` (OpenAI-compatible, Anthropic, LM Studio).
- **Tavily** — external web-search API.
- **Tavily-targeted hosts** (via `fetch_url`) — arbitrary HTTP/HTTPS endpoints subject to allow/blocklist.
- **Host subgraph** — wraps adapter `start()` iterable, persists snapshots, surfaces events to widget + `ResultWriter`.
- **End user** — configures provider/model/budgets/tool toggles via Settings; views streamed run + artifacts in the existing widget.
- **Plugin loader (`main.ts`)** — DI root; supplies `providerFactory` + `logger` to adapter constructor.

## Functional requirements

Numbered FR-IA-01..51 carry forward from the SRS verbatim; each is referenced by ID in feature `covers` columns. Group headings follow §3 of the SRS.

### Adapter declaration
- **FR-IA-01** — Class export + registration in `main.ts` via `adapterRegistry.register(...)`.
- **FR-IA-02** — `id='inline-agent'`, `label='Inline Agent'`, `defaultTimeoutMs=300_000`, `capabilities={files:true,stream:true}`.
- **FR-IA-03** — `configSchema` Zod covers provider/model, prompt override, budgets, per-tool config (§6).
- **FR-IA-04** — Adapter import isolation enforced by ESLint `no-restricted-imports` (no main agent / chat / ui / storage / editor / sibling-provider imports; only `zod`, `@langchain/langgraph`, `@langchain/core/*`, `@langchain/openai`, node fs/os/path, fetch).
- **FR-IA-05a** — Constructor `{ providerFactory, logger }`, DI from `main.ts`; no module-level provider registry import.

### Provider & model
- **FR-IA-05** — Settings `providerId` dropdown + `model` text input; pair validated lazily in `start()` → `error.code='invalid_provider'` on mismatch.
- **FR-IA-06** — Adapter never inherits thread provider.
- **FR-IA-07** — `temperature` defaults to provider default; `[0,2]` user-overridable.
- **FR-IA-08** — Optional `systemPromptOverride`; built-in `systemPrompt.ts` describes tools, sandbox rules, artifact contract, termination. Adapter prepends `ExternalAgentInput.systemPrompt` ahead of its own.

### Sandbox
- **FR-IA-09** — `start()` creates `<os.tmpdir>/leo-inline-agent/<runId>/` mode `0o700`.
- **FR-IA-10** — All file tools `path.resolve(sandboxRoot, relPath)`; reject when outside `sandboxRoot+sep`. Symlinks under sandbox rejected via `lstat`.
- **FR-IA-11** — Sandbox wiped via `fs.rm({recursive,force})` in `finally` on done/error/abort/throw.
- **FR-IA-12** — `sandboxQuotaBytes` default 50 MB, max 500 MB; `write_file` checks projected total.

### Tool surface — fetch_url
- **FR-IA-13** — Inputs `url`, `method?GET|POST`, `headers?`, `body?`, `responseFormat?text|json`.
- **FR-IA-14** — Allowlist (precedence) + blocklist; default blocklist localhost / link-local / `*.local`.
- **FR-IA-15** — `timeoutMs` default 30 s; body cap `maxBytes` default 5 MB; truncation surfaced as `truncated:true`.
- **FR-IA-16** — `log` info per call with `{url,method,status,durationMs,bytes}` only.

### Tool surface — search_web (Tavily)
- **FR-IA-17** — Inputs `query`, `maxResults?`, `searchDepth?`, `topic?`, `includeAnswer?`, `includeDomains?`, `excludeDomains?`.
- **FR-IA-18** — POST `https://api.tavily.com/search` with `api_key` from `apiKeyRef` SafeStorage indirection; `include_raw_content` and `include_images` forced false.
- **FR-IA-19** — `timeoutMs` 20 s; body cap 256 KB; over-cap → `error:'too_large'`.
- **FR-IA-20** — Mapped result `{ answer?, results[], responseTimeMs }`; raw_content/images dropped.
- **FR-IA-21** — Missing/decrypt-fail apiKey → `not_configured` + one-shot `warn`; `enabled:false` omits tool entirely.
- **FR-IA-22** — `log` info `{queryLength, maxResults, depth, status, durationMs, resultCount}`; full payloads at `debug` only.
- **FR-IA-23** — HTTP status mapping `401|403→auth_failed`, `429→rate_limited`, `5xx→upstream_error`, other→`http_error+status`.

### Tool surface — sandbox file ops
- **FR-IA-24** — `read_file(relPath, offset?, limit?)`, `maxBytes` default 1 MB; reimplements binary detection inline.
- **FR-IA-25** — `write_file(relPath, content, encoding?)`; creates parent dirs; quota-checked.
- **FR-IA-26** — `list_dir(relPath?)` returns `{name,type,bytes?}[]`; default root.
- **FR-IA-27** — `delete_file(relPath)`; non-empty dir → `not_empty`.

### Tool surface — publish_artifact
- **FR-IA-28** — `publish_artifact(relPath, summary?)` buffers nomination; nothing crosses sandbox boundary until terminal `done`.
- **FR-IA-29** — `maxArtifacts` default 32; over → `artifact_limit`.
- **FR-IA-30** — On `done`, read each artifact, emit `file` event in nomination order, then `done`. Host `ResultWriter` writes under `externalAgentResults/<runId>/`.
- **FR-IA-31** — Artifact missing at flush → `warn` event, skip; do not abort run.

### Task routing
- **FR-IA-32** — `classify_task` node first; structured-output `{route, reasoning, initialPlan?}`; classifier prompt receives runtime tool inventory `{toolId, oneLineDescription}` (post `enabled` filter); classifier given no tools other than `classify_task`.
- **FR-IA-33** — Classifier failure (LLM error / schema parse / tool-schema mismatch after one retry) → fall back `route:'simple'`, empty plan, `log warn {reason}`.
- **FR-IA-34** — `routing.mode: 'auto'|'simple'|'deep'` default `'auto'`; `'simple'` and `'deep'` skip classifier; `'deep'` planner generates plan from scratch.

### Simple branch
- **FR-IA-35** — `createReactAgent` over inline tool list **excluding** `extract_note`.
- **FR-IA-36** — Termination on assistant message without tool calls → `publishArtifacts` → `done`. Iteration cap → `error.code='iteration_limit'` with partial artifacts still flushed.

### Multistep branch
- **FR-IA-37** — `planner` accepts classifier `initialPlan`; otherwise structured-output `{plan: string[]}`. Clamp `[1, planMaxSteps]` (default 8, max 16). Empty/unparsable → fall back to simple branch (`log warn`).
- **FR-IA-38** — Per-step `researchStep` = bounded `createReactAgent` over `search_web, fetch_url, read_file, write_file, list_dir, delete_file, extract_note`. **Excludes** `publish_artifact`.
- **FR-IA-39** — `extract_note({sourceUrl?, title, summary, relevance})` appends `NoteRecord`; consumed raw tool-result message rewritten to `[discarded — see note <id>]` stub for subsequent invocations within the step. At step boundary all raw messages dropped; only `notes`, `scratchpad`, original ask survive.
- **FR-IA-40** — `synthesize` prompt receives only `{refinedAsk, plan, notes, scratchpad}`; may call `publish_artifact` (only here); termination on assistant message without tool calls → `done`.
- **FR-IA-41** — Per-step iteration budget `floor(remainingIterations/remainingSteps)` recomputed at step start; rolls forward; mid-step exhaustion terminates that step (notes intact) and advances; `synthesize` reserves min 4 iterations.

### Shared run budgets
- **FR-IA-42** — `maxIterations` defaults: simple=12, multistep=32; hard max 64.
- **FR-IA-43** — `maxTokens` default 100k, max 1M; computed via `tokenEstimator.ts` + observed completion `usage`. Exceed → `error.code='token_limit'`.
- **FR-IA-44** — `wallClockMs` enforced via composed `AbortController` (host signal + inline timer); default `min(input.timeoutMs, 300_000)`.

### Streaming → ExternalEvent
- **FR-IA-45** — Token deltas → `{type:'text', chunk}`. Classifier + planner emit no `text` events; one `log info {node, route?, planLength?, durationMs}` on completion.
- **FR-IA-46** — Tool-call start `log info {tool, args}`; values >256 chars elided; `fetch_url.body`, `search_web.query|includeDomains|excludeDomains`, `extract_note.summary` elided to length/count at `info`; full at `debug`.
- **FR-IA-47** — Tool-call result `log debug {tool, ok, error?, durationMs}`; payloads not logged.
- **FR-IA-48** — Adapter-level errors → `{type:'error', error:{code, message}}`; iterable terminates; never throws synchronously out of `start()`.

### Cancellation
- **FR-IA-49** — Composed `AbortSignal` threaded into every `fetch`, `ChatModel.stream`, `tool.invoke`.
- **FR-IA-50** — In-flight tools reject ≤ 1 s on abort; adapter awaits 2 s grace then forces termination; sandbox cleanup `finally` always runs.

### Recursion guard
- **FR-IA-51** — No node's tool list contains `delegate_external` or any other adapter-driving tool.

## Non-functional requirements

- **NFR-IA-01** — Sandbox is logical only (path-prefix + lstat). Settings UI surfaces caveat one-liner under adapter section.
- **NFR-IA-02** — All tool inputs Zod-validated at boundary. No `as any`/`unknown` casts past the boundary.
- **NFR-IA-03** — Adapter adds ≤ 25 KB minified to `main.js`; verified via `pnpm check:bundle`.
- **NFR-IA-04** — All file IO uses `node:fs/promises` with explicit error mapping; no thrown `ENOENT` past tool boundary.
- **NFR-IA-05** — Logging namespace `externalAgent.adapter.inlineAgent.*`; URLs/queries/body content above `info` elided to lengths only.
- **NFR-IA-06** — Unit tests cover sandbox path-escape, symlink, quota, fetch_url allow/block/timeout/byte cap, ReAct cap termination, abort cleanup, artifact ordering, missing-artifact warn-skip, recursion-guard absence. Mocked provider via `msw` + injected `ChatModel`.
- **NFR-IA-07** — Adapter unit-testable without real provider — fake `ChatModel` emits scripted tool-call sequences.

## Constraints

- TypeScript 5.x strict; no `any`; named exports only — see [.agent/standards/code-style.md](../../standards/code-style.md).
- Bundler esbuild, runtime Electron renderer; bundle budget enforced via [scripts/checkBundle.mjs](../../../scripts/checkBundle.mjs) + [.agent/budgets/bundle-baseline.json](../../budgets/bundle-baseline.json).
- LangGraph subgraph integrates with existing `ExternalAgentAdapter` contract per [.agent/srs/external-agent.md](../../srs/external-agent.md).
- Provider DI from `main.ts`; no module-level coupling to `providers/registry.ts` from adapter.
- Adapter-isolation ESLint rule already exists for `src/agent/externalAgent/adapters/**` (per CLAUDE.md project structure note); inline-agent subtree must inherit.
- SafeStorage indirection (`safeStorage:` prefix) for `tools.searchWeb.apiKeyRef`.
- Existing host subgraph + widget (`ExternalAgentWidget`, `ExternalAgentTerminalBlock`) consume events unchanged — no UI redesign.
- Tavily as v1 web-search provider (no abstraction layer this slice).
- `os.tmpdir()` chosen over `<vault>/.leo/...` to avoid indexer pickup + sync (OD-IA-2).

## Glossary

| Term | Meaning |
|---|---|
| Inline Agent | This adapter's runtime — LangGraph `StateGraph` in renderer. |
| Sandbox | Per-`runId` temp working directory, exclusively writable by inline agent. |
| Artifact | Sandbox file nominated via `publish_artifact`; only artifacts cross sandbox→vault boundary. |
| Inline tool | LangChain `tool()` instance built per-run, bound to `{config, signal, sandbox, logger, runState}`. **Not** a `ToolSpec`; **not** registered in main `ToolRegistry`. |
| Iteration | One model→tool→model round-trip in any ReAct loop. Counted cumulatively. |
| Route | Resolved branch — `'simple'` or `'multistep'`. |
| Plan | Ordered sub-questions (planner output or classifier `initialPlan`). |
| Note | `NoteRecord` written by `extract_note`; only multistep state surviving across steps. |
| Scratchpad | Multistep working buffer carried into `synthesize`. |
| DI root | `main.ts` — constructs `providerFactory` closure over `providers/registry.ts` and injects into adapter. |

## Open questions

- **OD-IA-3** — Auto-publish a session transcript artifact? v1 = no; agent can self-publish.
- **OD-IA-4** — Token counting source — `tokenEstimator.ts` for input + provider `usage` for completion; estimator fallback when provider lacks `usage`. Edge: which providers in `providers/registry.ts` lack `usage` today?
- **OD-IA-6** — `fetch_url` follow redirects? SRS says yes ≤5 hops, each subject to allow/blocklist. Confirm we re-apply blocklist on each `Location` header before following.
- Sweep policy for orphaned `<os.tmpdir>/leo-inline-agent/<runId>/` from prior plugin runs — SRS picks best-effort `mtime>1h` sweep on adapter construction; confirm this runs even when `enabled:false` (likely yes — adapter still constructed).
- Bundle budget — does adding `@langchain/langgraph/prebuilt` `createReactAgent` to the import surface push us past the 25 KB inline-agent budget given any tree-shake gaps? Verify after F19 build.
- Storybook coverage — should `ExternalAgentWidget.stories.tsx` gain inline-agent fixtures (simple route, multistep route, classifier fallback) or is generic adapter coverage sufficient? Decide in F17 UI.
