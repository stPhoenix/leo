# Compliance iteration 1 — F01 canvas-json

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/canvasJson.test.ts` "fixtures round-trip" suite (4 fixtures) round-trips parse → serialize → parse, asserting deep equality.
- AC2: PASS — `tests/unit/canvas/canvasJson.test.ts` "rejects malformed" suite covers non-JSON, missing `type`, unknown `type`, non-numeric coords, file node missing `file`.
- AC3: PASS — `tests/unit/canvas/canvasJson.test.ts` "targetCanvasPathExists" suite covers missing + existing.
- AC4: PASS — `tests/unit/canvas/canvasJson.test.ts` "validateVaultRelativePath" suite covers `..`, leading `/`, empty, `.md`, no-ext, backslash.
- AC5: PASS — `tests/unit/canvas/canvasJson.test.ts` "validateSidecarRelativePath" suite covers prefix, traversal, non-json, empty, absolute.
- AC6: PASS — `tests/unit/canvas/canvasJson.test.ts` "serializeCanvasJson — stable key order" snapshot + explicit `Object.keys` alphabetic check at top level + within node object.

## Scope coverage
- In scope "`CanvasNode` discriminated union (`text` / `file`), `CanvasEdge`, top-level `CanvasJson` Zod schemas — exactly the subset in SRS §8.5": PASS — `src/agent/canvas/canvasJson.ts:21-50`.
- In scope "`parseCanvasJson(raw: string) → Result<CanvasJson>` and `serializeCanvasJson(value) → string` (stable key order for diffability)": PASS — `src/agent/canvas/canvasJson.ts:53-72`.
- In scope "`targetCanvasPathExists(adapter, path) → boolean`": PASS — `src/agent/canvas/canvasJson.ts:74-79`.
- In scope "`validateVaultRelativePath(path) → Result`": PASS — `src/agent/canvas/canvasJson.ts:84-103`.
- In scope "`validateSidecarRelativePath(path) → Result`": PASS — `src/agent/canvas/canvasJson.ts:105-124`.

## Out-of-scope audit
- Out of scope "Persistence — owned by F07": CLEAN — no FS writes beyond `targetCanvasPathExists` (read-only stat).
- Out of scope "Layout-driven node generation — F13": CLEAN — no layout code.
- Out of scope "`link` / `group` canvas node types": CLEAN — discriminated union only contains `text` and `file`.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
Module `src/agent/canvas/canvasJson.ts` is not yet referenced from `src/main.ts` — no wiring bullet in `### In scope` for F01 (foundation feature; consumers F03/F07/F15/F19–F21 will import it). Confirmed intentional per dependency graph in `features-index.md` and feature.md `## Dependencies`.

## Verdict: PASS
