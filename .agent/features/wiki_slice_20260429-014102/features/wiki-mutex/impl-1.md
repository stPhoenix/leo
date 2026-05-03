# Impl iteration 1 — F05 wiki-mutex

## Summary
Implemented `WikiMutex` (vault-global, in-memory, per-plugin-process) with `acquire(op,runId)` returning either `{ok:true,release}` or `{ok:false,error:'busy',activeRunId,activeOp}`. Added `withWikiMutex(opts, body)` helper that wraps the body in a `try/finally` so release always fires on terminal/throw/abort. Also instantiated `this.wikiMutex = new WikiMutex(...)` in `main.ts onload`, which retroactively makes `/wiki-status` (F03) surface live mutex state.

## Files touched
- `src/agent/wiki/mutex.ts` — `WikiMutex` class, `WikiMutexAcquireResult` union, `withWikiMutex` helper. Logs `wiki.mutex.acquired/released/busy` at debug.
- `src/main.ts` — import `WikiMutex`, instantiate after bootstrap; private slot retyped from `WikiMutexLike | null` to concrete `WikiMutex | null`.

## Tests added or updated
- `tests/unit/wikiMutex.test.ts` — acquire/release happy path; busy on contention with active{RunId,Op}; release idempotent; `withWikiMutex` releases on body throw, on pre-aborted signal (no body run), and returns busy result without invoking body when contended.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
None.

## Assumptions
- `withWikiMutex` is the canonical entry path subgraph drivers (F11, F18) will use; it raises an `AbortError` via `DOMException` when the supplied signal is already aborted at acquire time, so callers see uniform abort semantics regardless of where in the lifecycle abort happens.

## Open questions
None.
