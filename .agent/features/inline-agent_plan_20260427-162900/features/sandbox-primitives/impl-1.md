# Impl iteration 1 — F03 sandbox-primitives

## Summary

Landed `Sandbox` class (`src/agent/externalAgent/adapters/inlineAgent/sandbox.ts`) owning the per-`runId` working directory under `<os.tmpdir>/leo-inline-agent/<runId>/`. Implements `init` (`mkdir 0o700`, `sandbox_collision`/`sandbox_init_failed` typed errors), `resolve` (path-prefix guard), `checkSafe` (lstat-walk symlink rejection + not_found), `bytes`/`addBytes`/`willExceedQuota` for quota tracking, idempotent `cleanup` (logs on rm failure), and the static `sweepOrphans` (mtime > 1h) helper. Adapter `start()` now creates the sandbox, runs the F16 stub between `try/finally`, and always cleans up. `sweepOrphans` fires once per adapter construction.

Plumbed `runId` through the host adapter contract: `ExternalAgentInput.runId` is now optional but populated by the subgraph driver (which passes `state.runId`), and `AdapterCallDeps.start` requires `runId` so the passthrough adapter forwards it. Existing adapters that ignore `runId` keep working — the field is optional on `ExternalAgentInput`.

`esbuild.config.mjs` extended to externalize `node:`-prefixed core modules (the `builtin-modules` package emits the legacy bare names, leaving `node:fs/os/path` unbundleable). Additive change matched to the standard pattern; no behaviour change for existing code.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/sandbox.ts` — new: `Sandbox` class + `sweepOrphans` static + typed result unions.
- `src/agent/externalAgent/adapters/inlineAgent/index.ts` — wire `Sandbox` into `start()` (init/cleanup), schedule `sweepOrphans` on construction.
- `src/agent/externalAgent/adapters/base.ts` — extend `ExternalAgentInput` with optional `runId`.
- `src/agent/externalAgent/subgraph.ts` — `AdapterCallDeps.start` now requires `runId`; driver passes `state.runId` into the adapter call.
- `src/agent/externalAgent/runPhase.ts` — passthrough deps forward `runId`.
- `esbuild.config.mjs` — externalize `node:`-prefixed core modules so the adapter's `node:fs/os/path` imports survive bundling.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/sandbox.test.ts` — 13 cases covering AC1–AC7 + adapter lifecycle:
  - `init()` mode `0o700` directory under tempDir/leo-inline-agent.
  - `init()` returns `sandbox_collision` when dir exists.
  - `resolve()` rejects `..`, absolute paths, mid-path traversal.
  - `resolve()` accepts in-sandbox paths and empty string (root).
  - `checkSafe()` rejects symlink nodes (skipped on Windows).
  - `checkSafe()` returns `not_found` for missing files.
  - `addBytes` / `willExceedQuota` projection.
  - `cleanup()` idempotent + warn on rm failure (no throw).
  - `sweepOrphans` removes stale (mtime > 1h) dirs and skips fresh.
  - `sweepOrphans` no-op when root dir absent.
  - Adapter lifecycle: end-to-end `start()` always cleans up the sandbox via `finally`.
- `tests/unit/externalAgent/runPhase.test.ts` — added `runId` to the passthrough invocation fixture (BC fix).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Open-question resolution: adapter does not stat-walk for "encoded `..%2f`" — Node's `path.resolve` does not URL-decode, so `..%2f` is treated as a literal filename inside the sandbox (safe). The spec's example list is satisfied by the `resolve('../', '/abs', 'legit/../../escape')` cases.
- F03 spec mentions wrapping `start()` in `try/finally` "regardless of how `start()` exits". The async generator's `finally` runs on early termination of the iterator (e.g. caller `break`s), so cleanup is reliable for done/error/abort paths.

## Assumptions

- `runId` is optional on `ExternalAgentInput` to keep the existing `ScriptedAdapter` / `HangingAdapter` test mocks API-compatible. The subgraph always passes a real `runId`; the inline-agent falls back to `local-<timestamp>` only if a future caller invokes `start()` without one (e.g. unit tests).
- `sweepOrphans` runs at adapter construction; the constructor catches and logs swallowed promise rejections so plugin load is never blocked by sweep failures.

## Open questions

- None blocking F03.
