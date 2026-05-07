# Impl iteration 1 — F19 delegate-canvas-create

## Summary

`delegate_canvas_create` tool ships with `requiresConfirmation: true`. Confirm-deny → `{ ok: true, data: { ok: false, denied: true } }`; confirm-allow → `CanvasOrchestrator.start({ op: 'create', … })` → on busy `{ ok: false, error: 'busy', activeRunId, activeOp }`, on success awaits terminal and shapes via `buildCanvasToolResult`. Plan-mode allowlist already excludes by construction (write tool, no entry in `DEFAULT_PLAN_MODE_ALLOWLIST`). Wired in `main.ts` with onHandle that mounts `CanvasWidgetController`, registers it, appends a live widget block, and binds `resolvePreviewing` actions to `CanvasPreviewingDispatcher`.

## Files

- `src/agent/canvas/runPhase.ts` — `CanvasToolResult` discriminated union + `buildCanvasToolResult(terminal)` + `buildBusyToolResult({activeRunId,activeOp})` + `buildDeniedToolResult()`.
- `src/agent/canvas/orchestrator.ts` — `CanvasOrchestrator` class with `liveHandles` map, `findHandle/liveHandlesSnapshot`, `start(input)` wrapping `startCanvasRun`, `persistSnapshot` callback wiring (terminal-snapshot builder).
- `src/agent/canvas/previewingDispatcher.ts` — `CanvasPreviewingDispatcher` (impl `PreviewingDecisionAdapter`); maps runId → pending resolver; `resolve(runId, action)` fulfills, `clear()` cancels all.
- `src/agent/canvas/tools/delegateCanvasCreate.ts` — Zod input `{ ask (1..16384), targetPath?, layoutAlgo? }`; validate-time `validateVaultRelativePath` rejection of bad targetPath; confirmation request with `actionLabels: { allow: 'Prepare canvas create', deny: 'Deny' }`; abort-listener cancels handle; result wrapped in `{ ok: true, data: <CanvasToolResult> }` (precedent: delegateExternal).
- `src/main.ts` — fields `canvasMutex`, `canvasPreviewingDispatcher`, `canvasOrchestrator`; constructed in onload after canvasNavigator; orchestrator deps wired with `providerManager` as Provider for refine/extract/reduce; tool registered on `toolRegistry`; live block + terminal block side-effect imports.
- `tests/unit/canvas/runPhase.test.ts` — 5 tests: DONE/CANCELLED/ERROR shaping, busy-shape, denied-shape.
- `tests/unit/canvas/orchestrator.test.ts` — 3 tests: liveHandles add/remove around handle.terminal, busy passthrough, persistSnapshot called.
- `tests/unit/canvas/previewingDispatcher.test.ts` — 4 tests: resolve, unknown-runId returns false, hasPending tracking, clear cancels all.
- `tests/unit/canvas/delegateCanvasCreateTool.test.ts` — 7 tests: id+requiresConfirmation, plan-mode exclusion, validate rejects traversal + non-canvas extension, deny→denied no-start, busy→busy payload, done→ok+insights.

## Decisions

- **Wrapper at outer ToolResult level**: `{ ok: true, data: <CanvasToolResult> }` even when payload is `ok: false` — mirrors delegateExternal precedent so structured payload survives the LLM serializer.
- **Tool returns `ok: true` on user deny** — denial is a valid completion of the call, not an internal error.
- **Mutex acquired by subgraph at start** (per F16); orchestrator pass-through. Open question in feature.md about acquiring after refine is satisfied by F16's behaviour: target path is resolved before subgraph dispatches phases, and mutex is keyed by target path; concurrent calls without explicit targetPath that resolve to different slug paths run in parallel.
- **`ConstructorParameters<…>` cast removed**: orchestrator subgraph deps satisfied directly; metadataCache is optional, omitted at startup (graph cache adapter wiring belongs to a later slice).

## Test coverage

19 new tests (4 modules); main.ts wiring covered by integration gate (entry-point reference scan).

## QA local

Typecheck/lint/test/build all green (284 files / 2669 tests; +4 files +19 tests vs F18).
