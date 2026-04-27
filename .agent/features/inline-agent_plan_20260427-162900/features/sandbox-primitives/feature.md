# F03 — Sandbox primitives

## Purpose

Build the `Sandbox` class that owns the per-`runId` temp directory `<os.tmpdir>/leo-inline-agent/<runId>/`, enforces path-prefix + symlink rejection on every relative path, tracks projected sandbox bytes for quota enforcement, and guarantees cleanup via `finally` on done/error/abort/throw. Also lands the orphan-sweep helper invoked at adapter construction (best-effort `mtime > 1h` `fs.rm`). Covers [context.md#fr-ia-09](../../context.md#functional-requirements) FR-IA-09, FR-IA-10, FR-IA-11, FR-IA-12, NFR-IA-04.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/sandbox.ts` exporting `Sandbox` class:
  - `static async sweepOrphans({ now, logger })` — best-effort.
  - `constructor({ runId, logger })`.
  - `async init()` — `mkdir <tmp>/leo-inline-agent/<runId>` mode `0o700`; reject with `error.code='sandbox_collision'` if dir already exists; reject with `error.code='sandbox_init_failed'` on other errors.
  - `resolve(relPath: string): { ok: true; absPath: string } | { ok: false; error: 'path_outside_sandbox' }` — `path.resolve(root, relPath)` then prefix check `root + path.sep`.
  - `async checkSafe(absPath): Promise<{ ok: true } | { ok: false; error: 'path_outside_sandbox' }>` — `lstat`, reject symlinks (any node in the resolved chain) under sandbox.
  - `bytes(): number` / `addBytes(n: number): void` — projected total tracker for FR-IA-12.
  - `quotaBytes: number` (read-only).
  - `async cleanup()` — `fs.rm(root, { recursive: true, force: true })`; never throws (logs `warn` on error).
  - `root: string` getter.
- Adapter `start()` calls `init()` before any tool wiring; `cleanup()` runs in `finally` regardless of done/error/abort/throw.
- Unit tests covering: path-escape rejection (`../`, absolute paths, encoded `..%2f`), symlink rejection (file-symlink + dir-symlink), quota tracking (`addBytes` then projected total), `mkdir 0o700` mode bit verification on POSIX, cleanup idempotency (calling twice safe), orphan sweep skipping fresh dirs and removing stale ones.

Out of scope:
- File-op tool factories (F08).
- `write_file`'s actual byte accounting — F08 calls `sandbox.addBytes(n)` after successful writes.
- Symbolic-link content normalization for hard links — out (lstat on path nodes is sufficient guard).

## Acceptance criteria

1. `init()` creates directory mode `0o700` under `os.tmpdir()/leo-inline-agent/<runId>/` ([context.md#fr-ia-09](../../context.md#functional-requirements)).
2. `resolve('../etc/passwd')`, `resolve('/etc/passwd')`, `resolve('legit/../../escape')` all return `{ ok: false, error: 'path_outside_sandbox' }` ([context.md#fr-ia-10](../../context.md#functional-requirements)).
3. `checkSafe()` returns `path_outside_sandbox` for any path containing a symlink node — verified with a fixture creating a symlink inside the sandbox pointing outside ([context.md#fr-ia-10](../../context.md#functional-requirements)).
4. Cleanup runs in `finally` regardless of whether `start()` exits via done, error, abort, or unexpected throw — verified by parameterized abort/throw tests ([context.md#fr-ia-11](../../context.md#functional-requirements)).
5. `addBytes(n)` updates `bytes()` total; `bytes() + n > quotaBytes` is the projection used by `write_file` to surface `quota_exceeded` ([context.md#fr-ia-12](../../context.md#functional-requirements)).
6. All file IO is `node:fs/promises`; no thrown `ENOENT` past the sandbox boundary — `init` / `cleanup` / `checkSafe` map errors to typed results ([context.md#nfr-ia-04](../../context.md#non-functional-requirements)).
7. `Sandbox.sweepOrphans` removes `leo-inline-agent/<runId>` entries with `mtime > 1h`; failures logged at `warn`, not fatal — invoked once at adapter construction.

## Dependencies

- [F01 — adapter scaffold](../adapter-scaffold/feature.md) (adapter `start()` host + logger).
- Node built-ins `node:fs/promises`, `node:os`, `node:path`.
- [context.md#fr-ia-09](../../context.md#functional-requirements)..FR-IA-12, [context.md#nfr-ia-04](../../context.md#non-functional-requirements).

## Implementation notes

- Strict TS guards + boundary error mapping: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Error Handling" / §"Async & Concurrency".
- Layer rule (Adapter → Platform; no UI/Storage cross-imports): [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Imports & Module Boundaries".
- Tech-stack note on `node:fs/promises` use only inside adapter-scoped sandbox: [`.agent/standards/tech-stack.md`](../../../../.agent/standards/tech-stack.md) "Externals" row (Node built-ins not bundled).
- KISS: keep tracker an in-memory counter, do not stat-walk on every write ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Core Principles").

## Open questions

- Sweep policy edge: if Obsidian crashed mid-run, the orphan dir's `mtime` might be < 1h on reopen — should we use `birthtime` instead? `birthtime` is unreliable on Linux ext4. Stick with `mtime > 1h` and accept the leak window.
- Concurrent runs (different `runId` from different threads) — sweep happens at adapter construction (once at plugin load), not per-run, so no race. Confirm by reading `main.ts` adapter construction ordering during F01 implementation.
- Should `quotaBytes` enforce bidirectional accounting (subtract on `delete_file`)? FR-IA-12 talks about "projected total before writing" only. Lean: track delta in both directions to avoid drift over a long run.
