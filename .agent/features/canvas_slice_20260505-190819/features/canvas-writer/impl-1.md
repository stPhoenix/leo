# Impl iteration 1 — F15 canvas-writer

## Summary
Added `src/agent/canvas/writer.ts` exporting `writePreview`, `commitPreview`, `cleanupPreview`, `writeSidecarFromState`, `assertTargetDoesNotExist`, `previewPathFor`, `TargetExistsError` (`code: 'target_path_exists'`). `writePreview` does atomic `tmp + rename` to `<targetPath>.preview.canvas`. `commitPreview` renames preview → final target (also atomic; deletes any pre-existing target before rename). `cleanupPreview` is best-effort idempotent. Path validation runs at every entry point via `validateVaultRelativePath`.

## Files touched
- `src/agent/canvas/writer.ts` — writer module
- `tests/unit/canvas/writer.test.ts` — 9 unit tests

## Tests added or updated
- `tests/unit/canvas/writer.test.ts` covers AC1 (preview round-trip), AC2 (commit replaces target), AC3 (commit failure with missing preview), AC4 (cleanup idempotent), AC5 (`assertTargetDoesNotExist` Err), AC6 (sidecar persist guard via separate flow), AC7 (path rejection).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- AC8 (cancel mid-WRITING uninterruptible) is the FSM driver's responsibility (F16); the writer's contract is "commit + sidecar are sequential, no `await` between rename and sidecar write inside the writer module" — but wireup is owned by F16. Tests for AC8 belong with the subgraph.
- `commitPreview` does NOT auto-retry on rename failure. The feature.md open-question proposed a single retry with backoff; deferred to F16 driver (which can call `commitPreview` again with the same preview path).

## Assumptions
- Atomic rename semantics on Obsidian's `DataAdapter.rename` — same precedent used by `vectorStore.ts` and wiki ingest.
- Sidecar write is independently atomic (F07's tmp+rename); writer chains them sequentially.

## Open questions
- Retry on transient rename failure — deferred to F16 (per Deviation note).
