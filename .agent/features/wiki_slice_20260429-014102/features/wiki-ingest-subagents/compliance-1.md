# Compliance iteration 1 — F09 wiki-ingest-subagents

## Acceptance criteria
- AC1: PASS — `subagents.ts:runPlanner` calls `PlannerOutputSchema.safeParse`. Test "marks errored when invalid JSON exhausts the single retry" + "parses valid JSON output".
- AC2: PASS — `WIKI_BUDGETS` from F04 referenced for `extractorInputCap=8000`, `extractorOutputCap=1500`, `reducerInputCap=6000`, `reducerOutputCap=2000`, `plannerInputCap=4000`, `plannerOutputCap=1500`. Test "extractor concurrency cap (default 1) holds for default budgets" pins the input/output values.
- AC3: PASS — `invokeWithRetry` runs exactly once on first failure (Zod / JSON), then once more with parser-error suffix, then returns `{ok:false, error: errorCode}` (`extract_invalid`/`reduce_invalid`). Tests cover both extractor and reducer.
- AC4: PASS — `createSemaphore` enforces `inFlight ≤ maxConcurrency`; `runBatched` is the only fan-out helper. No `Promise.all` over the per-source / per-page LLM calls. Test "caps concurrent acquires to maxConcurrency" + "caps in-flight workers to semaphore size".
- AC5: PASS — All three subagents accept a `LlmJsonInvoker` (text in/out). Tests use `fixedInvoker(responses)`; no real provider, no msw. NFR-06 honoured.
- AC6: PASS — Each subagent threads `signal` into `tryOnce` and short-circuits to `{ok:false, error:'aborted'}` when aborted before invoke. Test "passes abort signal through to invoker" asserts pre-aborted invoker is never called. Semaphore additionally throws `AbortError` when waiter aborts.

## Scope coverage
- In scope "Planner: single LLM call producing {ingestId, perSource}; Zod-validated": PASS — `runPlanner` + `PlannerOutputSchema`.
- In scope "Extractor: fan out per raw entry under extractorConcurrency semaphore … input truncated to extractorInputCap=8000, output capped at extractorOutputCap=1500; Zod retry-once-then-mark-error: extract_invalid": PASS — `runExtractor` + `runBatched(items, createSemaphore({maxConcurrency: WIKI_RUN_DEFAULTS.extractorConcurrency}), …)` is the canonical wiring; test verifies retry+error code.
- In scope "Reducer: same shape per page; reducerConcurrency=1; reducerInputCap=6000 / reducerOutputCap=2000; reduce_invalid on second failure": PASS — `runReducer` + same retry path.
- In scope "Semaphore module — explicit, never Promise.all (NFR-08)": PASS — `createSemaphore` + `runBatched`.

## Out-of-scope audit
- Out of scope "FSM driver (F11)": CLEAN — no LangGraph driver code in F09.
- Out of scope "writer (F10)": CLEAN — `ReducerOutput` is produced but never written; F10 will consume.

## QA aggregate
QA verdict: PASS (typecheck/lint/2200 tests/build all PASS).

## Integration notes
- F09 modules currently have no consumer at the entry point. F11 will instantiate per-run `LlmJsonInvoker` from `ProviderManager`+`ChatOpenAI`/etc. and invoke `runPlanner/runExtractor/runReducer` inside its FSM nodes. The `### In scope` bullets are domain logic with no wiring regex matches; §5.3.1 emits a warning rather than a gap.
- No stub bodies (§5.3.2): every function has a real implementation. The `LlmJsonInvoker` callback is a dependency injection seam (functional behaviour: "invokes LLM"), not a stub.

## Verdict: PASS
