# F04 · canvas-budgets-runid-slug — Budgets / run-id / slug constants

## Purpose

Centralize all numeric constants (token caps, layout drift threshold, fan-out cap, edit-iteration cap, free-space padding) plus pure helpers (`generateCanvasRunId()`, sidecar slug derivation) so every downstream feature consumes a single source of truth and no magic numbers leak into algorithm modules. Mirrors `src/agent/wiki/budgets.ts` and `src/agent/externalAgent/runId.ts`.

Covers [FR-CANVAS-42](../../context.md#functional-requirements) (slug derivation), [NFR-CANVAS-10](../../context.md#non-functional-requirements) (budget surface).

## Scope

**In scope**

- `src/agent/canvas/budgets.ts` exporting `CANVAS_BUDGETS` const object: `extractorInputCap = 8000`, `extractorOutputCap = 1500`, `reducerInputCap = 6000`, `reducerOutputCap = 2500`, `refineInputCap = 4000`, `refineOutputCap = 1500`, `MOVE_DRIFT_PX = 16`, `freeSpacePadPx = 80`, `bboxPadding = 80`, `sourceFanoutMax = 200`, `extractorConcurrency = 1`, `refineClarifyMax = 3`, `editIterationsMax = 3`, plus per-entity-type node-size override map (initially empty).
- `src/agent/canvas/runIdRegistry.ts` exporting `generateCanvasRunId({ now?, tail? }) → string` (`YYYYMMDD-HHmmss-<6 hex>`).
- `src/agent/canvas/slug.ts` exporting `canvasPathToSidecarSlug(vaultPath: string) → string` (kebab-cased leaf + 6-hex SHA-256 of full path) and the inverse `parseSidecarSlug` for diagnostics.
- Pure functions only — no IO, no clock leakage (clock injected for tests).

**Out of scope**

- Mutex bookkeeping — F06.
- Sidecar persistence — F07.
- Settings UI — out of v1 scope (see SRS §10).

## Acceptance criteria

1. `CANVAS_BUDGETS` is a `readonly` `as const` object (no `enum`); spot-check `MOVE_DRIFT_PX === 16` and all other values from SRS §NFR-CANVAS-10 — traces to NFR-CANVAS-10.
2. `generateCanvasRunId({ now: fixedDate, tail: 'abcdef' })` produces a deterministic `YYYYMMDD-HHmmss-abcdef` — verified by unit test — traces to FR-CANVAS-42 (run-id is the sidecar's `runId` field).
3. `canvasPathToSidecarSlug('canvases/conf-2026-q1.canvas') === 'conf-2026-q1-<6hex>'` and the suffix is stable across runs (sha-256 of canonical input) — traces to FR-CANVAS-42.
4. Two distinct paths sharing a leaf name (`a/notes.canvas`, `b/notes.canvas`) produce different slugs — collision test — traces to FR-CANVAS-42.
5. Slug input that contains illegal kebab characters (spaces, unicode) is normalized; slug never contains `/` or `..` — traces to NFR-CANVAS-12 (path safety).

## Dependencies

- None (foundation).
- Forward consumers: F05–F23.
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-42; [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-10.

## Implementation notes

- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — pure-domain module placement under `src/agent/canvas/`.
- [../../../../architecture/architecture.md#10-concurrency--lifecycle-rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — clock injection rule for testability.
- [../../../../standards/code-style.md#typescript](../../../../standards/code-style.md#typescript) — `as const` literal unions instead of enums; `readonly` on public fields.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — KISS: hand-rolled SHA-256 not needed (Web Crypto already used in vector store).

## Open questions

- Should `CANVAS_BUDGETS` be wrapped in a frozen `Object.freeze` to prevent runtime mutation, or rely on `as const` type-level? `as const` only — freezing has no runtime benefit if inputs come from same module.
