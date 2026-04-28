# F65 — Wire user-defined tools loader

## Purpose

Close the integration gap left by F40. `UserToolsLoader` ships with a parser, vault-op implementations, and a JS sandbox, but is never invoked from `main.ts`. This feature wires the loader on `onload` so user-authored tool declarations in `.leo/tools/` are registered on the shared `ToolRegistry` at startup and re-loaded on file change.

## Scope

### In scope

- Construct a `UserToolsLoader` in `main.ts.onload` with the existing `VaultAdapter` + `ToolRegistry` + `Logger`.
- On `onload`, call `loader.loadAll()` after the built-in tools register; the loader parses every file under `.leo/tools/` and registers each declaration as a `ToolSpec` on the `ToolRegistry`.
- Register `registerEvent` listeners on the vault for `.leo/tools/**` `create` / `modify` / `delete` / `rename`; route to `loader.reload(path)` so a user can edit a tool file and see it refresh without reload.
- Register a `Leo: Reload user tools` command in the palette.
- On `onunload`, `toolRegistry.unregister` every user tool and stop listeners.
- Unit tests: loadAll registers a valid declaration; a malformed file surfaces a `Logger.warn` and does not crash load; reload picks up a file edit.

### Out of scope

- New tool declaration shapes beyond what F40 already codified.
- Remote tool-declaration fetch.
- Per-thread user-tool allowlists (F22 `allowedTools` covers this).

## Acceptance criteria

1. Orphan `tools/user/userToolsLoader.ts` becomes reachable from `src/main.ts`; §5.4 audit removes it.
2. `loader.loadAll()` runs after built-in tools register; user tools appear in `toolRegistry.toOpenAITools(thread)` alongside built-ins.
3. Creating a new `.leo/tools/<name>.json` file registers the tool without reload; deleting the file unregisters it.
4. A malformed tool file (e.g., missing `name` field) emits `user-tools.load.error` via `Logger.warn` and is skipped; other tools in the same directory continue to register.
5. Command `Leo: Reload user tools` re-runs `loader.loadAll()`.
6. All existing tests stay green; new tests added per §Scope.

## Dependencies

F16 (tool registry) · F40 (user tools loader). All `feature-complete`.

## Implementation notes

- [Architecture §3.4 Adapters — Tools](../../../../architecture/architecture.md#34-adapters) — user tools share the same `ToolRegistry` as built-in tools; the loader just registers specs.
- F40 compliance-1 calls out "main.ts loader invocation parked".

## Open questions

- Should user tools default to `requiresConfirmation: true` unless the declaration explicitly opts out? Default: yes, mirroring F52's MCP default, so a malicious / bugged local declaration cannot silently run write ops.
