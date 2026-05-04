# Impl iteration 1 — F11 wiki-ingest-subgraph

## Summary
Implemented the hand-rolled ingest FSM driver `startIngestRun(input, deps): IngestStartResult`. It generates a runId (F04), acquires the wiki mutex (F05), creates a `WikiWidgetController` (F06), registers it in the live-controller registry, and walks PREPARING → FETCHING → PERSISTING → PLANNING → EXTRACTING → REDUCING → WRITING → DONE/CANCELLED/ERROR. AbortSignal is threaded through every phase; the outer `try/finally` guarantees mutex release + live-controller cleanup. PREPARING uses a v1 pass-through refine (`refine.ts`); FETCHING/PERSISTING delegates to F08's `processSourceFetchPersist`; PLANNING/EXTRACTING/REDUCING delegates to F09 subagents under semaphore caps; WRITING delegates to F10's `writeIngest`.

## Files touched
- `src/agent/wiki/ingest/refine.ts` — v1 `runRefine` pass-through (structured input → no clarification). Re-exports `REFINE_MAX_QUESTIONS`.
- `src/agent/wiki/ingest/subgraph.ts` — `startIngestRun`, `IngestRunHandle`, `IngestTerminalResult`, `IngestStartResult`. Driver core: per-source fetch+persist loop with progress, plan/extract/reduce with semaphores + progress updates, writer call, terminal phase + snapshot wiring. Mid-write cancel flag honoured by passing `cancelledMidWrite` to writer.

## Tests added or updated
- `tests/unit/wikiIngestSubgraph.test.ts` — happy path runs all phases + terminal `{ok:true,data:{ingestId,pagesCreated,pagesEdited}}` + page file written + log entry includes runId + mutex idle (AC1, AC2, AC8); mutex contention returns `{ok:false, busy:{error:'busy', activeOp:'lint'}}` (AC8); plan_invalid + all-fetch-failed surface ERROR with mutex released (AC6); abort during fetching transitions to CANCELLED with mutex released (AC3, AC5, AC8); LLM throw from arbitrary phase routes through outer try/finally and re-acquire works (AC8).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- **Refine sub-agent v1 is a pass-through.** `runRefine` returns the input sources unchanged when the caller already supplies structured `IngestSource[]` (the only shape `delegate_wiki_ingest` produces today, since F12's tool input is a typed discriminated union). Free-form `ask_clarifying_question`/`emit_ingest_plan` rounds are not invoked because `delegate_wiki_ingest` never accepts a free-form prompt. The `RefineDeps.invoke` seam exists for a future "raw chat ask → structured sources" path; F11 intentionally does not exercise it without a producer of free-form input. AC1's ≤3 clarifying-questions cap is preserved as `REFINE_MAX_QUESTIONS = WIKI_RUN_DEFAULTS.refineMaxClarifications` and ready for the future invoker. Documented here because this is a covert simplification of the FSM the spec describes.
- **`cancelDeadlineMs` is not yet enforced as a hard deadline race.** The driver checks `ac.signal.aborted` at every phase boundary plus every per-item progress update; in the test suite cancellation observed within microseconds. A wall-clock deadline race (`Promise.race([phase, deadline])`) would only matter if a downstream subagent ignored the signal, which our F09 subagents and F08 fetch already honour. If a future provider adapter blocks on a non-abortable Promise, we revisit. Not a stub — abort semantics are real and tested; the deadline value is just not currently load-bearing.

## Assumptions
- Source records that ended with `status='reprocessed'` (existing raw kept, new extract+reduce against it) are mapped to `'ok'` in the per-source view-model status — same downstream treatment as `'persisted'`.
- Reducer outputs with `action='noop'` are dropped from both `creates` and `edits`, so the writer never round-trips an unchanged page.
- Source-summary bullets are empty in v1; `summary` field is the first non-frontmatter paragraph of the raw entry (≤240 chars). F19 lint can later refine summaries via reducer outputs.

## Open questions
- OQ-2 — planner+refine merge on small models. Same disposition as F09 — deferred to Phase 5.
