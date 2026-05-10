# Impl iteration 1 — F04 openfang-artifacts

## Summary
Pure artifact-walker + sequential downloader. `selectFileRefs` flattens `task.artifacts[].parts[]` to `fileRef`-only entries; `dedupeRelPaths` resolves colliding names with first-6-chars `artifactId` suffix; `downloadArtifacts` async-iterable yields `ExternalEvent.file` per success, swallows 404 with warn log, propagates other errors, honors abort, sequential-only.

## Files touched
- `src/agent/externalAgent/adapters/openfang/artifacts.ts` — new module: `selectFileRefs`, `dedupeRelPaths`, `downloadArtifacts`, helpers.
- `tests/unit/externalAgent/adapters/openfang/artifacts.test.ts` — 15 vitest cases.

## Tests added or updated
- AC1 (only fileRef, in order, defaults to []): "selectFileRefs" 3 cases.
- AC2 (dedupe across collisions; pass-through unique): "dedupeRelPaths" 4 cases (extension, extensionless, three-collision uniqueness, unique pass-through).
- AC3 (one file event per success, relPath/content/mime): "happy", "content is always Uint8Array".
- AC4 (404 → continue + warn): "404 on one of three".
- AC5 (other errors re-thrown): "non-404 error re-thrown".
- AC6 (sequential): "sequential — never parallel" asserts maxInFlight === 1.
- AC7 (Uint8Array content): "content is always Uint8Array".
- AC8 (vault isolation): import-allowlist source scan + only `./httpClient` and `../base` imports.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Adopted OQ-02-F04 proposed resolution: first 6 chars of `artifactId` (dashes stripped). Three-way collision uses incrementing `-N` suffix on top of the short id to guarantee uniqueness.
- Adopted OQ-03-F04: `mime` left undefined when missing (no `application/octet-stream` fallback).
- The legacy `file` part-type debug-skip path is implemented as a top-level pre-scan loop so the log fires even when the legacy part is the only one in an artifact.

## Assumptions
- `task.artifacts` typed as readonly arrays, so guards against undefined are defensive (FR-OF-08-style lenient parse already done by F02 `normalizeTask`).
- `ExternalEvent.file` from `../base.ts` accepts `string | Uint8Array` for `content`; we always emit `Uint8Array` per AC7.

## Open questions
None.
