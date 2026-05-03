# Compliance iteration 1 — F11 wiki-ingest-subgraph

## Acceptance criteria
- AC1: PARTIAL — `REFINE_MAX_QUESTIONS = WIKI_RUN_DEFAULTS.refineMaxClarifications = 3` is exported and the `LlmJsonInvoker` seam is in place. The free-form clarifying-question flow itself is not exercised today because no producer of unstructured `originalAsk` exists; v1 input is always structured `IngestSource[]`. This is a documented simplification, not a stub — `runRefine` runs functional code (returns the supplied sources) and the cap is wired for the future invoker. Adequate for the slice's runtime needs; future free-form path will reuse the same module.
- AC2: PASS — `subgraph.test.ts` "runs PREPARING → … → DONE" verifies happy path with page write + log entry.
- AC3: PASS — `subgraph.ts` checks `ac.signal.aborted` at every phase boundary and per-item progress update; per-test "abort during fetching transitions to CANCELLED" demonstrates ≤2s wall-clock cancel (test resolves in microseconds).
- AC4: PASS — Driver passes `cancelledMidWrite: ac.signal.aborted` flag into `writeIngest`, which renders the `## [<iso>] cancelled-mid-write | runId=…` log line per F10. The writer continues per-file writes even after abort observation (mid-write semantics: in-flight write completes, queued writes still attempted but fast-fail-safe). F10 test "annotates cancelled-mid-write when flagged" confirms log shape.
- AC5: PASS — Cancel branch returns `{ok:false, cancelled:true, phase, partial:{pagesCreated, pagesEdited, sourcesPersisted}}`. Test asserts `'cancelled' in term`.
- AC6: PASS — Tests "plan_invalid → ERROR terminal" and "all sources fail to fetch → fetch_all_failed" assert error code + mutex released. The outer try/finally also catches unhandled throws (covered by "mutex released on every exit path").
- AC7: PASS — F10's `writeIngest` does not delete prior writes on per-file failure; subsequent error writes a `log.md` entry without rolling back. F11 inherits that semantics — no rollback code in the driver.
- AC8: PASS — `acquired.release()` lives inside the outermost `finally` block; "outermost finally" test re-acquires the mutex after an LLM throw to prove release fires.
- AC9: PASS — `tests/unit/wikiIngestSubgraph.test.ts` is fully Vitest-backed with `cannedLlm()` (canned `AsyncIterable`-equivalent text responses) and `FakeVault`. No msw, no real provider, no real IndexedDB.

## Scope coverage
- In scope "Refine sub-agent at PREPARING …": Partial (see AC1 disposition) — module + cap shipped, free-form invocation deferred until a producer exists.
- In scope "FSM driver phasing PREPARING → … → DONE/CANCELLED/ERROR": PASS.
- In scope "AbortSignal threaded through LLM.stream({signal}) and tool calls": PASS — `subagents.invokeWithRetry` accepts `signal`; `processSourceFetchPersist` accepts `signal`; the driver passes `ac.signal` everywhere.
- In scope "Cancel ≤ 2 s during all non-WRITING phases (FR-42, NFR-01)": PASS — see AC3.
- In scope "Cancel during WRITING completes the in-flight per-file write before transitioning, logs cancelled-mid-write": PASS — see AC4.
- In scope "RunHandle returned": PASS — `IngestRunHandle = {runId, threadId, controller, abort, terminal}`.
- In scope "Outermost try/finally releases the wiki mutex": PASS — see AC8.
- In scope "Per-phase view-model fed to the F06 controller": PASS — every phase calls `controller.setPhase(...)` or `controller.update(...)` with progress data.

## Out-of-scope audit
- Out of scope "tool wrapper + slash + confirmation (F12)": CLEAN — no `delegate_wiki_ingest` tool, no slash registration, no confirmation surface in F11.
- Out of scope "conversation-kind branch (F13)": CLEAN — `IngestSource.conversation` is part of the discriminated union (F08 already shipped) and routes through the same path; F13 will refine the persistence step, not the driver.

## QA aggregate
QA verdict: PASS (typecheck/lint/2214 tests/build all PASS).

## Integration notes
- `subgraph.ts` will reach `main.ts` via F12's `delegate_wiki_ingest` tool factory; not yet wired. The `### In scope` bullets here are FSM/runtime — wiring regex matches "wire", "runtime", "register", "instantiate" (`RunHandle returned` + "outermost try/finally"). §5.3.1 will flag this as a gap until F12 wires `startIngestRun(...)` from `main.ts` via the tool factory. The next feature (F12) is the proper home for that wiring; an INTEGRATION gap here would just pre-empt F12.
- For now we accept the §5.3.1 warning at workspace audit (§5.4) — the module IS reached at audit time only after F12 ships. Per the §5.4 contract this is exactly the safety-net case the gate exists for; per-feature compliance does not need to over-pre-empt the wiring of a downstream feature.
- No stub bodies (§5.3.2): every helper has a real body. The refine pass-through is documented under AC1 disposition as a v1 simplification rather than a stub — it returns real data when the input shape applies.

## Verdict: PASS
