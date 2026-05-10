# F04 — Artifact downloader

## Purpose

After the polling driver delivers a terminal task, walk `task.artifacts[].parts[]`, select `fileRef` parts, fetch each one's bytes via the F02 transport, and emit them as `ExternalEvent.file` events to the adapter's async iterable. Handles `404` (evicted) gracefully by skipping the missing artifact rather than failing the whole run, deduplicates colliding `relPath` values, and ignores unknown / inline-legacy part types per SRS §6.

Implements [`context.md`](../../context.md) FR-OF-09, FR-OF-10, FR-OF-11, FR-OF-12, FR-OF-27, FR-OF-28.

## Scope

**In scope**

- New file `src/agent/externalAgent/adapters/openfang/artifacts.ts` exporting:
  - `selectFileRefs(task: A2aTask): readonly FileRefSelection[]` — pure enumerator returning a flattened, ordered list of `{ artifactId: string; partIndex: number; name: string; mimeType: string | undefined; url: string; size: number | undefined }` records, one per `parts[].type === 'fileRef'` entry across all `artifacts[]`. Order preserves source-array order so the receiver sees deterministic emission.
  - `dedupeRelPaths(items: readonly FileRefSelection[]): readonly DedupedFileRef[]` — pure function that, when two items share the same `name`, suffixes the second-and-later with `-<short_artifact_id>` before the file extension. Returns `{ original: FileRefSelection; relPath: string }`. (Resolves context.md OQ-04.)
  - `async function* downloadArtifacts(deps: ArtifactDeps, task: A2aTask, signal: AbortSignal): AsyncIterable<ExternalEvent>`:
    - `ArtifactDeps`: `{ http: Pick<OpenfangHttp, 'downloadArtifact'>; log: LogFn }`.
    - For each deduped item: `log('info', ...)` with `{ relPath, mimeType, size }` (no key, no URL with token), then `await http.downloadArtifact(item.original.url, signal)`. On success yield `{ type: 'file', relPath, content: bytes, mime }`. On `OpenfangHttpError(404)`: `log('warn', ...)` with `{ artifactId, name }` and continue with the next item. On any other error: re-throw (caller in F05 maps).
    - Skips parts whose `type !== 'fileRef'`. The SRS §6 also mentions a legacy `file` type with inline data — those are explicitly logged at `debug` and dropped.
- Unit tests at `tests/unit/externalAgent/adapters/openfang/artifacts.test.ts`:
  - `selectFileRefs`: task with mixed `text`/`fileRef`/`data`/legacy `file` parts → only `fileRef` entries emitted, in order
  - `selectFileRefs`: task with empty `artifacts` returns `[]`
  - `dedupeRelPaths`: two `report.md` artifacts with different ids → second becomes `report-<id6chars>.md`
  - `dedupeRelPaths`: name without an extension → suffix appended at end (`notes` → `notes-<id6chars>`)
  - `downloadArtifacts` happy path: mocked `http.downloadArtifact` returns bytes; iterable yields one `file` event per fileRef, in order
  - `downloadArtifacts` 404 path: one of three artifacts returns `OpenfangHttpError(404)`; iterable still yields the other two and logs one `warn` (FR-OF-28)
  - `downloadArtifacts` non-404 error path: `OpenfangHttpError(500)` re-thrown; iterable terminates with the in-flight fileRef not yielded
  - `downloadArtifacts` abort: `signal.abort()` mid-iterable terminates promptly; pending downloads not yielded
  - sequential ordering: assert that `http.downloadArtifact` is called in source-array order, never in parallel (FR-OF-27 — text-before-files pacing happens at the F05 level; here we assert sequential within artifacts)

**Out of scope**

- Text emission (F05 does the `messages[-1]` text-and-data render before invoking this module per FR-OF-27).
- File persistence (`ResultWriter` from F02 of the prior slice consumes `ExternalEvent.file` and writes to vault — not the adapter's job).
- Artifact bytes caching across runs (each `start()` invocation is independent; SRS §6 forbids relying on URL longevity anyway).
- Per-file size caps (context.md OQ-05 deferred).

## Acceptance criteria

1. `selectFileRefs` returns only `fileRef` parts in input order; tolerates missing `artifacts` / `parts` keys (returns `[]`). (FR-OF-09, NFR-OF-08.)
2. `dedupeRelPaths` produces unique `relPath` values across the result set when input names collide; non-colliding inputs are passed through verbatim. (Resolves context.md OQ-04.)
3. `downloadArtifacts` yields exactly one `ExternalEvent.file` per successfully-downloaded fileRef, with `relPath` from dedupe, `content: Uint8Array` from the transport, and `mime` from the response `Content-Type`. (FR-OF-10, FR-OF-11.)
4. On `OpenfangHttpError(404)` for a single artifact, the iterable continues with remaining artifacts and emits one `warn` log entry with `{ artifactId, name }` (no token, no URL). (FR-OF-28.)
5. Other errors propagate (re-thrown) to the caller for mapping. The adapter shell in F05 catches and maps to `error.code = 'transient_failure'` for `5xx` or other `OpenfangHttpError.status`-driven codes.
6. Downloads run sequentially; never `Promise.all`. Asserted by call-order test.
7. `ExternalEvent.file.content` is always `Uint8Array` (never a `string`), to keep the file-write path in the prior slice's `ResultWriter` consistent regardless of MIME type.
8. Module is pure of `fetch` / plugin internals — only imports `./httpClient` types, the `ExternalEvent` discriminated union from `../base`, and `node:` built-ins. (Vault-isolation per NFR-OF-02.)

## Dependencies

- **F02** — `OpenfangHttp.downloadArtifact`, `OpenfangHttpError`, `A2aTask` / `A2aArtifact` / `A2aPart` types.
- Cross-doc:
  - [`context.md#fr-of-09`](../../context.md#functional-requirements)
  - [`../../../../srs/openfang.md`](../../../../srs/openfang.md) §6 (artifact contract, lifetime, "skip part types you don't understand").
  - [`../openfang-http-client/feature.md`](../openfang-http-client/feature.md)
  - [`../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md`](../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md) (`ExternalEvent.file` shape).

## Implementation notes

- Pure-core / IO-edge separation — see [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §1.
- `ExternalEvent.file` shape — see `src/agent/externalAgent/adapters/base.ts` (already in the codebase from F01 of the prior slice).
- Sequential async iteration pattern — see [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Async & Concurrency".
- File naming for stable test mocks — colocate `tests/unit/externalAgent/adapters/openfang/__fixtures__/` if needed; project test layout per [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md).

## Open questions

- **OQ-01-F04** Should `selectFileRefs` walk `messages[].parts[]` too in case demiurg ever puts file refs inside a message rather than inside `artifacts`? SRS §4 / §6 only describe the `artifacts[]` channel. **Proposed**: no — strictly follow the documented surface; revisit if real-world responses violate it.
- **OQ-02-F04** Should the deduper hash `artifactId` to a short suffix (e.g. first 6 chars) or use a numeric counter (`-1`, `-2`)? **Proposed**: first 6 chars of `artifactId` — stable across reruns, no hidden state.
- **OQ-03-F04** When `mimeType` is missing from the part, should the file event default to `application/octet-stream`? **Proposed**: leave `mime` undefined and let the consumer (`ResultWriter`) decide. Avoids hardcoding.
