# Impl iteration 1 — F02 provider-lmstudio-core

## Summary

Delivered the LM Studio transport layer: a `Provider` interface with `LMStudioProvider` as its first implementation (direct `fetch` + SSE parse for `/v1/chat/completions`, plus `/v1/models` discovery), a `ProviderManager` adapter that owns a per-provider FIFO queue, 120 s per-attempt timeout, max-3 exponential-backoff retry, and an `unreachable` state machine that publishes through a `ConnectionState` observable and logs a userFacing `provider.unreachable` event on persistent failure, a separately-configurable `EmbeddingClient` calling `/v1/embeddings` with the same retry/timeout shape and connection-state participation, and 27 new tests (15 unit + 12 integration) covering streaming, model listing, FIFO ordering, timeout, retry/backoff, unreachable entry, probe-driven exit, and embedding model routing using an `msw` fixture LM Studio server.

## Files touched

- `src/util/fifoQueue.ts` — new — FIFO acquire/release primitive shared by ProviderManager (and future agent loop).
- `src/util/delay.ts` — new — abortable `delay(ms, signal)` helper used by retry backoff.
- `src/providers/types.ts` — new — `Provider` / `ProviderChatRequest` / `StreamEvent` / `ProviderModel` plus `ProviderConnectError` / `ProviderTimeoutError` typed errors.
- `src/providers/connectionState.ts` — new — observable `available` ↔ `unreachable` state machine consumed by status-bar wiring and EmbeddingClient.
- `src/providers/sseParser.ts` — new — `parseSseDataFrames` async generator: chunked UTF-8 decode, CRLF normalisation, blank-line frame split, multi-line `data:` joining.
- `src/providers/lmStudioProvider.ts` — new — `LMStudioProvider` implementing `Provider`; OpenAI-compatible chat-completion SSE stream + `/v1/models`; throws `ProviderConnectError` pre-stream on network/non-2xx and re-throws abort reason on signal abort.
- `src/providers/embeddingClient.ts` — new — `EmbeddingClient.embed()` posting to `/v1/embeddings` with caller-injected timeout, max-attempts, exponential backoff, connection-state participation, and abort propagation.
- `src/providers/providerManager.ts` — new — owns FIFO queue + per-attempt timeout + connection-error retry policy + unreachable state machine + 15 s `listModels` reconnect probe.
- `src/main.ts` — extended `LeoSettings` with provider sub-shape (endpoint / chatModel / embeddingModel), instantiates `LMStudioProvider`/`ProviderManager`/`EmbeddingClient`, adds a second status-bar item bound to `ConnectionState` transitions, and disposes the manager on `onunload`.
- `package.json` — adds `msw@^2.13.4` to `devDependencies` (per AC8 / NFR-TEST-02).

## Tests added or updated

- `tests/unit/fifoQueue.test.ts` — single-slot serialisation, enqueue order under concurrency, error isolation across enqueues. (AC3)
- `tests/unit/connectionState.test.ts` — initial `available`, change-only transitions, unsubscribe. (AC7)
- `tests/unit/sseParser.test.ts` — frame split, multi-line data join, mid-frame chunk boundary, CRLF normalisation, trailing-frame flush. (AC1)
- `tests/integration/_mswServer.ts` — shared `setupServer` lifecycle plus chat-chunk / usage-chunk / [DONE] helpers reused across integration suites.
- `tests/integration/lmStudioProvider.test.ts` — token/usage/done order from SSE, request-body shape (model + messages + `stream:true` + temperature + max_tokens), mid-stream abort termination, `/v1/models` parse + non-2xx → `ProviderConnectError`, and pre-stream non-2xx on chat path → `ProviderConnectError`. (AC1, AC2)
- `tests/integration/embeddingClient.test.ts` — `/v1/embeddings` body uses the embedding model and parses vectors; chat-model changes do not affect embedding routing; empty input fast-paths to `[]`; refuses to call when ConnectionState is `unreachable`. (AC6)
- `tests/integration/providerManager.test.ts` — peak-concurrency=1 + enqueue-order under three concurrent streams (AC3), per-attempt timeout produces an `error` event (AC3), 3 retries then success (AC4), 4-attempt persistent failure surfaces userFacing `provider.unreachable` and flips state to `unreachable` (AC4 + NFR-REL-01), unreachable fast-fails new streams without hitting the network (AC7), and probe-driven `available` recovery on `/v1/models` success (AC7).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

None. The four open questions in `feature.md` were resolved as the doc proposed:

- Retry log level: `warn` for each retry, `error` for persistent unreachable transition.
- Backoff: `500 ms × 2^attempt`, capped at `4 s`; both knobs are constructor-injected so tests use 1 ms/5 ms.
- Probe cadence: 15 s default (architecture §7); injectable for tests.
- Strict FIFO with no priority hops; cancellation surfaces by aborting the caller signal which short-circuits both the `delay()` between retries and the in-flight attempt's `AbortController`.
- Behaviour when `/v1/models` succeeds but the configured chat model is absent is intentionally deferred — F03 (settings UI) is the natural owner of model-picker reconciliation; this feature only exposes `listModels()` for that consumer.

## Assumptions

- Connection-level retry classification = `ProviderConnectError` (pre-stream), strictly. `ProviderTimeoutError` and any post-first-event failure surface as a single `StreamEvent.error` without retry, matching AC4's "network error or non-2xx before stream start" wording.
- `EmbeddingClient` shares `ConnectionState` with `ProviderManager` (both read it to fast-fail and both call `markUnreachable()` on persistent failure) so the same status-bar / Notice path is reused across chat and embedding callsites.
- The "second" status-bar item added in `main.ts` is the provider connection indicator (architecture §7 calls for "status bar red"); the existing logger-owned status-bar item from F01 is left for `Logger.error({ userFacing: true })` usage.
- `body.cancel()` was deliberately not called in the provider's stream finally — the caller's `AbortSignal` already drives undici's response teardown, and pre-emptive cancel hangs when the reader still holds the lock.

## Open questions

- The `provider.request` log event currently fires only at attempt start. If F12 (`token-usage-indicator`) wants per-attempt latency, consider also logging on first token / done with elapsed ms.
- The `ConnectionState` subscriber on the provider status-bar element is unsubscribed in `onunload` but the element itself is owned by Obsidian — confirm during the F01 manual-vault smoke that `addStatusBarItem` cleanup is automatic (it should be via `Plugin.register`-style auto-cleanup, but I did not verify in a real Obsidian instance).
