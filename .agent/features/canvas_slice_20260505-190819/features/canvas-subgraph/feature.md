# F16 · canvas-subgraph — Subgraph FSM driver + orchestrator

## Purpose

Hand-rolled FSM driver implementing the canvas state machine: `AWAITING_CONFIG → PREPARING → PLANNING → FETCHING → EXTRACTING → REDUCING → DIFFING → LAYING_OUT → PREVIEWING → WRITING → DONE | CANCELLED | ERROR`. Wires F08–F15 in order. Threads `AbortSignal` through every node + LLM call. Acquires/releases `CanvasMutex` in outermost try/finally. Cleans up the preview file on cancel/pre-WRITING error. Surfaces edit-loop transitions (Approve → WRITING; Edit → PREPARING with appended instruction; Cancel → CANCELLED). Mirrors `src/agent/wiki/ingest/subgraph.ts` and `src/agent/externalAgent/subgraph.ts`.

Covers [FR-CANVAS-40](../../context.md#functional-requirements), [FR-CANVAS-49](../../context.md#functional-requirements), [FR-CANVAS-51](../../context.md#functional-requirements), [FR-CANVAS-52](../../context.md#functional-requirements), [FR-CANVAS-53](../../context.md#functional-requirements), [FR-CANVAS-54](../../context.md#functional-requirements), [NFR-CANVAS-01](../../context.md#non-functional-requirements), [NFR-CANVAS-02](../../context.md#non-functional-requirements) (in-memory state), [NFR-CANVAS-05](../../context.md#non-functional-requirements), [NFR-CANVAS-06](../../context.md#non-functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/state.ts` — `CanvasState`, `CanvasPhase`, `CanvasOp`, `RunPlan`, `DiffResult`, `SidecarV1` types (per SRS §6 verbatim).
- `src/agent/canvas/subgraph.ts` exporting `startCanvasRun(deps, input) → RunHandle` — `RunHandle = { runId, abort(), terminal: Promise<TerminalState> }`. Drives FSM via plain `async/await` (not LangGraph runtime — explicit FSM is simpler to test per NFR-CANVAS-06).
- `src/agent/canvas/orchestrator.ts` exporting `CanvasOrchestrator` with `start({ threadId, op, input, persistSnapshot, beginTrace? }) → { ok, handle, terminal } | { ok: false, busy, activeRunId, activeOp }`. Acquires mutex, mounts widget, hands `RunHandle` upward.
- Edit-loop counter capped at `editIterationsMax = 3`; exhausting → ERROR `edit_iterations_exhausted`.
- Cancel handling: any non-WRITING phase → CANCELLED ≤ 2s wall-clock (signal threaded). WRITING → finish in-flight rename + sidecar write before flipping to CANCELLED (FR-CANVAS-50).
- Preview cleanup: invoked in CANCELLED + pre-WRITING ERROR paths (NFR-CANVAS-05).
- `partial` field assembly per SRS §8.4 — `fetchedSources`, `extractedSources`, `previewPath?`.
- Optional `beginTrace({ runId, threadId })` plumbing for Langfuse export, mirroring wiki/external-agent.

**Out of scope**

- Widget rendering — F17.
- Tool wrapping — F19/F20/F21.
- Layout-edit degenerate FSM — F21 reuses subgraph but skips PLANNING/FETCHING/EXTRACTING/REDUCING/DIFFING.

## Acceptance criteria

1. Happy-path `create` run with mock LLM advances through all 11 phases and ends DONE; tool result includes `runId`, `path`, `insights`, `durationMs` — traces to FR-CANVAS-40.
2. Cancel during EXTRACTING → CANCELLED ≤ 2s wall-clock from `abort()`; `partial.fetchedSources` populated — traces to FR-CANVAS-49, FR-CANVAS-51, NFR-CANVAS-01.
3. Cancel during WRITING completes the in-flight rename + sidecar write; canvas not half-renamed; result `cancelled: true, phase: 'writing'` — traces to FR-CANVAS-50.
4. Reducer parse-fail twice → ERROR `reduce_invalid`; sidecar **not** updated; preview deleted in cleanup — traces to FR-CANVAS-19, FR-CANVAS-52, FR-CANVAS-53, NFR-CANVAS-05.
5. All sources fetch-fail → ERROR `all_sources_failed` — traces to FR-CANVAS-14, FR-CANVAS-52.
6. Per-source extract-fail (1 of 5) → run continues, `partial.failedSources` records the one — traces to FR-CANVAS-54.
7. Edit at PREVIEWING → re-enters PREPARING with refine history + appended instruction; counter increments; `editIterationsMax` exhausted → ERROR — traces to FR-CANVAS-39, FR-CANVAS-40.
8. Mutex contention: second `start` against same path returns `{ ok: false, busy, activeRunId, activeOp }` immediately — traces to FR-CANVAS-47.
9. Mutex released on every terminal path (DONE, CANCELLED, ERROR) — verified by post-condition assertion on mutex.
10. Subgraph end-to-end test runs with mocked LLM (canned `AsyncIterable`) and `InMemoryVaultAdapter` — no msw, no provider — traces to NFR-CANVAS-06.

## Dependencies

- [../canvas-budgets-runid-slug/feature.md](../canvas-budgets-runid-slug/feature.md), [../canvas-mutex/feature.md](../canvas-mutex/feature.md), [../canvas-refine/feature.md](../canvas-refine/feature.md), [../canvas-source-planner/feature.md](../canvas-source-planner/feature.md), [../canvas-source-fetcher/feature.md](../canvas-source-fetcher/feature.md), [../canvas-extractor/feature.md](../canvas-extractor/feature.md), [../canvas-reducer/feature.md](../canvas-reducer/feature.md), [../canvas-layouts/feature.md](../canvas-layouts/feature.md), [../canvas-diff/feature.md](../canvas-diff/feature.md), [../canvas-writer/feature.md](../canvas-writer/feature.md).
- Forward consumers: [../canvas-widget-live/feature.md](../canvas-widget-live/feature.md), [../delegate-canvas-create/feature.md](../delegate-canvas-create/feature.md), [../delegate-canvas-content-edit/feature.md](../delegate-canvas-content-edit/feature.md), [../delegate-canvas-layout-edit/feature.md](../delegate-canvas-layout-edit/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-40, FR-CANVAS-49..54; [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-01, 02, 05, 06.

## Implementation notes

- [../../../../architecture/architecture.md#10-concurrency--lifecycle-rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — outermost try/finally, signal threading.
- [../../../../architecture/architecture.md#5-data-flows](../../../../architecture/architecture.md#5-data-flows) — wiki/external-agent FSM driver pattern.
- [../../../../architecture/architecture.md#6-state-ownership](../../../../architecture/architecture.md#6-state-ownership) — in-memory only; reload discards (NFR-02).
- [../../../../standards/code-style.md#langgraph--agent-layer](../../../../standards/code-style.md#langgraph--agent-layer) — typed nodes, `AbortSignal` always threaded, `interrupt()` for confirmation pauses (used at PREVIEWING for Approve/Edit/Cancel).
- [../../../../standards/code-style.md#async--concurrency](../../../../standards/code-style.md#async--concurrency) — `AbortController` per request, no unhandled rejections.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — Framework First: hand-rolled FSM mirrors wiki ingest precedent (LangGraph would re-do same dataflow with more ceremony per SRS commentary).

## Open questions

- Should the driver use LangGraph `interrupt()` for the PREVIEWING approval pause, or a plain promise + clarifying-question controller mirror? Use LangGraph `interrupt()` to align with wiki ingest's duplicate-confirm pause for codebase consistency. Decision: interrupt-based.
- Cancel-mid-WRITING semantics — should we honor cancel after the rename starts? SRS-50 says no (complete in-flight rename + sidecar). Implement: ignore cancel between `commitPreview` and `writeSidecar`; honor cancel only on entry to WRITING.
