# Compliance iteration 1 — F01 plugin-bootstrap-logging

## Acceptance criteria

- AC1 (`onload` creates `.leo/` + `.leo/logs/`; `onunload` flushes + releases handle): PASS — `src/main.ts:30-31` calls `fs.mkdir('.leo')` and `fs.mkdir('.leo/logs')`; `src/main.ts:48-50` awaits `this.sink.flush()`; no event listeners are registered in this feature so none can leak.
- AC2 (level gating: methods below configured level dropped; `info` default suppresses `debug`): PASS — `tests/unit/logger.test.ts:66` full truth-table (4 levels × 4 methods) and `:89` default-info spot check.
- AC3 (console channel matches level + identical payload to sink): PASS — `tests/unit/logger.test.ts:103` asserts identical record shape + `console.info` receives the same `formatLine` string; `:122` asserts per-level console-method routing.
- AC4 (rotate at 1 MB; `.N → .N+1` cascade; cap 5): PASS — `src/platform/rotatingFileSink.ts:29` sets default `maxBytes: 1_000_000`; `tests/unit/rotatingFileSink.test.ts:65` exercises the boundary; `:81` asserts cap at 5 after 20 oversized writes; `:97` verifies cascading rename ordering and that oldest is dropped.
- AC5 (`error(userFacing=true)` → Notice + status bar; other levels never): PASS — `src/platform/Logger.ts:66-70` routes only when `opts.userFacing && userChannel`; `tests/unit/logger.test.ts:139` positive case, `:155` negative case for error, `:171` parametrised over `debug|info|warn` asserting no Notice.
- AC6 (structured KV serialisation alongside event): PASS — `src/platform/logTypes.ts:47` `formatLine` flattens `{ts, level, event, ...fields}` into JSON; `tests/unit/logger.test.ts:189` round-trips nested / array / null fields.
- AC7 (unit tests cover gating, rotation, Notice, structured round-trip): PASS — 14 Logger tests + 7 RotatingFileSink tests, 21 total, all green (see `qa-1.md`).

## Scope coverage

- In scope "Obsidian `Plugin` subclass with `onload` / `onunload`": PASS — `src/main.ts:23` `LeoPlugin extends Plugin`, both lifecycle methods implemented.
- In scope "`Logger` module exposing `debug|info|warn|error` with structured KV payload": PASS — `src/platform/Logger.ts:37-55`.
- In scope "`logLevel` setting (default `info`) read from plugin data": PASS — `src/main.ts:56-62` `loadSettings()` reads `loadData()`, falls back to `DEFAULT_SETTINGS.logLevel = 'info'`, and validates via `isLogLevel` guard.
- In scope "Rotating file writer at `<vault>/.leo/logs/leo.log`, 1 MB × 5": PASS — `src/main.ts:20-21,33-34` pins the path; `src/platform/rotatingFileSink.ts:29-30` pins 1 MB × 5 defaults.
- In scope "`Logger.error` with `userFacing: true` routes to `Notice` + status bar": PASS — `src/platform/Logger.ts:62-70` + adapter `src/platform/obsidianUserErrorChannel.ts`.
- In scope "Creation of `.leo/` and `.leo/logs/` on first load": PASS — `src/main.ts:30-31`; `obsidianSinkFs.mkdir` is idempotent (guarded by `exists`).
- In scope "Minimal unit coverage for gating / rotation / Notice routing": PASS — 21 tests.

## Out-of-scope audit

- Out of scope "Provider retry / timeout / backoff log events": CLEAN — no provider code in this feature.
- Out of scope "Indexing progress logs / status-bar progress widget": CLEAN — status-bar element only hosts user-facing error mirror; no progress widget.
- Out of scope "Tool-invocation log events": CLEAN — no tool registry yet.
- Out of scope "MCP event logs": CLEAN — no MCP client yet.
- Out of scope "Settings-tab UI for toggling `logLevel`": CLEAN — `loadSettings()` is read-only from `data.json`; no `PluginSettingTab` registered.
- Out of scope "Telemetry / log shipping / network egress": CLEAN — no `fetch` or network import anywhere in `src/platform/`.

## QA aggregate

`qa-1.md` verdict: PASS. Gates: typecheck PASS, lint PASS, tests PASS (21/21), build PASS (3 995 B `main.js`).

## Verdict: PASS
