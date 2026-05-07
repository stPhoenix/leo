# Impl iteration 1 — F16 canvas-subgraph

## Summary

Hand-rolled FSM driver `startCanvasRun(deps, input)` orchestrating canvas creation/edit phases. Mirrors wiki/ingest precedent but without LangGraph (FSM is straight-line by design — no parallel branches). Returns `{ok: true, handle}` with `runId / abort / terminal` or `{ok: false, busy}`.

## Files

- `src/agent/canvas/state.ts` — `CanvasPhase` const-union (`awaiting_config | preparing | planning | fetching | extracting | reducing | diffing | laying_out | previewing | writing | done | cancelled | error`), `CanvasFailedSource`, `CanvasPartial`, `CanvasErrorPayload`, `CanvasTerminalState`, `CanvasState`, `EditAction`, `PreviewingDecisionAdapter`.
- `src/agent/canvas/subgraph.ts` — `startCanvasRun(deps, input) → StartCanvasResult`. Mutex acquired upfront keyed by `targetPath`; busy short-circuits to `{ok: false, busy}`. Phases driven by while-loop dispatch; cancel handled via `aborted` flag + `inUninterruptibleWrite` guard during commit/sidecar write. Edit loop bounded by `CANVAS_BUDGETS.editIterationsMax` (3). Preview cleanup on cancel/error. SubgraphProvider extends refine + extractor + reducer.
- `tests/unit/canvas/subgraph.test.ts` — 7 tests: happy path → DONE, mutex contention → busy, all sources fail → error, target_path_exists pre-write, mutex released after error, edit_iterations_exhausted, cancel mid-run → cancelled + cleanup.

## Decisions

- **Hand-rolled FSM, not LangGraph** — canvas FSM is deterministic, single-thread, no concurrent fan-out at graph level. LangGraph adds StateGraph + Annotation overhead with no payoff. Wiki used LangGraph for `interrupt()` checkpointing during duplicate prompts; canvas duplicate decisions live at adapter layer (`PREVIEWING`), not mid-pipeline. Justification per Framework First exception (b): no framework primitive matches the use case better than plain async/await.
- **Mutex key = targetPath** — different canvases run in parallel; same canvas serialized. Matches FR-CANVAS-58.
- **`inUninterruptibleWrite` boolean** — abort during commit + sidecar write would leave half-written canvas. Two-step write (atomic tmp+rename, sidecar) is uninterruptible by design.
- **Edit loop fixed cap** — diff/extract/reduce can iterate up to `editIterationsMax`; on exhaustion → terminal `error` with `edit_iterations_exhausted` code.

## Test coverage

7 cases — happy / mutex / all-fail / target-exists / mutex-release-on-error / edit-cap / cancel. Pure FSM exercised via fake providers.

## QA local

Typecheck/lint/test/build: all green.
