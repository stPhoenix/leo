# Impl iteration 1 — F09 wiki-ingest-subagents

## Summary
Stood up the three LLM-bound subagents (planner / extractor / reducer) plus the explicit FIFO semaphore + `runBatched` runner that replace ad-hoc `Promise.all`. All three subagents accept a Zod-validated injectable `LlmJsonInvoker`, enforce the F04 token caps via the system+user prompt prefixes, and follow the retry-once-then-mark-error contract returning `{ok:false, error:'extract_invalid'|'reduce_invalid'}` on second failure.

## Files touched
- `src/agent/wiki/ingest/schemas.ts` — Zod: `PageOpSchema` (`create` | `edit`), `ExtractorOutputSchema`, `ReducerOutputSchema`, `PlannerOutputSchema`. Inferred TS types exported.
- `src/agent/wiki/ingest/subagents.ts` — `runPlanner`, `runExtractor`, `runReducer`, `LlmJsonInvoker` interface, internal `invokeWithRetry` retry-once driver with prompt-cap truncation + JSON-fence strip + Zod validation; failure surfaces structured `error_code` (`extract_invalid` / `reduce_invalid`) on second exhaustion.
- `src/agent/wiki/ingest/semaphore.ts` — `createSemaphore({maxConcurrency})` returning `{acquire(signal?), inFlight, pending}`. AbortSignal-aware; rejects waiters on abort.
- `src/agent/wiki/ingest/runBatched.ts` — `runBatched(items, semaphore, worker, signal)` — fan-out under semaphore cap; replaces ad-hoc `Promise.all` per NFR-WIKI-08.

## Tests added or updated
- `tests/unit/wikiIngestSubagents.test.ts` — Zod schema acceptance for FR-29 / FR-30 / FR-31 shapes; planner happy path + retry-exhausted invalid; pre-aborted signal short-circuits invoker (AC6); extractor retry-once → `extract_invalid` code; extractor accepts valid pageOps + strips ```json fences; reducer retry-once → `reduce_invalid`; semaphore rejects on bad max + caps concurrency + aborts waiters; runBatched holds in-flight to semaphore cap; budgets sanity (AC2).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- The subagents accept a small `LlmJsonInvoker` callback (text in / text out) rather than wiring the langchain `ChatModel` directly. This keeps F09 unit-testable per NFR-06 ("end-to-end testable with a canned AsyncIterable LLM and fake VaultAdapter") while letting F11's subgraph driver compose `ChatOpenAI`/`ChatAnthropic` into the same callback at run time. Equivalent contract; cleaner test surface.

## Assumptions
- `PageOp` Zod shape (kind: create / edit) is a v1 sketch that satisfies SCHEMA.md conventions. F10's writer will consume the same schema; alterations are a coordinated change between F09 and F10.
- Token cap enforcement uses `roughTokenCountEstimation` from `@/agent/tokenEstimator` (4 chars per token), with truncation at the user-prompt boundary. The output cap is enforced as a defensive raw-byte clip (`outputCap * 8`) before JSON parse.
- All three subagents emit `wiki.ingest.<phase>.{ok|retry|invalid}` debug events from F04's `WIKI_LOG`.

## Open questions
- OQ-2 — merge planner into refine sub-agent on small models — deferred per spec; revisit in Phase 5.
