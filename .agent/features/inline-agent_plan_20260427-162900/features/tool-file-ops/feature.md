# F08 — Sandbox file ops tools

## Purpose

Build the `read_file`, `write_file`, `list_dir`, `delete_file` tool factories scoped to the F03 `Sandbox`. Each tool resolves user paths through `sandbox.resolve()` + `sandbox.checkSafe()`, implements byte caps, projection-checked quota writes, binary detection, and explicit error mapping (no thrown `ENOENT` past the boundary). Covers FR-IA-24, FR-IA-25, FR-IA-26, FR-IA-27.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/tools/schemas.ts` (subset for file ops): four input schemas per [context.md#fr-ia-24](../../context.md#functional-requirements)..FR-IA-27.
- `src/agent/externalAgent/adapters/inlineAgent/tools/fileOps.ts` exporting four factories.
  - `read_file({ relPath, offset?, limit? })` → `{ content, encoding: 'utf-8'|'base64', bytesRead, eof }`.
    - Binary detection re-implemented inline (no cross-import to `tools/builtin/readFileShared.ts`).
    - Default `maxBytes` 1 MB cap; over-cap → `error: 'too_large'`.
  - `write_file({ relPath, content, encoding? })` — creates parent dirs (`recursive: true`); checks projected total via `sandbox.bytes() + size > sandbox.quotaBytes` → `error: 'quota_exceeded'`; success increments `sandbox.addBytes(size)`.
  - `list_dir({ relPath? })` → `{ entries: { name, type, bytes? }[] }`; default `relPath = ''`.
  - `delete_file({ relPath })` → removes file or empty dir; non-empty dir → `error: 'not_empty'`; on success decrement `sandbox.addBytes(-bytes)`.
- All tools use `node:fs/promises` with explicit error mapping (`ENOENT → 'not_found'`, `EISDIR → 'is_directory'`, `ENOTDIR → 'not_directory'`).
- Unit tests: path-escape rejection per tool, symlink rejection (delegated to `sandbox.checkSafe`), binary detection, offset/limit ranges, quota over-projection rejection, parent-dir creation, list-dir bytes for files only, delete non-empty rejection.

Out of scope:
- Recursive delete (out of scope per [context.md#fr-ia-27](../../context.md#functional-requirements)).
- Atomic write semantics (rename-after-write) — defer to v2.
- File-watching / change events.

## Acceptance criteria

1. Every tool path passes through `sandbox.resolve` + `sandbox.checkSafe` before any IO; rejected → `error: 'path_outside_sandbox'` ([context.md#fr-ia-10](../../context.md#functional-requirements)).
2. `read_file` honors `offset`, `limit`, default `maxBytes` 1 MB; binary content base64-encoded; `eof` true when read reached EOF ([context.md#fr-ia-24](../../context.md#functional-requirements)).
3. `write_file` creates parent dirs, accepts `utf-8`/`base64`, blocks at quota with `error: 'quota_exceeded'`; `sandbox.bytes()` updates on success ([context.md#fr-ia-25](../../context.md#functional-requirements), [context.md#fr-ia-12](../../context.md#functional-requirements)).
4. `list_dir` returns alphabetical entries with `type` + `bytes?` (files only); root `''` lists sandbox root ([context.md#fr-ia-26](../../context.md#functional-requirements)).
5. `delete_file` removes file or empty dir; non-empty → `error: 'not_empty'`; non-existent → `error: 'not_found'` ([context.md#fr-ia-27](../../context.md#functional-requirements)).
6. No thrown `ENOENT` past tool boundary — all errors mapped to typed `Result` ([context.md#nfr-ia-04](../../context.md#non-functional-requirements)).
7. Zod parse rejects malformed input at boundary ([context.md#nfr-ia-02](../../context.md#non-functional-requirements)).

## Dependencies

- [F03 — sandbox primitives](../sandbox-primitives/feature.md).
- [F05 — event bridge](../event-bridge/feature.md) for `mapToolStart` / `mapToolEnd`.
- [F02 — config schema](../config-schema/feature.md) — `tools.fileOps.enabled`.
- [context.md#fr-ia-24](../../context.md#functional-requirements)..FR-IA-27, [context.md#nfr-ia-04](../../context.md#non-functional-requirements).

## Implementation notes

- Async / signal threading + finally-release: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Async & Concurrency" + §"Error Handling".
- Existing-tool reference (do not import): [`src/tools/builtin/readFileShared.ts`](../../../../src/tools/builtin/readFileShared.ts).
- Tech-stack note on `node:fs/promises` use only inside adapter sandbox: [`.agent/standards/tech-stack.md`](../../../../.agent/standards/tech-stack.md) "Externals" row.
- Best-practices: explicit error mapping at boundary ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Core Principles").

## Open questions

- Binary detection threshold — re-implementing inline could drift from `readFileShared.ts` heuristics. Worth pulling into a shared `util/` module? Currently CLAUDE rule blocks the cross-import; consider relaxing for pure helpers in a future cycle.
- Should `list_dir` recurse? SRS says no. Confirm.
- `write_file` partial-write atomicity — if quota check passes but disk fills mid-write, `bytes()` is wrong. Acceptable v1 (best-effort tracker); document.
