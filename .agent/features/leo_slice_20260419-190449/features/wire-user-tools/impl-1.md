# Impl iteration 1 — F65 wire-user-tools

## Summary

Added `wireUserTools` helper that owns F40's `loadUserTools` lifecycle: it loads every declaration under `.leo/tools/` at mount, reloads on vault events (create / modify / delete / rename), registers a `Leo: Reload user tools` palette command, and on `dispose()` unregisters every tool plus detaches listeners. Wired it into `main.ts.onload` after the built-in tools register and into `onunload` ahead of sink flush. The previously-orphan `src/tools/user/userToolsLoader.ts` is now reachable from `src/main.ts` through this wiring.

## Files touched

- `src/tools/user/wireUserTools.ts` — new wiring module: tracked-id shim over `ToolRegistry`, serialized reload chain, file-events seam, command-registrar seam, dispose.
- `src/main.ts` — import `wireUserTools`; add `userTools: UserToolsWiring | null = null` field; construct after `searchVaultTool` registration with an inline Obsidian vault-events adapter; dispose in `onunload` after the indexer.
- `tests/unit/wireUserTools.test.ts` — new test file, 8 cases covering loadAll, malformed skip, event-driven add/delete, out-of-dir filter, palette command, dispose, built-in collision guard.

## Tests added or updated

- `tests/unit/wireUserTools.test.ts` — covers AC2 (loadAll + registry visibility), AC3 (create/delete via event), AC4 (malformed skip + warn), AC5 (palette command), AC6 (existing tests unchanged — all 1045 green), plus built-in id-collision and dispose behaviour.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The loader ships as functions (`loadUserTools` / `parseDeclaration` / `buildSpec`) not as a `UserToolsLoader` class. The wiring wraps those functions and exposes `reload` / `dispose` from the helper directly, preserving the spirit of "Construct a loader with a `.reload(path)` method" without renaming F40's public surface.
- Reloads are coalesced: any event under `.leo/tools/` triggers a full `loadUserTools` pass on a serialized promise chain rather than a per-path `reload(path)`. Simpler, idempotent, and matches the loader's `clear + re-scan` shape.

## Assumptions

- Registering the wiring after `searchVaultTool` and before `AgentRunner` is acceptable — the agent picks up new tool ids at invocation time via `toolRegistry.toOpenAITools(thread)`, which already happens lazily.
- Obsidian's `registerEvent` auto-detaches event refs on plugin unload, so `dispose()` only needs to call `offref` for the explicit reload-chain teardown path.

## Open questions

None — the feature.md open question (default `requiresConfirmation: true` for user tools) is already enforced by `buildSpec` in F40 (`vault-op` write/append default `true`; `js` forced `true`).
