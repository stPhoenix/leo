# Compliance iteration 1 — F65 wire-user-tools

## Acceptance criteria

- AC1 (orphan userToolsLoader reachable from src/main.ts): **PASS** — `src/tools/user/wireUserTools.ts` imports `loadUserTools` / `USER_TOOLS_DIR` / `ToolRegistryLike`, and `src/main.ts` imports `wireUserTools`. Transitive closure from entry point now reaches `userToolsLoader.ts`.
- AC2 (loadAll runs after built-ins; user tools appear in `toOpenAITools`): **PASS** — `src/main.ts:409-451` invokes `wireUserTools` after `searchVaultTool` registration; the helper re-enters `loadUserTools` which calls `opts.registry.register` on the shared `ToolRegistry`. Covered by `tests/unit/wireUserTools.test.ts > loadAll registers every valid declaration on mount`.
- AC3 (create registers without reload; delete unregisters): **PASS** — `wireUserTools.ts` wires `opts.fileEvents.on(...)` → serialized `reload()`; reload unregisters every previously-tracked id before re-running `loadUserTools`. Covered by `tests/unit/wireUserTools.test.ts > reload() picks up a new file created under the tools dir` and `> deleting a file unregisters the tool on next reload`.
- AC4 (malformed file emits `Logger.warn` + is skipped; other tools continue): **PASS** — `userToolsLoader.ts:111-118` emits `tool.user.load.error` via `Logger.warn`; the wiring path exercises this via `tests/unit/wireUserTools.test.ts > skips malformed files without crashing`.
- AC5 (`Leo: Reload user tools` re-runs loadAll): **PASS** — `wireUserTools.ts:85-92` calls `opts.commands?.register(USER_TOOLS_RELOAD_COMMAND_ID, 'Leo: Reload user tools', …)`; `src/main.ts` forwards the callback via `registerLeoCommand`. Covered by `tests/unit/wireUserTools.test.ts > registers a "Leo: Reload user tools" palette command`.
- AC6 (existing tests stay green; new tests added): **PASS** — `pnpm test` reports 1045/1045 with 8 new cases in `tests/unit/wireUserTools.test.ts`.

## Scope coverage

- In scope "Construct a `UserToolsLoader` in `main.ts.onload`": **PASS** — `wireUserTools` constructed at `src/main.ts:409` (line shifted by new imports, see impl-1.md).
- In scope "call `loader.loadAll()` after built-in tools register": **PASS** — mount-time `await reload()` inside `wireUserTools` calls `loadUserTools`.
- In scope "`registerEvent` listeners on `.leo/tools/**` create/modify/delete/rename → `loader.reload(path)`": **PASS** — inline adapter in `src/main.ts` wraps each of the four vault events, passes to `UserToolsFileEvents.on`; wiring filters with `isUnderDir` and schedules reload.
- In scope "`Leo: Reload user tools` palette command": **PASS** — registered via `registerLeoCommand` with id `leo-reload-user-tools`.
- In scope "On `onunload`, `toolRegistry.unregister` every user tool and stop listeners": **PASS** — `this.userTools?.dispose()` added after `indexerRag.dispose`; `dispose()` unregisters tracked ids and calls the events teardown.
- In scope "Unit tests: loadAll / malformed / reload": **PASS** — all three covered by the new test file.

## Out-of-scope audit

- Out of scope "New tool declaration shapes": **CLEAN** — only `loadUserTools` and its parser are used; no schema changes.
- Out of scope "Remote tool-declaration fetch": **CLEAN** — no network code.
- Out of scope "Per-thread user-tool allowlists": **CLEAN** — allowlist logic remains with F22 `allowedTools`.

## QA aggregate

`pnpm typecheck` / `pnpm lint` / `pnpm test` (1045/1045) / `pnpm build` (~392 KB) all PASS.

## Integration gate

- Entry points scanned: `src/main.ts`.
- New public module: `src/tools/user/wireUserTools.ts`.
- Anchors (basename + exported symbols): `wireUserTools`, `USER_TOOLS_RELOAD_COMMAND_ID`, `UserToolsFileEvents`, `UserToolsWiring`, `WireUserToolsOptions`, `UserToolsRegistry`, `UserToolsCommandRegistrar`, `UserToolEventKind`.
- `src/main.ts` imports `wireUserTools`, `UserToolsFileEvents`, `UserToolsWiring` from `@/tools/user/wireUserTools` and references `this.userTools` throughout the lifecycle → **anchor match**.
- Orphan delta: `src/tools/user/userToolsLoader.ts` removed (now reachable). Orphan count 43 → 42.

Verdict: PASS.

## Verdict: PASS
