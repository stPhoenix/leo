# Impl iteration 1 — F05 run-phase

## Summary

Hardened the F03 driver's `RUNNING` → `WRITING` → `DONE`/`ERROR`/`CANCELLED` machinery and added the F02-binding helpers in `src/agent/externalAgent/runPhase.ts`. The adapter loop now races every `iterator.next()` against the abort signal so a hanging adapter that ignores abort gets force-terminated with `error.code='abort_timeout'` after a configurable grace window (default 2 s, NFR-EXT-01). Post-`done` events are dropped and counted (warn-logged) per OQ-01-F05. Tool-result builder (`buildToolResult`) translates terminal `ExternalAgentState` into the `delegate_external` payload exactly per FR-EXT-22 / FR-EXT-23 / FR-EXT-24 (DONE → `{ok:true, folder, files, summary, adapterId, durationMs}` with `summary = textBuffer.slice(0,500)`; CANCELLED → `{ok:false, cancelled:true, phase}`; ERROR → `{ok:false, error, folder, files}`). Writer-deps adapter wraps F02's `ResultWriter` so the subgraph stays clean of vault concerns. Adapter-call deps is currently passthrough (slot for future tracing decorators).

## Files touched

- `src/agent/externalAgent/subgraph.ts` — replaced `for await` with manual `iterator.next()` race; added abort observer + grace timeout; iterator `return()` cleanup in `finally`; post-done event drop with warn.
- `src/agent/externalAgent/runPhase.ts` — `buildToolResult`, `createResultWriterDeps`, `createPassthroughAdapterCallDeps`, `SUMMARY_MAX_CHARS`.
- `tests/unit/externalAgent/runPhase.test.ts` — 7 cases covering tool-result variants (done/cancelled/error), writer wiring (ok + error path), adapter-call passthrough, and abort_timeout when adapter ignores AbortSignal.

## Tests added or updated

- AC1 — `createPassthroughAdapterCallDeps` test asserts `refinedAsk` and `systemPrompt` flow through; subgraph driver supplies `signal`/`timeoutMs`/`config`.
- AC2/3 — `applyExternalEvent` (F03) appends `text`/`file`/`log`; subgraph happy-path test (F03 suite) asserts `textBuffer` ordering.
- AC4 — F03 driver tests cover done → writing and error → error transitions.
- AC5 — F03 timeout test (`subgraph.test.ts:adapter timeout → error.code=timeout`).
- AC6 — F03 cancel-from-running test (`<50ms`).
- AC7 — `runPhase.test.ts:transitions to error abort_timeout when adapter does not honor abort` with `abortGraceMs: 50`.
- AC8 — `runPhase.test.ts:done → ok payload with summary cap` asserts `summary.length === 500`.
- AC9 — `try/finally` blocks in `runAdapterPhase`: timer cleared, listener removed, iterator `return()` called.
- AC10 — Tool-result shape verified across all three terminal phases.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The 2 s abort grace is implemented in the F03 driver (`runAdapterPhase`) rather than in a separate F05 module. F05 adds the `runPhase.ts` wiring helpers + the abort-grace test; the bare driver lives in `subgraph.ts` for cohesion.
- `ResultWriter` always emits `error.md` on failure paths (F02 invariant), so even an `error`-status writer call returns `writtenFiles` containing what flushed. `createResultWriterDeps` therefore returns `ok: result.ok` and the subgraph treats the writer's `ok=false` as the final ERROR (matching OQ-03-F05 — tool result conveys both successes and the error).

## Assumptions

- Default abort grace = 2 s (NFR-EXT-01). Tests use 50 ms for speed.
- Per OQ-01-F05: post-done events dropped + warn log.
- Per OQ-02-F05: `folder` may be `''` in the tool result if writer never created the folder; F08 handles the empty-string case.
- Per OQ-03-F05: tool result on partial-write failure carries `files: writtenFiles` (whatever ResultWriter flushed) and `error: { code, message }`.

## Open questions

OQ-01/02/03-F05 honored as documented. No new open questions.
