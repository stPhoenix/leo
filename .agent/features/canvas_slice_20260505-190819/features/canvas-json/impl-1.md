# Impl iteration 1 — F01 canvas-json

## Summary
Added `src/agent/canvas/canvasJson.ts` with the Zod schemas (`CanvasNode` discriminated union over `text`/`file`, `CanvasEdge`, `CanvasJson`), `parseCanvasJson` / `serializeCanvasJson` (canonical alphabetical key order), `targetCanvasPathExists`, `validateVaultRelativePath`, and `validateSidecarRelativePath` per SRS §8.5 and FR-CANVAS-25/41/43, NFR-CANVAS-12. Added unit-test fixtures and `tests/unit/canvas/canvasJson.test.ts` covering round-trip, malformed-rejection, path-validators, and key-order snapshot.

## Files touched
- `src/agent/canvas/canvasJson.ts` — Zod schemas + parse/serialize + path validators
- `tests/unit/canvas/fixtures/empty.canvas` — empty canvas fixture
- `tests/unit/canvas/fixtures/text-node.canvas` — single text node fixture
- `tests/unit/canvas/fixtures/file-node-with-edge.canvas` — file nodes + edge with sides + label fixture
- `tests/unit/canvas/fixtures/colored-text.canvas` — text node with color fixture
- `tests/unit/canvas/canvasJson.test.ts` — unit tests for AC1–AC6

## Tests added or updated
- `tests/unit/canvas/canvasJson.test.ts` — covers AC1 (round-trip per fixture), AC2 (malformed reject), AC3 (`targetCanvasPathExists`), AC4 (`validateVaultRelativePath`), AC5 (`validateSidecarRelativePath`), AC6 (stable key order via snapshot + key-order check).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
None.

## Assumptions
- `Result<T>` shape mirrors `src/storage/vectorStore.ts` convention (`{ok:true,value} | {ok:false,error:Error}`); no shared `Result` module exists in `src/`, so the type is re-declared locally — downstream features (F07 sidecar, F15 writer) can import it from this module.
- "non-`.canvas` extension" rejection in `validateVaultRelativePath` is interpreted as strict — empty extension and any other suffix both rejected.
- Sidecar path validator rejects non-`.json` extensions and any path outside `.leo/canvas/runs/` prefix (including parent-traversal segments).

## Open questions
None.
