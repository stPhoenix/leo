# Context — OpenFang (Demiurg) external-agent adapter

Source SRS: [`../../srs/openfang.md`](../../srs/openfang.md). Companion slice: [`../external-agent_slice_20260427-022536/`](../external-agent_slice_20260427-022536/) — that slice shipped the adapter contract + plumbing only and explicitly deferred concrete adapter implementations (FR-EXT-32). This slice lands the first concrete adapter against that contract.

## Scope

- A new concrete `ExternalAgentAdapter` named **`openfang`** that delegates a refined ask to a remote OpenFang daemon's `demiurg` hand over Google A2A protocol via plain HTTP.
- HTTP transport: `POST /a2a/tasks/send`, `GET /a2a/tasks/{id}` (poll), `POST /a2a/tasks/{id}/cancel`, `GET /api/a2a/tasks/{tid}/artifacts/{aid}` (download), with Bearer-token auth.
- Polling driver with exponential back-off (2 s → 15 s) until terminal state `completed | failed | cancelled`.
- Lenient parsing of the `status` field (string OR `{ state, message }`).
- Failure-prefix decoding for `INFRA_ERROR:` / `PARTIAL:` / `CIRCUIT_BREAKER:` / `Error:` from the agent's last text part.
- Artifact handling: enumerate `artifacts[].parts[type=fileRef]`, fetch each with the same Bearer token, emit `ExternalEvent.file` per artifact.
- Cancellation: `AbortSignal`-driven `POST .../cancel` plus local poll-loop teardown.
- Settings integration: `OpenfangAdapter` registers with `AdapterRegistry` at plugin load; its `configSchema` drives the existing auto-generated settings form (F11 of the prior slice). Secret fields stored via `SafeStorage`.
- Storybook fixtures for the openfang config block in the existing `ExternalAgentsSection.stories.tsx`.
- HTTP error mapping: 401 / 403 / 404 / 5xx → typed `error.code` values. 5xx is retried with bounded back-off.
- Test coverage: unit (HTTP, polling, parsing, error mapping) with `msw`; integration (end-to-end submit → poll → artifact → done) with `msw`; cancel-mid-flight smoke.

## Out of scope

- A2A streaming (`tasks/sendSubscribe`) — daemon does not implement; v1 polling only (SRS §11).
- Push notifications — daemon advertises `pushNotifications: false` (SRS §11).
- Multi-part user input — only the first `text` part is consumed by demiurg today (SRS §11). Adapter forwards a single text part.
- Cross-vendor A2A peer dispatch — out of scope for demiurg v1 (SRS §11).
- Connection-test button (calling `/.well-known/agent.json` from the settings UI) — see [Open questions](#open-questions); cosmetic, not in this slice.
- Operator-side configuration of the daemon (API key generation, TLS termination, agent activation) — exclusively the operator's responsibility (SRS §1).
- A pluggable A2A client library — adapter ships its own minimal HTTP module to keep the bundle delta within budget.
- Provider whitelist — openfang is not an LLM provider, so the inline-agent's `knownProviderIds` gate does not apply here.
- Existing built-in adapters (`claude-code`, `openai-compatible`) listed in the prior slice's UI mock-up — those remain deferred and are not implemented here.

## Actors

- **End user** — issues a chat request the main agent decides to delegate via `delegate_external` (built by F06 of the prior slice). Confirms / denies. Sees the widget update as the run progresses. Reads the synthesized text + saved artifacts under `externalAgentResults/<runId>/`.
- **Main agent** (LangGraph) — calls `delegate_external` with a refined ask after the refine sub-agent completes. Receives a structured tool result (success / partial / error) and resumes its turn.
- **OpenFang daemon operator** — runs the daemon on a remote host, activates the `demiurg` hand, generates the API key, distributes the base URL + key to the user out-of-band. The user is the bridge between the daemon operator and the plugin settings.
- **OpenFang daemon (`demiurg`)** — remote HTTP service that accepts the task, dispatches it to subagents, and returns final text + artifact metadata. Treated as opaque by the adapter; only the documented A2A surface is consumed.
- **Plugin settings store** — owns `externalAgents.adapters.openfang.{enabled, config}`, including the `safeStorage:` indirection for `apiKey`.
- **`SafeStorage`** — encrypts the API key at rest using Electron `safeStorage`; resolved into plaintext only inside `resolveAdapterConfig(id)` (F11 of the prior slice) immediately before `adapter.start()`.

## Functional requirements

Numbered + stable IDs. References cite SRS sections.

| ID | Requirement |
|----|-------------|
| FR-OF-01 | Adapter sends a single `text` part inside a JSON-RPC 2.0 `tasks/send` envelope to `POST <baseUrl>/a2a/tasks/send`. (SRS §3.) |
| FR-OF-02 | Every authenticated request carries `Authorization: Bearer <api_key>`. The adapter never sends the alternative `X-API-Key` form (one consistent shape across all calls per SRS §2.2). |
| FR-OF-03 | The adapter captures `id` from the submit response and uses it as the task identifier for poll, cancel, and artifact-download URLs. (SRS §3 "Capture `id`".) |
| FR-OF-04 | Polling loop issues `GET <baseUrl>/a2a/tasks/{id}` until status reaches `completed`, `failed`, or `cancelled`. (SRS §4.) |
| FR-OF-05 | Polling cadence: initial interval 2 s, multiplied by 1.5 each tick, capped at 15 s. (SRS §4 / §9.) |
| FR-OF-06 | Status field parsed leniently — read `status.state` first, fall back to treating `status` as a bare string. (SRS §3 "Status field forms".) |
| FR-OF-07 | Recognized status states: `submitted`, `working`, `inputRequired`, `completed`, `failed`, `cancelled`. Only the last three are terminal. (SRS §3, §4.) |
| FR-OF-08 | On `completed`, the adapter extracts the agent's final text from `messages[messages.length - 1].parts[].find(p => p.type === 'text').text` and emits it as a single `ExternalEvent.text` chunk. (SRS §4.) |
| FR-OF-09 | On `completed` (and on `failed`, where artifacts may still appear), the adapter enumerates `artifacts[].parts[]` and selects entries with `type === 'fileRef'`. (SRS §6.) |
| FR-OF-10 | Each `fileRef` is downloaded via `GET <baseUrl><part.url>` with the Bearer token; the response body is the raw file bytes. (SRS §6.) |
| FR-OF-11 | The downloaded file is emitted as `ExternalEvent.file` with `relPath = part.name`, `mime = part.mimeType`, and `content = Uint8Array` of the body. (Mirrors `ExternalEvent.file` shape in [`../external-agent_slice_20260427-022536/features/adapter-contract/feature.md`](../external-agent_slice_20260427-022536/features/adapter-contract/feature.md).) |
| FR-OF-12 | Part types other than `fileRef` are skipped in the artifact-download path: `text` / `data` are emitted only as part of message synthesis (FR-OF-08), and the legacy `file` type with inline `data` is logged at `debug` and dropped. (SRS §6 "Other part types".) |
| FR-OF-13 | When `input.signal` aborts, the adapter issues `POST <baseUrl>/a2a/tasks/{id}/cancel` (best-effort; one shot, no retry on cancel call itself) and stops the local poll loop. (SRS §5.) |
| FR-OF-14 | After cancel, the adapter does **not** wait for the daemon to confirm `cancelled`; it emits `ExternalEvent.error` with `code = 'cancelled'` and returns. (SRS §5: cancel is a "stop polling signal", not a kill switch.) |
| FR-OF-15 | When a `failed` task's last agent-text begins with one of the prefixes `INFRA_ERROR:`, `PARTIAL:`, `CIRCUIT_BREAKER:`, or `Error:`, the adapter emits a structured `ExternalEvent.error` whose `code` is the lowercase prefix without the colon (`infra_error`, `partial`, `circuit_breaker`, `generic_error`) and whose `message` is the remainder of the text. For `PARTIAL:`, the body is **also** emitted as a preceding `ExternalEvent.text` chunk so the host can show the partial synthesis. (SRS §8.) |
| FR-OF-16 | HTTP `401` on any authenticated call → `ExternalEvent.error` with `code = 'invalid_auth'`. (SRS §2.3, §8.) |
| FR-OF-17 | HTTP `403` on any authenticated call → `ExternalEvent.error` with `code = 'operator_misconfig'`. (SRS §2.3, §8.) |
| FR-OF-18 | HTTP `404` on `tasks/send` → `code = 'no_agents'`; on poll → `code = 'task_not_found'`; on artifact download → `code = 'artifact_evicted'`. (SRS §6 "Lifetime", §8, §10.) |
| FR-OF-19 | HTTP `5xx` on `tasks/send` or polling → retried with exponential back-off (max 3 attempts, base 1 s, factor 2). On exhausted retries → `code = 'transient_failure'`. Cancel and artifact-download paths do not retry. (SRS §8 / §9.) |
| FR-OF-20 | Polling timeout is configurable; default 30 minutes. On timeout the adapter emits `ExternalEvent.error` with `code = 'poll_timeout'` and does **not** call cancel automatically (the daemon may still finish). (SRS §4, §9.) |
| FR-OF-21 | If `config.sessionId` is non-empty, it is included in the submit payload as `params.sessionId` to allow demiurg to correlate context across calls. (SRS §3.) |
| FR-OF-22 | The adapter exposes `id = 'openfang'`, `label = 'OpenFang (Demiurg via A2A)'`, `defaultTimeoutMs = 1_800_000` (30 min), and `capabilities = { files: true, stream: false }`. The `stream: false` value is honored by widget logic that handles non-streaming adapters per F08 of the prior slice. |
| FR-OF-23 | `configSchema` is a Zod object with: `baseUrl: z.string().url()`, `apiKey: z.string().min(1).describe('secret')`, `sessionId: z.string().optional()`, `pollTimeoutMs: z.number().int().positive().default(1_800_000)`, `pollInitialIntervalMs: z.number().int().positive().default(2_000)`, `pollMaxIntervalMs: z.number().int().positive().default(15_000)`, `httpTimeoutMs: z.number().int().positive().default(30_000)`, `allowInsecureHttp: z.boolean().default(false)`. Each field has a `.describe(...)` for the LLM-readable settings UI. |
| FR-OF-24 | The `apiKey` field carries `.describe('secret')` so the existing settings UI (F11 of the prior slice) renders a password input + reveal toggle and persists the value through `SafeStorage`. |
| FR-OF-25 | The adapter is registered with `AdapterRegistry` during plugin load (in `main.ts` adapter-wiring section). It must be registered **before** `freeze()` is called. |
| FR-OF-26 | The adapter is selectable as the default via the existing settings dropdown. `effectiveDefaultAdapterId()` (F11 of the prior slice) treats `openfang` like any other registered + enabled adapter. |
| FR-OF-27 | Artifact downloads happen sequentially after the agent text is emitted, so the host's widget can render the textual reply before file bytes arrive. (Improves perceived latency; SRS §6 implies sequential by example.) |
| FR-OF-28 | When an artifact download returns `404`, the adapter logs at `warn` (with artifact id but never the URL with token), skips that artifact, and continues with remaining ones. The overall task result remains `done` (with the artifact missing) rather than failing the whole call. (SRS §6 "Lifetime".) |
| FR-OF-29 | When `config.allowInsecureHttp === false` (the default) and `baseUrl` parses to a `http://` scheme, the adapter rejects the run at start with `code = 'insecure_transport'` before any network call. (SRS §2.4 "TLS".) |
| FR-OF-30 | The adapter never logs the API key or any header containing it. Request URLs are logged at `debug` level only and have query strings stripped of any auth-bearing hints (defensive; current daemon does not put tokens in query strings). |

## Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-OF-01 | Abort latency ≤ 2 s from `signal.aborted` to the adapter's `start()` async iterable terminating, mirroring NFR-EXT-01 from [`../external-agent_slice_20260427-022536/context.md`](../external-agent_slice_20260427-022536/context.md). |
| NFR-OF-02 | Adapter respects vault-isolation: it receives no `Vault`, `EditorBridge`, or `Logger` handles; emits all observability through `ExternalEvent.log` (NFR-EXT-02 of the prior slice). |
| NFR-OF-03 | `configSchema.parse()` runs at the very top of `start()`. Invalid config → `ExternalEvent.error` with `code = 'invalid_config'` and a parse-error message; no network call. |
| NFR-OF-04 | All `fetch()` calls carry an `AbortSignal` linked to `input.signal` and a per-request timeout (`config.httpTimeoutMs`). No bare network calls. (Project standard `code-style.md` §"Async & Concurrency".) |
| NFR-OF-05 | API key never appears in any log entry, error message surfaced to UI, or persisted file. (Constraint **C-09** mirror.) |
| NFR-OF-06 | Bundle delta ≤ 15 KB minified added to `main.js` by the openfang adapter (transport, polling, artifact, schema, registration, error mapping combined). Verified by `pnpm check:bundle`. |
| NFR-OF-07 | Test coverage required: |
| | • Unit: HTTP transport (msw fixtures for each endpoint), polling backoff math (clock-injected, no real timers), status parser (string + object forms), artifact enumeration (fileRef / text / data / unknown), failure-prefix decoder (4 prefixes + plain text), HTTP error mapper (401/403/404/5xx + retry budget), config schema (valid + insecure-http reject + missing fields). |
| | • Integration: full submit → poll → completed → artifact-download → done iterable; failed task with `INFRA_ERROR` prefix; cancel mid-poll. |
| | • All tests use `msw` for HTTP, `vi.useFakeTimers()` for polling cadence, no real network. |
| NFR-OF-08 | Lenient parsing: unknown `parts[].type` values, unknown `status` shapes, and missing `messages` / `artifacts` keys are tolerated (default to empty list) — adapter does not crash on partial daemon responses. |
| NFR-OF-09 | Logging namespace `externalAgent.adapter.openfang.*`. Payload-level logs (request body, response body) gated to `debug` per NFR-EXT-05 of the prior slice. |
| NFR-OF-10 | No new top-level dependency added to `package.json`. The HTTP client uses platform `fetch`. |

## Constraints

| ID | Constraint |
|----|------------|
| C-OF-01 | A2A protocol surface is fixed by the daemon (Google A2A spec). The adapter cannot change endpoint paths, response shapes, or the JSON-RPC envelope. |
| C-OF-02 | HTTP polling only — no streaming, no push, no WebSocket (SRS §11). |
| C-OF-03 | Runs in Obsidian's Electron renderer; uses platform `fetch` with the same constraints as other Leo modules. |
| C-OF-04 | Polling cadence ≥ 2 s — daemon caches faster requests (SRS §9). The schema enforces `pollInitialIntervalMs >= 2_000`. |
| C-OF-05 | Artifact URLs are single-use-window: valid only while the parent task lives in the daemon's task store. The adapter must download promptly, in the same `start()` invocation, before the iterable terminates. (SRS §6.) |
| C-OF-06 | API key delivery is out-of-band — the operator hands it to the user; the plugin only validates correct *use*. (SRS §1, §2.) |
| C-OF-07 | Bearer token treated as a password: stored via `SafeStorage`, never logged, never embedded in any persisted artifact. (SRS §2.4.) |
| C-OF-08 | Adapter must respect the prior slice's vault-isolation invariant (NFR-EXT-02): zero imports from `src/agent/`, `src/chat/`, `src/ui/`, `src/storage/`, `src/editor/` outside the relative-path adapter helpers. The ESLint `no-restricted-imports` rule from F01 of the prior slice already enforces this and the openfang adapter file lives under `src/agent/externalAgent/adapters/openfang/`. |
| C-OF-09 | The adapter cannot assume the daemon has TLS configured — operators may run plain HTTP on a trusted network. The adapter defaults to TLS-only and exposes an opt-in escape hatch (`allowInsecureHttp`) consistent with SRS §2.4 "push back". |

## Glossary

| Term | Meaning |
|------|---------|
| **A2A** | Google's [Agent-to-Agent protocol](https://github.com/google/A2A) — a JSON-RPC 2.0 envelope over HTTP for agent-to-agent task delegation. |
| **OpenFang** | The remote orchestration daemon hosting the `demiurg` hand. Operator-managed, opaque to the client. |
| **Demiurg** | OpenFang's orchestrator agent (a "hand") that decomposes the user's prompt into subagent calls and synthesizes a final answer. |
| **Hand** | OpenFang's term for a registered agent on a daemon. The daemon may have multiple hands; demiurg is the one this adapter targets. |
| **Daemon** | The remote HTTP service running OpenFang. The adapter talks to one daemon per configured base URL. |
| **Task** | A single A2A delegation: submit returns a `task_id` with state `working`; polling drives it to a terminal state. |
| **Artifact** | A file produced by demiurg during a task. Returned by reference (UUID + URL + metadata), bytes downloaded out-of-band. |
| **Task store** | The daemon's in-memory queue of recent tasks. FIFO eviction at capacity; once a task evicts, its artifact URLs return `404`. |
| **Bearer token** | The API key, sent in `Authorization: Bearer <key>`. The daemon also accepts `X-API-Key`; the adapter standardizes on `Authorization` for consistency. |
| **JSON-RPC envelope** | The `{ jsonrpc: '2.0', id, method, params }` wrapper around every A2A request. |
| **fileRef** | The artifact-part type that carries `name`, `mimeType`, `url`, `size` — i.e. a download reference, not inline bytes. |
| **Failure prefix** | One of `INFRA_ERROR:`, `PARTIAL:`, `CIRCUIT_BREAKER:`, `Error:` at the start of the agent's last text on a `failed` task — encodes the failure class. |

## Open questions

- **OQ-01** Should the settings UI grow a "Test connection" button that calls `GET /.well-known/agent.json` (un-authenticated) to give the user a quick sanity check before saving? **Proposed**: defer; not in this slice. Track in a follow-up cosmetic ticket.
- **OQ-02** Should `5xx` retries be configurable (count + base interval), or hard-coded as 3 attempts × 1 s × factor 2? **Proposed**: hard-coded for v1. Configurability adds two settings fields for marginal value.
- **OQ-03** When demiurg returns a `data` part in `messages[-1]` (structured JSON), should the adapter render it as fenced JSON inside the text reply, or drop it? **Proposed**: render as a fenced ```json``` block appended after any plain `text` part — preserves the data without breaking the text-only host contract.
- **OQ-04** What is the artifact `relPath` when `part.name` collides across two artifacts in one task (same filename, different ids)? **Proposed**: deduplicate by suffixing `-<artifact_id_short>` before the extension. The `ResultWriter` (F02 of the prior slice) already namespaces by `runId`, so collisions across runs are not a concern.
- **OQ-05** Should artifact download respect a per-file size cap to avoid pulling huge payloads? **Proposed**: no hard cap in v1, but log `info` with `size` before each download so the user can see progress. Add a configurable cap if real-world payloads get problematic.
- **OQ-06** When the daemon returns an `inputRequired` status (defined in SRS §3 but not described as a terminal state), how should the adapter behave? **Proposed**: treat as non-terminal in v1 (keep polling). Demiurg does not currently emit it for top-level tasks; the polling loop would naturally time out if it ever did.
