# F06 · canvas-mutex — Per-canvas-path mutex

## Purpose

Provide `CanvasMutex` — a `Map<vaultPath, { runId, op }>` held in plugin-process memory that gates concurrent canvas runs against the same target path. Different canvas paths run in parallel. `acquire(path, runId, op)` returns `{ ok: true, release }` or `{ ok: false, busy: { activeRunId, activeOp } }`; `release` is always idempotent and must be called from the outermost `try/finally` of the subgraph driver. Mirrors `src/agent/wiki/mutex.ts`.

Covers [FR-CANVAS-46](../../context.md#functional-requirements), [FR-CANVAS-47](../../context.md#functional-requirements), [FR-CANVAS-48](../../context.md#functional-requirements), [NFR-CANVAS-05](../../context.md#non-functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/mutex.ts` exporting `CanvasMutex` class with `acquire`, `release`, `active(path)`, `activeAll() → readonly { path, runId, op }[]` (used by `/canvas-status`).
- Mutex result types: `AcquireOk = { ok: true; release: () => void }`, `AcquireBusy = { ok: false; busy: { activeRunId: string; activeOp: CanvasOp } }`.
- Idempotent `release` (calling twice is a no-op).

**Out of scope**

- FSM driver's outer `try/finally` placement — F16 owns the call site.
- Tool-side busy-result rendering — F19 / F20 / F21.

## Acceptance criteria

1. Two `acquire` calls for the same `vaultPath` overlap → second returns `{ ok: false, busy: { activeRunId, activeOp } }` — traces to FR-CANVAS-46, FR-CANVAS-47.
2. `acquire` for distinct `vaultPath`s is independent (both return `ok: true`) — traces to FR-CANVAS-46.
3. `release` removes the entry; subsequent `acquire` succeeds — traces to FR-CANVAS-48.
4. Calling `release` twice does not throw and does not delete an unrelated subsequently-acquired entry — traces to NFR-CANVAS-05.
5. `active(path)` returns the current `{ runId, op }` snapshot or `null`.
6. `activeAll()` returns a deterministically-ordered (path-alphabetical) snapshot list for `/canvas-status`.

## Dependencies

- [../canvas-budgets-runid-slug/feature.md](../canvas-budgets-runid-slug/feature.md) — `CanvasOp` literal union typed as `'create' | 'content_edit' | 'layout_edit'`.
- Forward consumers: [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md), [../delegate-canvas-create/feature.md](../delegate-canvas-create/feature.md), [../delegate-canvas-content-edit/feature.md](../delegate-canvas-content-edit/feature.md), [../delegate-canvas-layout-edit/feature.md](../delegate-canvas-layout-edit/feature.md), [../canvas-slash-commands/feature.md](../canvas-slash-commands/feature.md) (`/canvas-status`).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-46..48; [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-05.

## Implementation notes

- [../../../../architecture/architecture.md#10-concurrency--lifecycle-rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — mutex/release-in-finally rule.
- [../../../../architecture/architecture.md#6-state-ownership](../../../../architecture/architecture.md#6-state-ownership) — in-memory state ownership boundary.
- [../../../../standards/code-style.md#async--concurrency](../../../../standards/code-style.md#async--concurrency) — explicit FIFO / typed concurrency primitives, no ad-hoc Promise chains.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — Single Responsibility: mutex does only gating, never IO.

## Open questions

- Should the mutex emit a debug log on every acquire/release for telemetry, or only on contention? Log both — telemetry overhead is negligible vs. debugging value (NFR-CANVAS-03 already requires it).
