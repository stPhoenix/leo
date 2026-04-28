# Impl iteration 1 — F02 result-writer

## Summary

Built `ResultWriter` (`src/agent/externalAgent/resultWriter.ts`) as the sole vault-write path for the subgraph: writes `request.md` + `response.md` first, then sanitized adapter files; on any failure flushes a structured `error.md` carrying `code`, `message`, and the partial-write inventory. Sanitizer rejects absolute paths (Unix + Windows drive), `..` traversal anywhere in the path, and NUL chars; reserved names (`request.md`, `response.md`) are blocked from adapter overrides. Folder collision falls back to a `-retry` suffix per SRS §12. Wired the `externalAgentResults/` prefix into both `ExcludeListStore` (idempotent, persists across user `set()` via a new `defaults` set) and `DirtyQueue.add()` (intake filter — drop on prefix match). `VaultAdapter` gained an optional `writeBinary(path, Uint8Array)` so adapter `file` events with binary payloads can pass through; existing stubs keep working because the method is optional and `ResultWriter` falls back to `TextDecoder` when absent.

## Files touched

- `src/agent/externalAgent/resultWriter.ts` — new module (FR-EXT-19/20/22, NFR-EXT-03).
- `src/storage/vaultAdapter.ts` — added optional `writeBinary` + interface implementation.
- `src/settings/excludeListStore.ts` — `ensureDefaultPrefix(prefix)` helper + `defaults` carried across `set()` (FR-EXT-21).
- `src/indexer/dirtyQueue.ts` — drop paths under `EXTERNAL_AGENT_RESULTS_PREFIX` at `add()` (FR-EXT-21).
- `src/indexer/wireIndexerRag.ts` — call `excludeStore.ensureDefaultPrefix(EXTERNAL_AGENT_RESULTS_PREFIX)` at construction (entry-point reachable wiring).
- `tests/unit/externalAgent/resultWriter.test.ts` — 12 cases covering sanitizer, builders, happy path, partial-write error, sanitizer rejection, pre-existing error injection, folder collision, reserved-name guard.
- `tests/unit/externalAgent/excludeWiring.test.ts` — 4 cases covering matcher idempotence, set() persistence, dirtyQueue intake filter.

## Tests added or updated

- `tests/unit/externalAgent/resultWriter.test.ts` — covers AC1, AC2, AC3, AC4, plus collision and reserved-name guard.
- `tests/unit/externalAgent/excludeWiring.test.ts` — covers AC5 (idempotent prefix) and AC6 (dirtyQueue intake).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The optional `VaultAdapter.writeBinary` method (extension to the existing interface) was added rather than a brand-new sibling adapter — keeps the single-port abstraction intact while still letting `ResultWriter` write binary content when the platform supports it. Existing `VaultAdapter` consumers and test stubs are unaffected because the method is optional.
- `ResultWriter` rejects adapter files whose sanitized name collides with reserved `request.md` / `response.md`. Not in feature.md but a natural extension of the sanitizer guarantees (otherwise an adapter could overwrite the always-written files).

## Assumptions

- Adapter `file` events with `Uint8Array` content but on a runtime without `writeBinary` (e.g., a stub-only test) get UTF-8 decoded into `write()`. v1 ships zero adapters that emit binary, so this fallback is theoretical.
- `runId` is supplied by the subgraph (per OQ-01-F02 proposed default); writer treats it as opaque.
- `ExcludeListStore.defaults` survives `set()` so user edits never accidentally drop the result-folder exclusion.

## Open questions

OQ-01-F02 honored (subgraph owns runId). OQ-02-F02 honored (`-retry` suffix on collision). Neither blocks ship.
