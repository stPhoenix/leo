# F05 — Run phase + write/error transitions

## Purpose

Wire the `RUNNING` → `WRITING` → `DONE` happy path and the `ERROR` / `CANCELLED` failure paths inside the subgraph: invoke the chosen adapter, thread `AbortSignal`, enforce timeout, accumulate streamed events into the state buffers, then drive the writer (F02) and emit the final tool result.

Implements [`context.md`](../../context.md) FR-EXT-15, FR-EXT-16, FR-EXT-17, FR-EXT-18, FR-EXT-22, FR-EXT-23, FR-EXT-24, NFR-EXT-01, NFR-EXT-07.

## Scope

**In scope**
- `run` node implementation in `src/agent/externalAgent/subgraph.ts` (extending the F03 stub): looks up adapter via `AdapterRegistry`, builds `ExternalAgentInput`, calls `adapter.start()`, consumes the `AsyncIterable`.
- Event accumulation into `ExternalAgentState` buffers: `text` → `textBuffer`, `file` → `pendingFiles`, `log` → `logEvents`, `done` → transition to `WRITING`, `error` → transition to `ERROR` carrying `{ code, message }`.
- Timeout: `setTimeout(timeoutMs)` → `controller.abort()`; cleared on terminal event. Treated as `error.code='timeout'`.
- Cancel handling: `RunHandle.cancel()` → `controller.abort()`; if iterable does not terminate within 2 s → force-terminate (kill child / discard reads) → transition to `CANCELLED`.
- `write` node: invokes F02 `ResultWriter.write(...)`; on success → `DONE`; on writer failure → `ERROR` with `error.code='write_failed'` and the writer's partial inventory.
- `terminal` node: composes the `delegate_external` tool result payload from `ExternalAgentState`:
  - `DONE` → `{ ok:true, folder, files, summary, adapterId, durationMs }` where `summary = textBuffer.slice(0, 500)`.
  - `ERROR` → `{ ok:false, error:{code,message}, folder, files }` (folder + files may be `null` / `[]`).
  - `CANCELLED` → `{ ok:false, cancelled:true, phase: <last-non-terminal> }`.
- Vitest suite using mock adapter (from F03 helper): happy path, timeout, cancel mid-stream, adapter throws, adapter emits error event, writer fails, partial-write-then-error.

**Out of scope**
- Adapter implementations (F09, F10).
- Writer internals (F02 — already specified).
- Widget event projection (F07).

## Acceptance criteria

1. `run` node calls `adapter.start({ refinedAsk, systemPrompt: <core base + adapter optional augment via input.systemPrompt>, signal, timeoutMs, config })`. **Adapter is the only consumer of `config`** — subgraph passes through opaque value parsed earlier by F11. Honors FR-EXT-15.
2. Each `text` event appends to `textBuffer`. Order preserved. Honors FR-EXT-16 (data side).
3. Each `file` event appended to `pendingFiles` (no immediate vault write). Honors FR-EXT-16 + isolation invariant.
4. `done` event → transition to `WRITING`. `error` event → transition to `ERROR` carrying the adapter's `{code, message}`. Honors FR-EXT-22, FR-EXT-23.
5. Timeout: from `start()` invocation, expiry triggers `AbortSignal`; resulting state is `ERROR` with `error.code='timeout'`. Honors FR-EXT-17.
6. Cancel: `cancel()` from `RUNNING` triggers `AbortSignal`; subgraph reaches `CANCELLED` within ≤ 2 s wall-clock under `vi.useRealTimers` integration test. Honors FR-EXT-18 + NFR-EXT-01.
7. If adapter ignores abort beyond 2 s, the run node still transitions to `ERROR` with `error.code='abort_timeout'` and detaches the iterable (no further events processed).
8. `WRITING` → `DONE` on writer success; the produced `summary` is exactly the first 500 characters of `textBuffer` (no trailing-whitespace trim). Honors FR-EXT-22.
9. All IO sites in the run node are `try/finally`-wrapped to clear timers, dispose the iterator, and release `AbortController` references. Honors NFR-EXT-07.
10. Tool-result payload shape matches FR-EXT-22 / FR-EXT-23 / FR-EXT-24 exactly; consumed by F06's tool resume.

## Dependencies

- **F02** — `ResultWriter` API.
- **F03** — `ExternalAgentState`, slot manager, terminal-state semantics, `runId`.
- Cross-doc:
  - [`context.md#fr-ext-15`](../../context.md#functional-requirements)
  - [`../result-writer/feature.md`](../result-writer/feature.md)
  - [`../subgraph-state-machine/feature.md`](../subgraph-state-machine/feature.md)

## Implementation notes

- `AbortController` plumbing — pass `signal` end-to-end per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Async & Concurrency" and [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §10.
- Tool result shape — must match `ToolResult` discriminated-union convention from [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"LangGraph / Agent Layer" (`{ ok:true, data } | { ok:false, error }`).
- Streaming consumption pattern — `for await ... of` with `try/finally` per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Async & Concurrency".
- Timeout semantics — explicit, no ambient default; align with [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Async & Concurrency" ("Timeouts explicit on every fetch").
- Cancellation pattern — see [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §5.6 for the existing main-agent cancel flow; F05 mirrors it locally.

## Open questions

- **OQ-01-F05** Adapter emits `done` followed by more `text` events (model bug). **Proposed**: ignore post-`done` events, log `warn`.
- **OQ-02-F05** When writer fails to create even the result folder, `tool result` returns `folder: null` — but F08's collapsed view links to a folder. **Proposed**: collapsed view must handle `folder=null` (render "no folder created" instead of a link). Cross-cut to F08 acceptance.
- **OQ-03-F05** What happens to `pendingFiles` if writer succeeds for some entries and fails for others mid-iteration? Spec'd in F02 (writes `error.md` with partial inventory) but the *tool result* needs to convey both successes and the error. **Proposed**: tool result `{ ok:false, error, folder, files: writtenFiles }` — caller sees what landed.
