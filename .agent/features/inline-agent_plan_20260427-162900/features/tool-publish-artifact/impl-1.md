# Impl iteration 1 — F09 tool-publish-artifact

## Summary

Landed `publish_artifact` tool factory + `flushPublishedArtifacts` async generator + extension-based MIME detector. Tool buffers nominations on `runState.publishedArtifacts` after Zod, sandbox safety, count-cap, file-existence, and duplicate checks. Flush walks nominations in order, re-resolves through the sandbox, reads bytes (text → string for `text/*` mime, otherwise `Uint8Array`), and emits one `file` ExternalEvent per artifact. Missing/symlinked-on-flush nominations log a `warn` and yield a single `log warn` event without aborting the run.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/tools/publishArtifact.ts` — new: `createPublishArtifactTool`, `mimeFromRelPath`, `PublishArtifactConfig`, `PublishArtifactResult`.
- `src/agent/externalAgent/adapters/inlineAgent/artifactFlush.ts` — new: `flushPublishedArtifacts` generator (text vs binary content, warn on missing/path violation).

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/publishArtifact.test.ts` — 18 cases:
  - Tool: AC1 buffer-only nomination, AC2 count cap, AC3 duplicate + not_found, AC1 path-escape rejection.
  - Flush: AC4 in-order file events, AC5 missing-artifact warn-skip, AC7 nomination valid then deleted, binary → Uint8Array content.
  - `mimeFromRelPath` table-driven over the 8 known extensions.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Open-question resolution: extension-only MIME detection. No magic-bytes path. Unknown extension omits `mime` from the event.
- Mid-run delete: detected at flush time only (matches FR-IA-31 phrasing); no eager removal from nomination list.
- The "partial flush on iteration_limit" wiring is owned by the adapter `start()` orchestration (F12 + F16). F09 only ships the helpers; F12 will call `flushPublishedArtifacts` from the simple-branch error path.

## Assumptions

- Final `{type:'done'}` event is emitted by the adapter `start()` loop, not by `flushPublishedArtifacts` itself — keeps the helper composable across simple, multistep, and partial-flush paths.

## Open questions

- F16 will decide whether to skip the flush entirely on hard `error` paths or always run it for partial publication.
