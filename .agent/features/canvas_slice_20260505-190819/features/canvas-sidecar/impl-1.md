# Impl iteration 1 — F07 canvas-sidecar

## Summary
Added `src/agent/canvas/schemas.ts` (shared Zod schemas — `EntityTypeDef`, `RelationTypeDef`, `Entity`, `Edge`, `EntityGraph`, `Insights`, `SourceHint`, `RunPlan`, `Coord`, `EdgeTombstone`, `SidecarV1`, `PresetIdSchema`, `LayoutHintSchema`, `PRESET_IDS`). Added `src/agent/canvas/sidecar.ts` exporting `sidecarPathFor`, `readSidecar`, `writeSidecar`, and `SidecarCorruptError`. Read returns `null` for missing-file or `schemaVersion ≠ 1` (logs `canvas.sidecar.versionMismatch` at warn) and `Err(sidecar_corrupt)` for malformed JSON or schema-invalid bodies. Write goes through `tmp + rename`; failure during rename cleans the tmp file and surfaces an error. Path always derived via `canvasPathToSidecarSlug`.

## Files touched
- `src/agent/canvas/schemas.ts` — shared Zod schemas + types (used by F07 and forward by F08/F11/F12/F13/F14/F15)
- `src/agent/canvas/sidecar.ts` — read/write store + corrupt-error class
- `tests/unit/canvas/sidecar.test.ts` — 7 unit tests

## Tests added or updated
- `tests/unit/canvas/sidecar.test.ts` covers AC1 (round-trip), AC2 (version mismatch logs warn + null), AC3 (missing returns null), AC4 (corrupt JSON + invalid schema → Err), AC5 (path normalizes to `.leo/canvas/runs/<slug>.json`), AC6 (atomic rename: rename failure leaves no partial sidecar, tmp cleaned). AC7 covered transitively via F04 collision test.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Defined the cluster of forward-looking schemas in `schemas.ts` rather than scoping strictly to `SidecarV1`. Feature.md says "EntityGraph schema — F12 owns it; sidecar imports", and per CLAUDE.md best-practices "Framework First / DRY", colocating shared Zod schemas in one file lets F08/F11/F12/F13/F14/F15 import from a single source of truth instead of duplicating. F12 will populate `Insights`/`EntityGraph` algorithm code; the schema definitions are the contract, not the algorithm.

## Assumptions
- `mkdir` of `.leo/canvas/runs` is idempotent on `VaultAdapter` (matches the InMemoryVaultAdapter contract; the Obsidian adapter is no-op on existing folder).
- Sidecar `lastRunAt` round-trips as the same ISO string (no re-quantization needed since we don't `new Date(...)` it).

## Open questions
None — debounce + GC explicitly deferred per feature.md.
