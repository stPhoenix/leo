# F07 · canvas-sidecar — Sidecar read/write store

## Purpose

Read and write `SidecarV1` JSON memos at `.leo/canvas/runs/<slug>.json`. The sidecar holds the last successful run's `schema`, `entityGraph`, `coordMap`, `tombstones`, `edgeTombstones`, `runId`, `lastRunAt`. Drives diff merge on subsequent runs. Internal-only — no user contract; `schemaVersion` mismatches degrade to "missing", forcing a fresh `delegate_canvas_create`.

Covers [FR-CANVAS-41](../../context.md#functional-requirements) (sidecar shape), [FR-CANVAS-42](../../context.md#functional-requirements), [NFR-CANVAS-11](../../context.md#non-functional-requirements), [NFR-CANVAS-12](../../context.md#non-functional-requirements) (sidecar path confinement).

## Scope

**In scope**

- `src/agent/canvas/sidecar.ts` exporting `readSidecar(adapter, canvasVaultPath) → Result<SidecarV1 | null>` and `writeSidecar(adapter, canvasVaultPath, sidecar) → Result<void>`.
- `SidecarV1` Zod schema matching SRS §6 shape (`schemaVersion: 1`, `runId`, `schema { entityTypes, relationTypes }`, `entityGraph`, `coordMap`, `tombstones`, `edgeTombstones`, `lastRunAt`).
- Path confinement: write target is always `.leo/canvas/runs/<slug>.json` derived via [F04](../canvas-budgets-runid-slug/feature.md) slug helper; reject any caller-supplied raw path.
- `schemaVersion` mismatch → return `null` (treat as missing) and log at `warn` per NFR-CANVAS-11.
- Atomic write: `tmp + rename` via `VaultAdapter` (mirrors `vectorStore.ts`).

**Out of scope**

- `EntityGraph` schema — F12 owns it; sidecar imports.
- Coord-map diff logic — F14.
- Sidecar deletion / GC — out of v1.

## Acceptance criteria

1. Round-trip: write a `SidecarV1` then read returns equal value (excluding `lastRunAt` re-quantization) — traces to FR-CANVAS-41.
2. Reading a file with `schemaVersion: 2` returns `null` and emits a `warn`-level log under `canvas.*.sidecar.versionMismatch` — traces to NFR-CANVAS-11.
3. Reading a missing file returns `null` (not an error) — traces to FR-CANVAS-26 (refine context can be empty).
4. Reading a corrupt JSON returns `Err` with code `sidecar_corrupt`, not `null` — distinguishes corruption from absence.
5. Write-target path always normalizes to `.leo/canvas/runs/<slug>.json`; supplying `..` in canvas path throws via slug helper before write — traces to NFR-CANVAS-12.
6. Atomic write uses `tmp + rename`; failure during rename leaves no partial sidecar (verified with InMemoryVaultAdapter override).
7. Slug derivation from canvas path is collision-resistant (test covers two paths with shared leaf — see F04 acceptance).

## Dependencies

- [../canvas-json/feature.md](../canvas-json/feature.md) — path validators (sidecar prefix).
- [../canvas-budgets-runid-slug/feature.md](../canvas-budgets-runid-slug/feature.md) — slug derivation.
- Forward consumers: [../canvas-diff/feature.md](../canvas-diff/feature.md), [../canvas-writer/feature.md](../canvas-writer/feature.md), [../delegate-canvas-content-edit/feature.md](../delegate-canvas-content-edit/feature.md), [../delegate-canvas-layout-edit/feature.md](../delegate-canvas-layout-edit/feature.md), [../canvas-slash-commands/feature.md](../canvas-slash-commands/feature.md) (`/canvas-status` enumerates sidecars).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-41, FR-CANVAS-42; [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-11, NFR-CANVAS-12.

## Implementation notes

- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — storage modules go through `VaultAdapter`, never `app.vault.adapter` directly.
- [../../../../architecture/architecture.md#7-error-handling-strategy](../../../../architecture/architecture.md#7-error-handling-strategy) — typed `Result` shape; no thrown errors out of adapter.
- [../../../../standards/code-style.md#zod--tool-schemas](../../../../standards/code-style.md#zod--tool-schemas) — `schema.parse` at boundary; `schemaVersion` literal.
- [../../../../standards/code-style.md#error-handling](../../../../standards/code-style.md#error-handling) — release resources in `finally`, `Result` at boundaries.
- [../../../../standards/tech-stack.md#storage-layout](../../../../standards/tech-stack.md#storage-layout) — `.leo/` storage layout convention.

## Open questions

- Should sidecar writes be debounced when consecutive runs against the same path are rapid? No — sidecar writes are one-per-run terminal-state writes; debouncing would risk losing the latest coord map.
- Should we GC sidecars when the canvas file is deleted? Defer to v2 (open question — would need a vault-event hook, not in v1 scope).
