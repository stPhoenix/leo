# F02 — LM Studio provider core

## Purpose

Deliver the first concrete LLM transport layer of the Leo plugin: an LM Studio adapter that speaks to a local OpenAI-compatible HTTP endpoint per [FR-PROV-01](../../context.md#fr-prov-01), auto-discovers available models via `/v1/models` per [FR-PROV-02](../../context.md#fr-prov-02), streams chat completions over SSE per [FR-PROV-03](../../context.md#fr-prov-03), serializes concurrent requests through a per-provider FIFO queue with a 120 s timeout per [FR-PROV-05](../../context.md#fr-prov-05), retries connection failures with exponential backoff up to three attempts and surfaces persistent failures per [FR-PROV-06](../../context.md#fr-prov-06), sits behind a common `Provider` interface that future cloud adapters can implement per [FR-PROV-07](../../context.md#fr-prov-07), exposes a separately configurable embedding call per [FR-PROV-08](../../context.md#fr-prov-08), flips the chat-disabled / indexing-paused unreachable state per [NFR-REL-01](../../context.md#nfr-rel-01), and is validated by an `msw` LM Studio fixture per [NFR-TEST-02](../../context.md#nfr-test-02). It is the substrate every later chat, agent, and indexer feature calls for tokens and vectors.

## Scope

### In scope

- `Provider` TypeScript interface (chat stream, model list, cancellation signal) usable by future adapters; `LMStudioProvider` as its first implementation.
- `ProviderManager` owning the FIFO queue, the 120 s per-request timeout, retry / backoff (max 3 attempts, exponential), and the unreachable state machine that drives a status-bar indicator and `Notice`.
- HTTP client wiring: `POST /v1/chat/completions` with `stream: true` (SSE parse), `GET /v1/models` for model discovery, endpoint URL / chat model / embedding model read from plugin data (Settings UI ships with F03).
- Separate `EmbeddingClient` calling `/v1/embeddings` so chat and embedding models can be configured independently.
- `AbortController` wiring from caller through `fetch` so in-flight streams and embedding calls cancel cleanly.
- Structured log events (`provider.request`, `provider.retry`, `provider.unreachable`, `provider.usage`) through the F01 `Logger`.
- Vitest + `msw` fixture server covering streaming, model listing, queue FIFO order, timeout, retry/backoff, and unreachable-state transition.

### Out of scope

- Tool-use via the OpenAI `tools` parameter and `tool_calls` stream events (ship with F16 `tool-registry-builtin-read`, which owns [FR-PROV-04](../../context.md#fr-prov-04)).
- Settings-tab UI for endpoint / model / temperature / max-tokens and first-run LM Studio wizard (ship with F03 `settings-tab-scaffold`, which owns [FR-PROV-09](../../context.md#fr-prov-09)).
- Cloud providers (OpenAI / Anthropic / Ollama / custom) and `safeStorage`-backed API keys (ship with F38 `cloud-providers-safestorage`, which owns [FR-PROV-10](../../context.md#fr-prov-10)).
- Chat UI streaming render, stop button, and 60 fps target (ship with F07 `chat-streaming-stop`).
- Token-usage display and cost-in-$ (ship with F12 `token-usage-indicator`).
- Agent-level request assembly, truncation, and one-in-flight enforcement at the agent loop (ship with F10 `agent-controller-core`); the queue here is transport-level only.
- RAG embedding consumer wiring (ships with F29 `embeddings-indexeddb-store`).

## Acceptance criteria

1. `LMStudioProvider.stream(prompt, signal)` issues `POST <endpoint>/v1/chat/completions` with `stream: true`, parses SSE chunks into `StreamEvent.token` / `usage` / `done` events, and terminates cleanly when `signal.aborted` becomes true. (FR-PROV-01, FR-PROV-03)
2. `LMStudioProvider.listModels()` issues `GET <endpoint>/v1/models` and returns the parsed model list; settings / callers rely on this for model-picker population. (FR-PROV-02)
3. Concurrent calls to the provider are serialized by `ProviderManager`'s per-provider FIFO queue; at most one request reaches the HTTP client at a time; each request is aborted with a timeout error if it has not produced a terminal event within 120 s. (FR-PROV-05)
4. On a connection-level failure (network error, non-2xx before stream start), `ProviderManager` retries up to three times with exponential backoff; a fourth persistent failure surfaces an Obsidian `Notice` and sets a status-bar indicator to the unreachable state. (FR-PROV-06)
5. A `Provider` interface (chat stream + model list + cancellation) is exported and `LMStudioProvider` implements it without leaking LM Studio-specific types; later adapters can be registered without touching `ProviderManager`'s queue or retry code. (FR-PROV-07)
6. `EmbeddingClient.embed(texts)` calls `POST <endpoint>/v1/embeddings` using the separately configured embedding model and returns `number[][]`; chat-model changes do not alter embedding behavior and vice versa. (FR-PROV-08)
7. When the unreachable state is entered, a public state flag (observable via the Logger event and/or `ProviderManager` readiness API) disables chat and pauses indexing consumers; when a subsequent probe succeeds the state clears and the status-bar indicator resets. (NFR-REL-01)
8. Vitest suite using an `msw` fixture server covers: streaming token order, `/v1/models` response, FIFO ordering under concurrency, 120 s timeout, 3-retry backoff with eventual failure, unreachable-state entry/exit, and separate embedding model routing. (NFR-TEST-02)

## Dependencies

- [F01 plugin-bootstrap-logging](../plugin-bootstrap-logging/feature.md) — consumed for structured `Logger` output (`provider.*` events) and for `Notice` / status-bar helpers on unreachable state.
- Drives requirements [FR-PROV-01](../../context.md#fr-prov-01), [FR-PROV-02](../../context.md#fr-prov-02), [FR-PROV-03](../../context.md#fr-prov-03), [FR-PROV-05](../../context.md#fr-prov-05), [FR-PROV-06](../../context.md#fr-prov-06), [FR-PROV-07](../../context.md#fr-prov-07), [FR-PROV-08](../../context.md#fr-prov-08), [NFR-REL-01](../../context.md#nfr-rel-01), [NFR-TEST-02](../../context.md#nfr-test-02).
- Downstream consumers tracked in [features-index.md](../../features-index.md): F03 (settings UI), F07 (streaming), F10 (agent loop), F16 (tool-use param), F27/F29 (indexer + embeddings), F38 (cloud adapters).

## Implementation notes

- [Architecture §3.4 Adapters — ProviderManager / EmbeddingClient](../../../../architecture/architecture.md#34-adapters) — places `ProviderManager` and `EmbeddingClient` as HTTP adapters; this feature delivers those two rows for LM Studio.
- [Architecture §4 Key Contracts — StreamEvent / AgentRunner](../../../../architecture/architecture.md#4-key-contracts) — fixes the `StreamEvent` shape the provider must yield; `tool_call` / `tool_confirmation` events stay unused until F16.
- [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools) — shows `AgentRunner → ProviderManager.stream` as the callsite; the transport layer here must match that signature.
- [Architecture §7 Error Handling Strategy — LM Studio unreachable](../../../../architecture/architecture.md#7-error-handling-strategy) — mandates status-bar red, fast-fail of queued requests, and a 15 s reconnect probe; AC 7 traces to this row.
- [Architecture §8 Extension Points — New LLM provider](../../../../architecture/architecture.md#8-extension-points) — future providers register via the `Provider` interface delivered here.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — requires one `AbortController` per in-flight request wired through the provider `fetch`; the retry/timeout logic here must compose with that signal.
- [Tech stack — Agent Layer](../../../../standards/tech-stack.md#agent-layer) — pins direct `fetch` + SSE parsing (no SDK) for LM Studio; the provider implementation follows that choice.
- [Tech stack — Retrieval Layer](../../../../standards/tech-stack.md#retrieval-layer) — fixes direct `fetch` to `/v1/embeddings` as the embedding transport used by `EmbeddingClient`.
- [Tech stack — Testing](../../../../standards/tech-stack.md#testing) — selects Vitest + `msw` as the fixture stack; AC 8 is written against that harness.
- [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency) — governs the FIFO queue, timeout, and `AbortSignal` plumbing required by AC 3 and AC 4.
- [Code style — Error Handling](../../../../standards/code-style.md#error-handling) — requires `finally` cleanup of in-flight readers and queue slots on cancel, timeout, or error.
- [Code style — Logging](../../../../standards/code-style.md#logging) — dictates the event-name + fields shape used for `provider.request` / `provider.retry` / `provider.unreachable`.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — fixes how the `msw` fixture is authored and how streaming is simulated.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — "make it observable" and "fail loudly" justify surfacing unreachable state through both log and status bar rather than silent retries.

## Open questions

- Retry log level for transient connection failures (feeds the SRS-level open question on `logLevel` vs `FR-PROV-06` noise): current lean is `warn` for each retry and `error` only on the final persistent failure; confirm with verifier.
- Backoff base and cap are unspecified by the SRS beyond "exponential, max 3"; propose 500 ms × 2^n capped at 4 s unless verification chooses otherwise.
- Unreachable-state probe cadence: architecture §7 says "every 15 s"; SRS is silent. Treating 15 s as authoritative here and noting it for verifier confirmation.
- Behavior when `/v1/models` succeeds but the configured chat model is absent from the response: fall back to the first returned model with a `Notice`, or hard-fail with the unreachable state? Not specified.
- Whether the FIFO queue should expose priority hops for cancellation acks (so a caller's abort jumps the head) — no SRS guidance; default is strict FIFO.
