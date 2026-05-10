# F05 — OpenfangAdapter shell + error mapping

## Purpose

Tie F01–F04 into a concrete `ExternalAgentAdapter` subclass that implements the contract from the prior slice. The shell owns: config validation at start, insecure-transport rejection, submit, polling driver invocation, terminal-task interpretation (text + data + failure-prefix decoding), artifact download, abort/cancel wiring, HTTP-error → `ExternalEvent.error` code mapping, and the final `done` event.

Implements [`context.md`](../../context.md) FR-OF-08, FR-OF-13 (signal wiring), FR-OF-14, FR-OF-15, FR-OF-16, FR-OF-17, FR-OF-18, FR-OF-19 (mapping side), FR-OF-22, FR-OF-27, FR-OF-29, FR-OF-30 (start-side redaction), NFR-OF-01 (overall), NFR-OF-02, NFR-OF-03, NFR-OF-05, NFR-OF-09.

## Scope

**In scope**

- New file `src/agent/externalAgent/adapters/openfang/index.ts` exporting `class OpenfangAdapter extends ExternalAgentAdapter`:
  - Static fields per FR-OF-22:
    - `id = 'openfang'`
    - `label = 'OpenFang (Demiurg via A2A)'`
    - `defaultTimeoutMs = 1_800_000`
    - `capabilities: AdapterCapabilities = { files: true, stream: false }`
    - `configSchema = openfangConfigSchema` (re-export from F01)
  - `start(input: ExternalAgentInput): AsyncIterable<ExternalEvent>` async generator implementing the orchestration flow below.
- New helper file `src/agent/externalAgent/adapters/openfang/failureDecoder.ts` exporting:
  - `decodeFailureText(text: string): { code: 'infra_error' | 'partial' | 'circuit_breaker' | 'generic_error' | 'unknown_failure'; message: string }`. Pure. Matches the four prefixes from SRS §8 in priority order; on no match returns `unknown_failure` with the original text.
- New helper file `src/agent/externalAgent/adapters/openfang/httpErrorMapping.ts` exporting:
  - `type ErrorContext = 'submit' | 'poll' | 'cancel' | 'artifact'`
  - `mapHttpError(err: OpenfangHttpError, ctx: ErrorContext): { code: string; message: string }` — pure dispatch:
    - 401 → `invalid_auth`
    - 403 → `operator_misconfig`
    - 404 + `submit` → `no_agents`
    - 404 + `poll` → `task_not_found`
    - 404 + `artifact` → `artifact_evicted` (note: F04 already swallows artifact 404; this branch is defensive)
    - 4xx other → `bad_request`
    - 5xx → `transient_failure`
- Orchestration flow inside `start()` (yields `ExternalEvent` values in order):
  1. **Config validation** — `const parsed = openfangConfigSchema.parse(input.config)`. Throws → catch and yield `{type:'error', error:{code:'invalid_config', message: zod.message}}`, return. (NFR-OF-03.)
  2. **Insecure-transport guard** — if `parsed.allowInsecureHttp === false` and `new URL(parsed.baseUrl).protocol !== 'https:'`: yield `{type:'error', error:{code:'insecure_transport', message:'baseUrl is not https; set allowInsecureHttp=true to override'}}`, return. (FR-OF-29.)
  3. **HTTP client** — `const http = createOpenfangHttp(parsed, log)` where `log` is a `LogFn` that translates into `yield {type:'log', level, msg}` (the namespace is `externalAgent.adapter.openfang.*`, applied at the consumer side; this side just emits the bare message + context fields). (NFR-OF-09.)
  4. **5xx-budgeted submit** — submit with up to 3 attempts on 5xx (per FR-OF-19 submit side). Other `OpenfangHttpError`s short-circuit via `mapHttpError(err, 'submit')` → emit `error`, return.
  5. **Capture `taskId = task.id`**. Yield `{type:'log', level:'info', msg:'task_submitted'}` with `{taskId}`.
  6. **Cancel hookup** — register `input.signal.addEventListener('abort', () => http.cancelTask(taskId, AbortSignal.timeout(2_000)).catch(()=>{}), { once: true })` to fire-and-forget on abort. Local poll-loop teardown happens via the same signal threading into `pollUntilTerminal`. (FR-OF-13.)
  7. **Poll** — call `pollUntilTerminal({http, sleep:abortableSleep, now:Date.now}, {taskId, signal:input.signal, initialIntervalMs, maxIntervalMs, timeoutMs:pollTimeoutMs})`.
     - On `{kind:'terminal', task}` — proceed to step 8.
     - On `{kind:'timeout'}` — yield `{type:'error', error:{code:'poll_timeout', message:`task ${taskId} did not terminate within ${pollTimeoutMs}ms`}}`, return. (FR-OF-20.)
     - On `{kind:'aborted'}` — yield `{type:'error', error:{code:'cancelled', message:'aborted by host'}}`, return. (FR-OF-14.)
     - On `{kind:'transient_exhausted', lastStatus}` — yield `{type:'error', error:{code:'transient_failure', message:`poll failed with HTTP ${lastStatus} after retries`}}`, return.
     - On thrown `OpenfangHttpError` (401/403/404) — yield `{type:'error', error: mapHttpError(err, 'poll')}`, return.
  8. **Terminal-task interpretation** — read `lastMsg = task.messages.at(-1)`. Filter `parts[]`:
     - For each `part.type === 'text'`: yield `{type:'text', chunk: part.text ?? ''}`.
     - For each `part.type === 'data'`: yield `{type:'text', chunk: '\n```json\n' + JSON.stringify(part.data, null, 2) + '\n```\n'}` per context.md OQ-03. (FR-OF-08 textual reply; OQ-03 disposition.)
     - Other types: log at `debug`, drop.
  9. **Failure-prefix decoding** — if `extractStatusKind(task.status) === 'failed'`:
     - Take the concatenated text from step 8.
     - `const decoded = decodeFailureText(text)`.
     - For `decoded.code === 'partial'`: the `text` event from step 8 already carried the body — additionally yield `{type:'error', error:{code:'partial', message:decoded.message}}` and skip artifact download (the partial body is what the host should surface). (FR-OF-15 PARTIAL behavior.)
     - For other codes (`infra_error`, `circuit_breaker`, `generic_error`, `unknown_failure`): yield `{type:'error', error:{code:decoded.code, message:decoded.message}}` and skip artifact download. (FR-OF-15.)
     - Return after the error event.
  10. **Artifact download** — if status is `completed`: `yield* downloadArtifacts({http, log}, task, input.signal)`. The artifact module yields `file` events. (FR-OF-09 — FR-OF-12, FR-OF-27, FR-OF-28 via F04.)
  11. **Done** — yield `{type:'done'}`.
- Cancel-on-abort latency: must release ≤ 2 s from `signal.aborted` to the iterable terminating. (NFR-OF-01.) Implementation note: since the abort listener fires `cancelTask` with its own 2-s timeout signal, and the polling driver wakes within 50 ms, the total bounded by the polling sleep grain.
- Logging redaction: every `log` event passes through a wrapping helper that strips any `headers.authorization` field before emission. (FR-OF-30, NFR-OF-05.)
- Unit + integration tests at `tests/unit/externalAgent/adapters/openfang/index.test.ts`:
  - `failureDecoder` table-test: 4 prefixes + plain text + empty string + prefix-only-no-message (`'INFRA_ERROR:'`) → `code/message` matrix
  - `httpErrorMapping` table-test: 401/403/404×4-contexts/4xx-other/5xx → all expected codes
  - `start()` happy path with stubbed `http`, `pollUntilTerminal`, and `downloadArtifacts`: yields `log → text → file → done` in order
  - `start()` invalid_config: yields one `error` with `code:'invalid_config'`, no `log` events
  - `start()` insecure_transport: `baseUrl='http://x'`, `allowInsecureHttp=false` → yields one `error` with `code:'insecure_transport'`, no network call
  - `start()` failure prefixes: terminal `failed` task with each of 4 prefixes → yields `text` (just the prefix-stripped body for PARTIAL; full body for others) then `error` with the right code; no `file` events
  - `start()` 401 on submit: yields `error` with `code:'invalid_auth'`
  - `start()` 5xx submit retry: 2 × 500 then 200 → success path proceeds to terminal
  - `start()` 5xx submit exhausted: 3 × 500 → yields `error` with `code:'transient_failure'`
  - `start()` cancel-during-poll: signal aborts mid-poll → `cancelTask` invoked exactly once, iterable yields `error` with `code:'cancelled'`, terminates within 50 ms of fake-time
  - `start()` no token in any log entry: every captured `log` payload string-matches `!/Bearer\s+\w/`

**Out of scope**

- Adapter registration in `main.ts` (F06).
- Storybook (F07).
- ResultWriter integration / vault writes (consumer side; this slice only emits `ExternalEvent`).
- Refine sub-agent (F04 of the prior slice).
- `delegate_external` tool wiring (F06 of the prior slice).
- The widget UI (F08 of the prior slice handles non-streaming adapters; `capabilities.stream:false` is honored there).

## Acceptance criteria

1. `OpenfangAdapter` constructs without external dependencies — no `Logger`, `Vault`, `Settings`, or `SafeStorage` handle in its constructor signature. The class is `new OpenfangAdapter()`-able with zero arguments. (NFR-OF-02.)
2. `start()` returns an `AsyncIterable<ExternalEvent>` matching the contract from [`../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md`](../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md). All yielded events match `ExternalEvent` shape per `src/agent/externalAgent/adapters/base.ts`.
3. Step 1 (config validation) runs before any HTTP call. Invalid config → exactly one `error` event with `code:'invalid_config'`. (NFR-OF-03.)
4. Step 2 (insecure-transport) blocks `http://` baseUrls when `allowInsecureHttp=false`. (FR-OF-29.)
5. Failure-prefix decoder produces the four documented codes plus `unknown_failure` fallback; never throws. (FR-OF-15.)
6. HTTP-error mapper covers every documented status × context pair. (FR-OF-16, FR-OF-17, FR-OF-18, FR-OF-19.)
7. Cancel: when `input.signal` aborts mid-poll, the adapter (a) calls `http.cancelTask` exactly once, (b) the polling driver returns `aborted` ≤ 2 s, (c) the iterable yields `error` with `code:'cancelled'` and terminates. (FR-OF-13, FR-OF-14, NFR-OF-01.)
8. Text emission precedes file emission within a single `start()` invocation. (FR-OF-27.)
9. `data`-typed parts in `messages[-1]` render as a fenced ```json``` block appended after any plain text. (Resolves context.md OQ-03.)
10. No `log` entry emitted by the adapter during any test contains the literal API key. Asserted by string-match across all captured log payloads. (FR-OF-30, NFR-OF-05.)
11. `failureDecoder.ts` and `httpErrorMapping.ts` are pure modules — only `import` / `import type` of in-slice files; no `fetch`, no plugin-internal modules.
12. ESLint `no-restricted-imports` rule from F01 of the prior slice passes against all four files in this feature. (Vault-isolation invariant.)

## Dependencies

- **F01** — `openfangConfigSchema` + `OpenfangConfig` type
- **F02** — `createOpenfangHttp`, `OpenfangHttp`, `OpenfangHttpError`, `A2aTask`, `A2aStatus`, `LogFn`
- **F03** — `pollUntilTerminal`, `extractStatusKind`, `abortableSleep`
- **F04** — `downloadArtifacts`
- Cross-doc:
  - [`context.md#functional-requirements`](../../context.md#functional-requirements)
  - [`../../../../srs/openfang.md`](../../../../srs/openfang.md) §3, §4, §5, §6, §8
  - [`../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md`](../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md)
  - [`../openfang-config-schema/feature.md`](../openfang-config-schema/feature.md)
  - [`../openfang-http-client/feature.md`](../openfang-http-client/feature.md)
  - [`../openfang-polling/feature.md`](../openfang-polling/feature.md)
  - [`../openfang-artifacts/feature.md`](../openfang-artifacts/feature.md)

## Implementation notes

- Adapter base class — see `src/agent/externalAgent/adapters/base.ts` (in-tree from F01 of the prior slice).
- Vault-isolation invariant + ESLint rule — see [`../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md`](../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md) §"Acceptance criteria".
- Async-iterator generator pattern — see existing `src/agent/externalAgent/adapters/inlineAgent/index.ts::start()`.
- Pure-core / IO-edge — see [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §1. `failureDecoder` and `httpErrorMapping` are pure; `start()` orchestrates.
- LangGraph state / tool-result conventions are upstream of this adapter — see [`../../../external-agent_slice_20260427-022536/features/run-phase/feature.md`](../../../external-agent_slice_20260427-022536/features/run-phase/feature.md).
- TypeScript style — see [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §TypeScript and §"LangGraph / Agent Layer".

## Open questions

- **OQ-01-F05** Should the adapter pass through the daemon's `sessionId` for correlation across multiple `start()` calls within one thread, or always create a new session? **Proposed**: pass `parsed.sessionId` if non-empty (FR-OF-21); otherwise omit. Multi-call correlation is the host's job (it can put the same `sessionId` in the config block).
- **OQ-02-F05** When the same task is configured multiple times (e.g. user retries), should we deduplicate via a request hash before submitting? SRS §9 says the daemon does not dedupe and the client owns this. **Proposed**: out of v1 — host-level concern, not adapter-level.
- **OQ-03-F05** Should `cancel`-on-abort use a freshly-derived `AbortSignal.timeout(2_000)` (so the cancel call itself can finish even after the parent abort), or share `input.signal` (which is already aborted at that point)? **Proposed**: fresh signal — `input.signal` is already aborted by the time the listener fires; reusing it would short-circuit `fetch` immediately. Spec'd this way in §Scope step 6.
