# Compliance iteration 1 — F05 wiki-mutex

## Acceptance criteria
- AC1: PASS — `mutex.ts:36-58` returns `{ok:true,release}` when no holder. Test "acquire returns ok+release when no holder".
- AC2: PASS — `mutex.ts:36-46` returns `{ok:false,error:'busy',activeRunId,activeOp}` on contention. Test "second acquire while held returns busy with active runId+op".
- AC3: PASS — `release` closes over `holder.released` boolean and short-circuits on second call. Test "release is idempotent".
- AC4: PASS — `withWikiMutex` wraps body in `try { ... } finally { acquired.release(); }`. Tests cover release on throw, release on pre-aborted signal (body never runs), and release on busy outcome (no body run).
- AC5: PASS — Unit tests cover all four mandated scenarios: contention, throw, abort, double-release.

## Scope coverage
- In scope "WikiMutex module exposing acquire(op,runId) → {ok:true,release} | {ok:false,error:'busy',activeRunId,activeOp}": PASS — `mutex.ts:WikiMutex.acquire`.
- In scope "active(): {runId,op} | null accessor": PASS — `mutex.ts:WikiMutex.active` returns `{kind:'idle'}` (no holder) or `{kind:'busy',op,runId}` per shared `WikiMutexState` shape from F03/F04.
- In scope "Acquire/release wired by subgraph drivers (F11, F18) inside an outer try/finally": PASS — `withWikiMutex` provides the canonical wrapper. F11 + F18 will adopt this helper.

## Out-of-scope audit
- Out of scope "queueing": CLEAN — second acquire fails immediately, no queue.
- Out of scope "fairness": CLEAN — single holder, no scheduling logic.
- Out of scope "multi-vault locks": CLEAN — purely in-process state.

## QA aggregate
QA verdict: PASS (typecheck/lint/2132 tests/build all PASS).

## Integration notes
- `WikiMutex` reached from `main.ts:91-93,308,884` (`new WikiMutex(...)` instantiation + slot).
- `mutex.ts` imports `loggingNamespaces.ts` (F04) and `mutexTypes.ts` (F03) — F04/F03 modules now have a real consumer at the entry-point level, eliminating the §5.3.1 warning state.
- F03's `/wiki-status` widget now surfaces real mutex state automatically (no F03 file changed): `getMutexState: () => this.wikiMutex?.active() ?? WIKI_MUTEX_IDLE` returns `{kind:'busy',op,runId}` when an ingest/lint run holds the mutex.
- No stub bodies (§5.3.2): `acquire`/`release`/`active`/`withWikiMutex` all execute real state transitions.

## Verdict: PASS
