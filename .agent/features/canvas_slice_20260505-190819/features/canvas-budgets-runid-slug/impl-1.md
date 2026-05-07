# Impl iteration 1 — F04 canvas-budgets-runid-slug

## Summary
Added foundation modules under `src/agent/canvas/`: `budgets.ts` (`CANVAS_BUDGETS as const` + empty `CANVAS_NODE_SIZE_OVERRIDES`), `runIdRegistry.ts` (`generateCanvasRunId` mirroring `externalAgent/runId.ts`), `slug.ts` (`canvasPathToSidecarSlug` using `computeSha256Hex` with kebab leaf + 6-hex suffix; `parseSidecarSlug` inverse). Pure helpers, clock + tail injectable for testing. Added `tests/unit/canvas/budgetsRunIdSlug.test.ts` covering all five ACs.

## Files touched
- `src/agent/canvas/budgets.ts` — constants + node-size overrides map
- `src/agent/canvas/runIdRegistry.ts` — runId generator
- `src/agent/canvas/slug.ts` — sidecar slug derivation + parser
- `tests/unit/canvas/budgetsRunIdSlug.test.ts` — unit tests

## Tests added or updated
- `tests/unit/canvas/budgetsRunIdSlug.test.ts` covers AC1 (CANVAS_BUDGETS values), AC2 (deterministic runId), AC3 (slug shape), AC4 (collision), AC5 (normalization + path safety), plus `parseSidecarSlug` round-trip.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
None.

## Assumptions
- `kebabize` collapses any non-`[a-z0-9]` to `-` then trims; combined with NFKD normalize it strips combining marks (the SRS just says "normalized"). Empty leaf falls back to `canvas` prefix to keep slug well-formed.
- Slug is async because `computeSha256Hex` is async (Web Crypto). Downstream callers will already be in async paths (sidecar I/O).
- `CANVAS_NODE_SIZE_OVERRIDES` initialized empty; F13 (layout) will populate with per-type entries when needed.

## Open questions
None — `as const` chosen over `Object.freeze` per feature.md open question.
