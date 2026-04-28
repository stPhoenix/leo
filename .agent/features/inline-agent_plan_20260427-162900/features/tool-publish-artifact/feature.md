# F09 — `publish_artifact` + artifact flush loop

## Purpose

Implement the artifact-nomination tool — `publish_artifact(relPath, summary?)` writes nothing immediately; it appends to `runState.publishedArtifacts` after sandbox-safety + duplicate + count checks. Build the terminal flush loop: on `done`, the adapter reads each nominated artifact, emits one `ExternalEvent { type: 'file', relPath, content, mime? }` per artifact in nomination order, then `{ type: 'done' }`. Missing-artifact at flush → `warn` log, skip, continue. Covers FR-IA-28, FR-IA-29, FR-IA-30, FR-IA-31.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/tools/schemas.ts` (subset for publish_artifact): per [context.md#fr-ia-28](../../context.md#functional-requirements).
- `src/agent/externalAgent/adapters/inlineAgent/tools/publishArtifact.ts` exporting `createPublishArtifactTool({ config, sandbox, logger, runState })`.
  - Validates `relPath` via `sandbox.resolve` + `sandbox.checkSafe`; absent on disk at nomination time → `error: 'not_found'`.
  - Duplicate `relPath` already in `runState.publishedArtifacts` → `error: 'duplicate'`.
  - Count >= `config.sandbox.maxArtifacts` (default 32) → `error: 'artifact_limit'`.
  - Success appends `{ relPath, summary }` to `runState.publishedArtifacts` and returns `{ ok: true, data: { published: count, remaining: maxArtifacts - count } }`.
- `src/agent/externalAgent/adapters/inlineAgent/artifactFlush.ts` exporting `async *flushPublishedArtifacts({ runState, sandbox, logger }): AsyncIterable<ExternalEvent>` — on terminal `done`, walks nominations in order:
  - Re-resolve via `sandbox.resolve` + read bytes; emit `{ type: 'file', relPath, content, mime? }`.
  - Detect MIME by extension (small inline map: `md`, `txt`, `json`, `csv`, `png`, `jpg`, `pdf`); unknown → omit `mime`.
  - Missing/`ENOENT` → `logger.warn({ relPath, reason: 'artifact_missing' })`, emit no event, continue.
  - After all artifacts emit `{ type: 'done' }`.
- Adapter `start()` wires `flushPublishedArtifacts` after the synthesize/simple branch terminates **and** on `iteration_limit` partial flush per [context.md#fr-ia-36](../../context.md#functional-requirements) (the partial-artifact rule).
- Unit tests: nomination order preserved; duplicate rejection; count limit; missing artifact warn-and-skip; MIME detection; partial flush on `iteration_limit`.

Out of scope:
- The tool being callable from `researchStep` — explicitly excluded from that branch's tool list (F14 enforces).
- `ResultWriter` writing artifacts under `externalAgentResults/<runId>/` — already lives in the host subgraph and is unchanged.
- Cross-run artifact reuse ([context.md#out-of-scope](../../context.md#out-of-scope)).

## Acceptance criteria

1. Nomination buffers entries; nothing crosses sandbox boundary until terminal `done` ([context.md#fr-ia-28](../../context.md#functional-requirements)).
2. >32 nominations → `error: 'artifact_limit'` ([context.md#fr-ia-29](../../context.md#functional-requirements)).
3. Duplicate `relPath` → `error: 'duplicate'`; non-existent file at nomination time → `error: 'not_found'`.
4. On terminal `done`, one `file` event per artifact in nomination order, then one `done` event ([context.md#fr-ia-30](../../context.md#functional-requirements)).
5. Missing artifact at flush time → `warn` event with `{ relPath, reason: 'artifact_missing' }`, skipped, run does not abort ([context.md#fr-ia-31](../../context.md#functional-requirements)).
6. Partial `iteration_limit` exit on simple branch still flushes prior nominations ([context.md#fr-ia-36](../../context.md#functional-requirements)).
7. Path-prefix safety enforced at nomination AND flush — symlink swapped between time-of-nomination and time-of-flush still rejected.

## Dependencies

- [F03 — sandbox primitives](../sandbox-primitives/feature.md).
- [F04 — run state + budgets](../run-state-budgets/feature.md) (`publishedArtifacts` lives on runState).
- [F05 — event bridge](../event-bridge/feature.md) (`mapToolStart` / `mapToolEnd` + warn helper).
- [`src/agent/externalAgent/resultWriter.ts`](../../../../src/agent/externalAgent/resultWriter.ts) — host consumer, no change required.
- [context.md#fr-ia-28](../../context.md#functional-requirements)..FR-IA-31, [context.md#fr-ia-36](../../context.md#functional-requirements).

## Implementation notes

- Layer + adapter isolation: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Imports & Module Boundaries".
- Async `for await` patterns: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Async & Concurrency".
- Existing host artifact persistence path is unchanged: see [context.md#scope](../../context.md#scope) reference to `ResultWriter`.
- Best-practices: typed `Result` over thrown errors at tool boundary ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Core Principles" — Fail Fast).

## Open questions

- MIME detection scope — should we read magic bytes for unknown extensions, or rely strictly on extension? Lean: extension-only v1; the host doesn't depend on `mime` for routing, only for downstream rendering.
- If `delete_file` removes a previously nominated artifact mid-run, do we eagerly remove the nomination or detect at flush time only? Lean: detect at flush (matches FR-IA-31 phrasing) to keep the tool surface minimal.
- Should `publish_artifact` be allowed during the simple branch only, or can synthesize also re-publish? FR-IA-40 confirms synthesize may publish. FR-IA-38 forbids researchStep. Codify in tool-list assembly (F12, F14, F15).
