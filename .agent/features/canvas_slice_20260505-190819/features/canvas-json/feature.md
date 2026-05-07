# F01 · canvas-json — Canvas JSON schema + path safety

## Purpose

Provide the Zod schema for the Obsidian `.canvas` JSON subset Leo emits (`text` and `file` nodes; edges with optional `fromSide`/`toSide`/`label`/`color`) plus parse/serialize round-trip helpers and vault-path traversal-safe validators used by every downstream feature that touches `.canvas` files or `.leo/canvas/runs/` paths.

Covers [FR-CANVAS-25](../../context.md#functional-requirements) (parse helpers), [FR-CANVAS-41](../../context.md#functional-requirements) (write shape contract), [FR-CANVAS-43](../../context.md#functional-requirements) (target-exists helper), [NFR-CANVAS-12](../../context.md#non-functional-requirements) (path validation surface).

## Scope

**In scope**

- `CanvasNode` discriminated union (`text` / `file`), `CanvasEdge`, top-level `CanvasJson` Zod schemas — exactly the subset in SRS §8.5.
- `parseCanvasJson(raw: string) → Result<CanvasJson>` and `serializeCanvasJson(value) → string` (stable key order for diffability).
- `targetCanvasPathExists(adapter, path) → boolean` helper used by writer's `target_path_exists` guard.
- `validateVaultRelativePath(path) → Result` — rejects `..`, absolute, empty, non-`.canvas` extension; reused by writer + tools for input validation.
- `validateSidecarRelativePath(path) → Result` — confines to `.leo/canvas/runs/` prefix.

**Out of scope**

- Persistence — owned by F07 (sidecar) and F15 (writer).
- Layout-driven node generation — F13.
- `link` / `group` canvas node types — explicitly excluded from v1 per SRS §1.3.

## Acceptance criteria

1. `CanvasJson` parses each fixture in `tests/unit/canvas/fixtures/*.canvas` (round-trip equal after `parse → serialize`) — traces to FR-CANVAS-41.
2. Malformed inputs (missing `type`, unknown `type`, non-numeric coords, missing required fields) reject with a Zod issue array — traces to FR-CANVAS-25.
3. `targetCanvasPathExists` returns `false` for missing files, `true` for existing — traces to FR-CANVAS-43.
4. `validateVaultRelativePath` rejects `..`, leading `/`, empty string, `.md`/non-`.canvas` extensions — traces to NFR-CANVAS-12.
5. `validateSidecarRelativePath` rejects any path that does not start with `.leo/canvas/runs/` — traces to NFR-CANVAS-12.
6. Serialize emits keys in a stable (alphabetical) order — verified by snapshot — supports diffability for sidecar-driven re-runs (FR-CANVAS-22 needs predictable JSON).

## Dependencies

- None (foundation).
- Forward consumers: [../canvas-sidecar/feature.md](../canvas-sidecar/feature.md), [../canvas-writer/feature.md](../canvas-writer/feature.md), [../canvas-diff/feature.md](../canvas-diff/feature.md), [../canvas-layouts/feature.md](../canvas-layouts/feature.md), [../canvas-navigator/feature.md](../canvas-navigator/feature.md), [../reveal-in-canvas-tool/feature.md](../reveal-in-canvas-tool/feature.md), [../delegate-canvas-create/feature.md](../delegate-canvas-create/feature.md), [../delegate-canvas-content-edit/feature.md](../delegate-canvas-content-edit/feature.md), [../delegate-canvas-layout-edit/feature.md](../delegate-canvas-layout-edit/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-25, FR-CANVAS-41, FR-CANVAS-43; [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-12.

## Implementation notes

- [../../../../architecture/architecture.md#4-key-contracts](../../../../architecture/architecture.md#4-key-contracts) — `Result<T, E>` discriminated-union convention applies to parse helpers.
- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — module placement rule (canvas pure-domain code lives under `src/agent/canvas/`).
- [../../../../standards/code-style.md#zod--tool-schemas](../../../../standards/code-style.md#zod--tool-schemas) — Zod conventions: single source schema, `z.infer` for TS type, `.describe()` on user-facing fields.
- [../../../../standards/tech-stack.md#storage-layout](../../../../standards/tech-stack.md#storage-layout) — `.leo/` storage layout rule that constrains sidecar path validator.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — Fail-fast: parse rejects at the boundary, no permissive fallback.

## Open questions

- Should parse tolerate forward-compat additions (unknown node types) by passthrough or strict-reject? Strict-reject for v1 (writer only emits known types); revisit if Obsidian adds canvas node types.
