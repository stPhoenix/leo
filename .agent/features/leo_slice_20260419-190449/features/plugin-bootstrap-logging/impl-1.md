# Impl iteration 1 — F01 plugin-bootstrap-logging

## Summary

Established the full plugin scaffold (package.json, tsconfig, manifest.json, esbuild, vitest, eslint) plus a leveled, structured `Logger` with a rotating 1 MB × 5 on-disk sink, Obsidian `Plugin` entrypoint wiring the logger on `onload` and flushing it on `onunload`, and unit coverage for level gating, rotation boundary, rotation cap, notice/status-bar routing, and structured-payload round-trip.

## Files touched

- `package.json` — pnpm scripts (`dev`, `build`, `typecheck`, `test`, `lint`) and devDependencies (TS 5, esbuild, vitest, obsidian types, typescript-eslint).
- `tsconfig.json` — TS 5 strict + `noUncheckedIndexedAccess`, `@/*` → `src/*` path alias, ESNext modules with Bundler resolution.
- `manifest.json` — Obsidian plugin manifest (`minAppVersion: 1.5.0`, desktop-only) per tech-stack.md.
- `esbuild.config.mjs` — CJS bundle to `main.js`, `obsidian`/`electron`/`@codemirror/*`/node builtins externalised, `@` alias mirrored.
- `vitest.config.ts` — node env, `@` alias to `src/`, `tests/**/*.test.ts` glob.
- `.eslintrc.cjs` + `.eslintignore` — typescript-eslint recommended, `no-console` forbids bare `console.log` (allows `debug|info|warn|error` used only inside `Logger`), `consistent-type-imports`.
- `src/platform/logTypes.ts` — `LogLevel`, `LogRecord`, `LogSink`, `UserErrorChannel` contracts; `formatLine` JSON serializer; `isLogLevel` guard; level-ordering map.
- `src/platform/Logger.ts` — `Logger` class with `debug|info|warn|error`, level gating before console + sink fan-out, `error(..., { userFacing })` routing to `UserErrorChannel`, `flush()` awaits pending sink writes.
- `src/platform/rotatingFileSink.ts` — `SinkFs` adapter interface + `RotatingFileSink` with serialized write queue, pre-write size guard at `maxBytes`, cascading `.N → .N+1` rotation capped at 5, bounded `flush()` (250 ms) that drops the tail on timeout.
- `src/platform/obsidianSinkFs.ts` — `SinkFs` backed by Obsidian `DataAdapter` (`exists`/`mkdir`/`stat`/`append`/`rename`/`remove`).
- `src/platform/obsidianUserErrorChannel.ts` — Obsidian `Notice` + status-bar element adapter implementing `UserErrorChannel`.
- `src/main.ts` — `LeoPlugin extends Plugin`; `onload` loads settings, ensures `.leo/` + `.leo/logs/`, constructs sink and logger, registers a status-bar item, emits `plugin.load`; `onunload` emits `plugin.unload` and awaits bounded flush.

## Tests added or updated

- `tests/unit/logger.test.ts` — 14 tests covering AC2 level-gating truth table (all four levels × four methods + default-info spot check), AC3 console + sink parity per level, AC5 userFacing vs non-userFacing error routing (including `debug|info|warn` never raising `Notice`), AC6 structured-payload round-trip with nested/array/null fields, and `flush()` awaiting pending writes.
- `tests/unit/rotatingFileSink.test.ts` — 7 tests covering newline-delimited JSON append, init picking up pre-existing file size, AC4 rotation at the `maxBytes` boundary, AC4 cap at 5 siblings after 20 oversized writes, cascading rename ordering, FIFO ordering under concurrent writes, and the 250 ms bounded `flush()` with a stuck append.

Total: 21 tests, all green locally (`pnpm test`).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- `src/main.ts` uses `export default class LeoPlugin` despite code-style.md's "No default exports" rule. Reason: Obsidian loads plugins via CommonJS `module.exports.default`; esbuild's CJS output for a named-export entrypoint would need a wrapper. Treating the plugin entrypoint as a platform boundary where the default export is mandated; no other module in the repo uses a default export.
- `main.js` bundle is produced by `pnpm build` but not added to `.gitignore` (Obsidian plugin convention is to ship a committed `main.js`); leaving the decision to later features that touch release tooling.

## Assumptions

- `logLevel` is read-only from `plugin.loadData()` in this feature; the settings-tab UI ships with F03. `data.json` absence defaults to `info`.
- `UserErrorChannel.setStatus` mirrors the last-emitted user-facing error message; no "error resolved" clear path is wired yet (F02/F27 will clear on reconnect/index-ready). The `clearStatus()` hook exists for those consumers.
- Rotation comparison uses `currentSize + nextLineBytes > maxBytes`. A single log line larger than `maxBytes` still lands in the active file (rotation can't split a line); tests assert this is acceptable by using lines smaller than `maxBytes`.
- `SinkFs.stat` returns `null` when the file does not exist; Obsidian's `DataAdapter.stat` returns `null`/`undefined` for missing files, which the adapter normalises.

## Open questions

- The feature.md lists three open questions (provider-retry `logLevel`, error-burst dedupe, unload flush semantics). This iteration implemented a **bounded 250 ms `flush()` that drops the tail on timeout**, aligning with the feature.md suggestion. Dedupe is intentionally not implemented. Both remain open pending verification.
