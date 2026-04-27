# F02 — Result writer & RAG exclude wiring

## Purpose

Persist external-agent outputs to the vault under `externalAgentResults/<runId>/` and ensure the folder is invisible to the indexer/RAG pipeline. Encapsulates *the only* path through which adapter-produced bytes reach the vault, satisfying the adapter-isolation invariant from F01.

Implements [`context.md`](../../context.md) FR-EXT-19, FR-EXT-20, FR-EXT-21, NFR-EXT-03.

## Scope

**In scope**
- `src/agent/externalAgent/resultWriter.ts`: `write({ runId, refinedPrompt, adapterId, startedAt, endedAt, textBuffer, files, error? })` → `{ folder, writtenFiles[] }`. Sole vault-write path for the subgraph.
- `request.md` and `response.md` content templates (frontmatter + body) per [`.agent/srs/external-agent.md`](../../../../srs/external-agent.md) §8.
- `error.md` template (code, message, timestamps, adapterId, refinedPrompt). Always emitted on ERROR even if adapter produced no `text` events.
- Path sanitizer: rejects `relPath` containing absolute prefixes (`/`, `C:\`, etc.) or `..` segments before passing to `VaultAdapter`. Returns a typed error to the caller without writing.
- Idempotent registration of `externalAgentResults/` prefix into `excludeListStore` defaults at plugin load.
- `dirtyQueue.add()` filter: drop paths matching `externalAgentResults/**` at intake (no reindex churn).
- Unit tests with `fake-indexeddb` + a vault-adapter stub: success path, partial-write-then-error path emits `error.md`, sanitizer rejects malicious `relPath`, exclude registration is idempotent across restarts.

**Out of scope**
- Subgraph state transitions that *call* the writer (F05).
- Adapter-side file emission (F09, F10).
- UI surface for opening the result folder (covered in F08 as a link).

## Acceptance criteria

1. `write()` creates the folder via `VaultAdapter.createFolder` (or equivalent), then writes `request.md` and `response.md` first; only after both succeed does it iterate `files`. Honors NFR-EXT-03 (atomic per-file).
2. On any per-file failure, `write()` flushes whatever it has and writes `error.md` carrying `code` + `message` + the partial-write inventory. Never throws to the caller; returns `{ ok:false, folder, writtenFiles, error }`.
3. `request.md` frontmatter matches the template in [`.agent/srs/external-agent.md`](../../../../srs/external-agent.md) §8 (`runId`, `adapter`, `threadId`, `startedAt`, `endedAt`, `status`).
4. Path sanitizer rejects (without writing): leading `/`, leading drive letter (Windows-style), any `..` segment, NUL characters. Returns `error.code='invalid_path'` with the offending input.
5. `excludeListStore` exposes `addDefaultPrefix('externalAgentResults/')` (or equivalent) — implementation MUST NOT duplicate the entry on second call. Honors FR-EXT-21.
6. `dirtyQueue.add(path)` short-circuits when `path` starts with `externalAgentResults/`. Verified by unit test that asserts `enqueue` count stays 0 after repeated adds.
7. All tests under `tests/unit/externalAgent/resultWriter.test.ts` and `tests/unit/externalAgent/excludeWiring.test.ts` pass under default `vitest` config.

## Dependencies

- **F01** — Result writer accepts `files: ReadonlyArray<{ relPath; content; mime? }>` matching the `ExternalEvent.file` shape.
- Cross-doc:
  - [`context.md#fr-ext-19`](../../context.md#functional-requirements)
  - [`../adapter-contract/feature.md`](../adapter-contract/feature.md)

## Implementation notes

- **Layer placement (role vs file location)**: `ResultWriter` is an **Adapter-layer** module per [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §1–§2 (it owns vault IO and exposes a typed boundary), even though its file lives under `src/agent/externalAgent/` for cohesion with the subgraph that consumes it. Imports respect the Adapter-layer rule: only `VaultAdapter`, `excludeListStore`, `dirtyQueue`, and pure helpers; nothing from Agent / UI / Chat state.
- VaultAdapter — sole vault-write path per [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3.4 (Adapters table); never call `app.vault.adapter` directly per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Obsidian Plugin Patterns".
- Existing exclude store — extend defaults in `src/settings/excludeListStore.ts`; matcher in `src/rag/excludeMatcher.ts` (already glob-aware) — see project layout in [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md).
- Indexer intake — `src/indexer/dirtyQueue.ts`; pure state machine per [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3.3.
- Error handling — return typed `Result`-shaped object; never let exceptions escape, per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Error Handling".
- IDB / vault FS — IO at edges per [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §1; writer is itself an Adapter-layer module.

## Open questions

- **OQ-01-F02** `runId` allocation site: writer accepts it (so subgraph owns wall-clock) or generates it lazily? **Proposed**: subgraph generates and threads it; writer is pure on its inputs.
- **OQ-02-F02** Folder-name collision strategy when two runs land on the same `runId` (clock skew). **Proposed**: append `-retry` suffix and emit `warn` log event; surfaces in widget. Documented for FR-EXT-23 / SRS §12 row "VaultAdapter.create fails".
