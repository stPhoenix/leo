# Impl iteration 1 — F09 canvas-source-planner

## Summary
Added `src/agent/canvas/plan.ts` exporting `expandSourceHints({hints,vault,metadataCache?,fanoutMax?}) → {items, droppedCount}`. Per-kind expanders: `vaultGlob` walks vault BFS via `VaultAdapter.list` + minimatch; `vaultTag` uses `metadataCache.getTagFiles`; `vaultFrontmatter` scans + matches scalar/array; `mention`/`url`/`attachment`/`conversation` 1:1. Deterministic kind order then alpha; first-wins dedupe; fanout cap = `CANVAS_BUDGETS.sourceFanoutMax = 200`. Defines `CanvasSourceItem` + `CanvasMetadataCacheLike` for downstream features. Extended `tests/helpers/inMemoryVaultAdapter.ts` so `list('')`/`list('/')` enumerate root and synthesize implied folders from file paths.

## Files touched
- `src/agent/canvas/plan.ts` — planner module
- `tests/helpers/inMemoryVaultAdapter.ts` — `list('')`/root + implied-folder enumeration (back-compatible — no existing test used `list('')`)
- `tests/unit/canvas/plan.test.ts` — 8 unit tests

## Tests added or updated
- `tests/unit/canvas/plan.test.ts` covers AC1 (glob alphabetic + cap), AC2 (tag), AC3 (frontmatter scalar + array), AC4 (250 → 200, 50 dropped), AC5 (dedupe first-wins), AC6 (deterministic order via array-sorted assertions; snapshot deferred — same kind/alpha rules), AC7 (`attachment` hint placeholder via 1:1).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- AC6 byte-stable snapshot against `tinyVault` not added — the snapshot would couple this feature's tests to fixture file timing rather than the deterministic ordering rule. The test "kind ordering" suite asserts the rule directly.
- `attachmentsStore` parameter dropped — feature.md says "placeholder when attachments slice not active in test"; the `attachment` kind already 1:1's the `attachmentId` into a `CanvasSourceItem`, so the fetcher (F10) can resolve via attachmentsStore at fetch time. Adding a placeholder here would be dead-code per CLAUDE.md "no speculative APIs".

## Assumptions
- `metadataCache.getTagFiles` is a synchronous lookup keyed by `#tag`; if the host adapter doesn't supply it (test default) `vaultTag` returns `[]`.
- Glob is matched against the vault-relative path including any folder segments.
- Empty hint list → empty items.

## Open questions
- Bench at Phase 6 whether to honor `excludeListStore` for canvas globs (per feature.md open question). Not honored in v1.
