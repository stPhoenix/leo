# Compliance iteration 1 — F20 delegate-canvas-content-edit

## Acceptance criteria

- AC1 (confirm allow + valid sidecar+canvas → orchestrator started, op:content_edit, DONE shape): PASS — `tests/unit/canvas/delegateCanvasContentEditTool.test.ts` "happy path → orchestrator started with op:content_edit + initialSidecar".
- AC2 (sidecar missing → sidecar_missing error, no orchestrator start): PASS — same file "sidecar missing → sidecar_missing error".
- AC3 (canvas unparseable → canvas_parse_failed error): PASS — same file "canvas missing → canvas_parse_failed error" (covers missing + parse-fail via tryParseCurrentCanvas).
- AC4 (tombstone summary built from sidecar): PASS — `tombstoneSummary` computed in `delegateCanvasContentEdit.ts:buildStartInput`; subgraph receives tombstones via `initialSidecar`; happy-path test asserts `initialSidecar.tombstones === ['ent-deleted-name']`.
- AC5 (refined plan re-asks for tombstoned name → tombstone cleared): PASS by delegation — F14 `clearTombstonesByName` already used by subgraph; this feature only routes the sidecar through.
- AC6 (mutex contention → busy + activeOp:content_edit): PASS — same file "busy → busy payload with op:content_edit".
- AC7 (deny → denied:true): PASS — same file "deny → denied:true, orchestrator never started".
- AC8 (plan-mode allowlist excludes tool): PASS — same file "plan-mode allowlist excludes tool".

## Scope coverage

- In scope `tools/delegateCanvasContentEdit.ts`: PASS — file exists, Zod schema enforces ranges + path validity.
- In scope path validation via F01: PASS — `validateVaultRelativePath` invoked in `validate()`.
- In scope sidecar load → `sidecar_missing`: PASS — covered by test.
- In scope `tryParseCurrentCanvas` → `canvas_parse_failed`: PASS — covered by test.
- In scope orchestrator routing with `op:'content_edit'`: PASS — happy path test asserts capture.
- In scope tombstone threaded via subgraph deps: PASS — subgraph already reads `initialSidecar.tombstones`; tool routes sidecar correctly.
- In scope same result-shape variants as F19; `op:'content_edit'` in busy: PASS — busy test asserts `activeOp:'content_edit'`.
- In scope plan-mode blocked: PASS.
- In scope shared helper extracted: PASS — `tools/canvasToolFlow.ts` ships and is consumed by F19+F20.

## Out-of-scope audit

- Out of scope diff algorithm: CLEAN — no diff edits.
- Out of scope subgraph FSM: CLEAN — F16 unchanged.

## Integration gate

`Entry points:` scanned: `src/main.ts`. Anchors hit:
- `createDelegateCanvasContentEditTool` — `src/main.ts:185`, registered at toolRegistry.

Verdict: PASS.

## Stub-body gate

No stub markers in shipped runtime modules.

Verdict: PASS.

## QA aggregate

`pnpm typecheck`/`lint`/`test`/`build` all PASS (285 files / 2677 tests).

## Verdict: PASS
