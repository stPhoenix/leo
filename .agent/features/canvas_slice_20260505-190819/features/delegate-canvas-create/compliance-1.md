# Compliance iteration 1 — F19 delegate-canvas-create

## Acceptance criteria

- AC1 (confirm allow → orchestrator started, ok:true on DONE): PASS — `tests/unit/canvas/delegateCanvasCreateTool.test.ts:114` "done → ok:true payload with insights".
- AC2 (deny → denied:true, orchestrator never started): PASS — `tests/unit/canvas/delegateCanvasCreateTool.test.ts:69` "deny → ok:true wrapper, denied:true payload, orchestrator never started".
- AC3 (mutex contention → busy + activeRunId/activeOp): PASS — `tests/unit/canvas/delegateCanvasCreateTool.test.ts:88` "busy → busy payload with activeRunId/activeOp".
- AC4 (invalid targetPath → Zod parse failure pre-confirmation): PASS — `tests/unit/canvas/delegateCanvasCreateTool.test.ts:50` "rejects invalid targetPath at validate boundary" + line 60 "rejects targetPath without .canvas extension".
- AC5 (DONE includes insights:{hubs,components,orphans,perTypeCount}): PASS — `tests/unit/canvas/runPhase.test.ts:13` "shapes DONE outcome with insights" + delegate test asserting `insights.components.count`.
- AC6 (registered with requiresConfirmation:true; registry-test-style): PASS — `tests/unit/canvas/delegateCanvasCreateTool.test.ts:39` "id and requiresConfirmation registered correctly".
- AC7 (plan-mode allowlist excludes delegate_canvas_create): PASS — `tests/unit/canvas/delegateCanvasCreateTool.test.ts:46` "plan-mode allowlist excludes delegate_canvas_create".

## Scope coverage

- In scope `tools/delegateCanvasCreate.ts`: PASS — file exists; Zod schema enforces ask range + optional targetPath/layoutAlgo.
- In scope `requiresConfirmation: true` via confirmationController: PASS — `actionLabels: { allow: 'Prepare canvas create', deny: 'Deny' }`.
- In scope plan-mode write-blocked: PASS — not in `DEFAULT_PLAN_MODE_ALLOWLIST`.
- In scope result shaper for DONE/CANCELLED/busy/ERROR: PASS — `runPhase.ts` covers all four; `runPhase.test.ts` proves DONE/CANCELLED/ERROR; delegate tool test proves busy + denied.
- In scope `{ ok: true, data: <CanvasToolResult> }` wrapper: PASS — every return path goes through the same wrapper.

## Out-of-scope audit

- Out of scope subgraph FSM: CLEAN — no FSM code in this feature's impl.
- Out of scope widget rendering: CLEAN — widget renderer + controller live in F17 modules; this feature only mounts existing controller.
- Out of scope content-edit / layout-edit tools: CLEAN — no `delegateCanvasContentEdit` / `delegateCanvasLayoutEdit` files added here.

## Integration gate

`Entry points:` scanned: `src/main.ts`. Anchors hit:
- `createDelegateCanvasCreateTool` — referenced at `src/main.ts:184`, `src/main.ts:933`.
- `CanvasOrchestrator` — `src/main.ts:172`, instantiated at line ~876.
- `CanvasMutex` — `src/main.ts:172`.
- `CanvasPreviewingDispatcher` — `src/main.ts:172`, instantiated.
- `CanvasWidgetController` — `src/main.ts:181`.

Verdict: PASS — every shipped runtime module has a live reference from `main.ts`.

## Stub-body gate

No stub markers detected in shipped runtime modules. Tool body invokes orchestrator and confirmation; orchestrator wraps `startCanvasRun` (F16); previewing dispatcher uses real Promise machinery; result shaper uses real branches.

Verdict: PASS.

## QA aggregate

`pnpm typecheck`/`lint`/`test`/`build` all PASS (284 files / 2669 tests).

## Verdict: PASS
