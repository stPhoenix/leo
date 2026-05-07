# Impl iteration 1 — F05 canvas-logging-namespaces

## Summary
Added `src/agent/canvas/loggingNamespaces.ts` exporting the `CANVAS_LOG as const` namespace tree (four roots: `create`/`contentEdit`/`layoutEdit` share the standard phase event schema; `reveal` carries `probe`/`invoke`/`openCanvas`/`unknownNodeIds`/`error` per feature.md open-question resolution) plus `CANVAS_SENSITIVE_FIELD_KEYS = ['rawSource','extractorOutput','reducerOutput','refineMessages','sidecarBody']`. Mirrors `WIKI_LOG` shape (transition/cancelled/refine/plan/fetch/extract/reduce/diff/layout/preview/write/mutex/cancel/error). Added unit tests + snapshot for surface stability.

## Files touched
- `src/agent/canvas/loggingNamespaces.ts` — new namespace tree + sensitive-field set
- `tests/unit/canvas/loggingNamespaces.test.ts` — unit + snapshot tests
- `tests/unit/canvas/__snapshots__/loggingNamespaces.test.ts.snap` — generated snapshot

## Tests added or updated
- `tests/unit/canvas/loggingNamespaces.test.ts` covers AC1 (four roots + every event), AC2 (typeof readonly via `as const`), AC3 (sensitive-field array), AC4 (snapshot).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
None — `reveal.probe.{ok,fail}` and `reveal.invoke.{ok,fail}` separation per feature.md open-question resolution.

## Assumptions
- ESLint policy declaration (mentioned in scope) is not a separate file; the module's existence + per-namespace string is the canonical reference. The `WIKI_SENSITIVE_FIELD_KEYS` precedent is the same pattern.
- Existing `canvas.reveal.openCanvas.*` and `canvas.reveal.unknownNodeIds` log calls already added in F02/F03 are now declared in the tree for consistency.

## Open questions
None.
