# F10 · canvas-source-fetcher — Source fetcher adapter

## Purpose

Fetch each `CanvasSourceItem`'s body via 1:1 reuse of `fetchIngestSource` from `src/agent/wiki/ingest/fetchSource.ts`. Per-source failures are recorded with `errorCode` + `errorMessage`; the run continues (partial-success semantics). All-fail short-circuits the subgraph to `ERROR` with `error.code = 'all_sources_failed'`.

Covers [FR-CANVAS-13](../../context.md#functional-requirements), [FR-CANVAS-14](../../context.md#functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/fetch.ts` exporting `fetchCanvasSources(items, deps, signal) → Promise<{ fetched: CanvasSourceItem[]; failedAll: boolean }>`.
- Adapter mapping `CanvasSourceItem` → `IngestSourceRef` shape consumed by `fetchIngestSource`. Returned body populates `fetchedBody` + `contentType`; status flips to `'fetched'` or `'error'`.
- Per-source error capture (no throw escapes): error codes copied verbatim from `fetchIngestSource` (`fetch_vault_missing`, `fetch_vault_not_file`, `fetch_url_failed`, etc.).
- All-fail detection: `failedAll = true` when no `'fetched'` items remain.
- Abort propagation: `signal` threaded through to fetcher; per-source aborts mark `errorCode: 'aborted'` and the outer driver decides cancel vs continue.

**Out of scope**

- Source-body extraction — F11.
- Concurrency limit — fetch is IO-parallel (existing fetcher already self-bounds for HTTP); no extra semaphore in v1.

## Acceptance criteria

1. Fetching 5 sources where 4 succeed → `fetched.length === 5` (with one item's `status === 'error'`); `failedAll === false` — traces to FR-CANVAS-13.
2. All sources error → `failedAll === true`; F16 caller transitions to `ERROR` `all_sources_failed` — traces to FR-CANVAS-14.
3. Per-source `errorCode` is verbatim from `fetchIngestSource`'s structured error (`fetch_vault_missing`, etc.) — traces to FR-CANVAS-13.
4. Aborting mid-fetch surfaces `errorCode: 'aborted'` on in-flight items; awaited promise rejects with `AbortError` only at outer driver boundary, not inside the per-source map.
5. No `Promise.all` rejection cancels sibling fetches: each per-source promise has its own `try/catch`.

## Dependencies

- [../canvas-source-planner/feature.md](../canvas-source-planner/feature.md) — produces `CanvasSourceItem[]`.
- [../canvas-budgets-runid-slug/feature.md](../canvas-budgets-runid-slug/feature.md) — no direct constants used, but per project convention budgets module is the constant home.
- External reuse: `src/agent/wiki/ingest/fetchSource.ts` (existing).
- Forward consumers: [../canvas-extractor/feature.md](../canvas-extractor/feature.md), [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-13, FR-CANVAS-14.

## Implementation notes

- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — adapter layer pattern; canvas reuses wiki ingest fetcher 1:1 (no fork).
- [../../../../architecture/architecture.md#7-error-handling-strategy](../../../../architecture/architecture.md#7-error-handling-strategy) — typed per-source error capture; no throw past adapter.
- [../../../../standards/code-style.md#async--concurrency](../../../../standards/code-style.md#async--concurrency) — `AbortSignal` always threaded; `Promise.all` only when sibling failures should not cancel.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — Framework First / DRY: do not reimplement source fetching.

## Open questions

- If `fetchIngestSource` adds new error codes upstream, do they auto-propagate? Yes (verbatim copy). Add a smoke regression test against the union of known codes to surface new ones.
