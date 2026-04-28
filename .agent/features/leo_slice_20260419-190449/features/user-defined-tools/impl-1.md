# Impl iteration 1 — F40 user-defined-tools

## Summary

Added `UserToolsLoader` at `src/tools/user/userToolsLoader.ts` that scans `.leo/tools/*.json` through the `VaultAdapter`, parses each file with a hand-rolled declaration parser (matching project convention vs the Zod spec), rejects id collisions with built-ins, and registers each valid declaration as a `ToolSpec<unknown, unknown>` with `source: 'user'`. Two impl kinds: `vault-op` (read / create / append) reuses the F16 `read_note` path-traversal guard (`isSafeVaultPath`) and routes through the adapter's `read` / `write` surface; `js` impl compiles the snippet once via `new Function(ctx, args, ...)`, exposes a narrow sandbox context `{vault, logger, signal}` only (no `app`, no `window`, no `require`, no `fetch`), wraps every invocation in try/catch so thrown errors coerce to `{ok:false, error}`, and honours `signal.aborted` before + after the snippet runs. Confirmation policy: `js` declarations are force-`true` regardless of declaration; `vault-op` with `op: 'read'` defaults `false` (opt-in to `true`); `vault-op` with `op: 'create'|'append'` defaults `true`. Load-time failures (missing fields, bad JSON, unknown `impl.kind`, id collision) emit `tool.user.load.error` via the logger + a user `Notice` and skip the offending declaration without aborting the loader. Successes emit `tool.user.load.ok`.

## Files touched

- `src/tools/user/userToolsLoader.ts` — new 230-line module. Exports `loadUserTools(opts)`, `parseDeclaration(raw)`, `buildSpec(decl, opts)`, `USER_TOOLS_DIR = '.leo/tools'`, `UserToolDeclaration` / `VaultOpDeclaration` / `JsDeclaration` / `UserToolsLoaderOptions` / `ToolRegistryLike` types.

## Tests added or updated

- `tests/unit/userToolsLoader.test.ts` — 26 cases covering AC1–AC8:
  - **parseDeclaration**: valid vault-op-read / vault-op-create-with-contentArg / js; rejects missing contentArg on create, missing fields, unknown `impl.kind`, non-boolean requiresConfirmation (AC2).
  - **buildSpec confirmation semantics**: vault-op create/append defaults true; vault-op read defaults false; vault-op read can opt in to true; js is always-true regardless of declaration (AC4).
  - **vault-op invoke**: read returns `{path, content}`, not-found → `not found: <path>`, create writes bytes + `{op:'create'}`, traversal-guard rejects `..` + leading `/` → `'unsafe path'`, append concatenates with newline separator, pre-aborted signal → `aborted` with no side-effects (AC5).
  - **js impl invoke**: happy path returns raw value as `data`, `{ok:true, data}` wrapper respected, thrown errors coerce to `{ok:false, error}`, pre-aborted signal → `aborted` without running the snippet, sandbox exposes only `{signal, vault}` + no `app/window/require/fetch` (AC6).
  - **loadUserTools**: scans `.leo/tools/*.json` + registers valid decls (AC1), skips invalid JSON / missing fields + logs `tool.user.load.error` (AC2), rejects id collisions with pre-existing registrations (AC3, AC7).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Hand-rolled declaration parser instead of Zod.** Project convention throughout — every feature since F16 ships hand-rolled `validate` predicates (no Zod dependency in package.json). `parseDeclaration` covers the same field-required / type-check / enum surface the Zod schema would, and tests assert the same rejection contracts.
- **Loader does NOT emit `tool.user.load.ok` with `{toolId, source, durationMs}` per-tool.** Feature AC7 lists per-tool load telemetry; implementation emits `{toolId, source}` but no `durationMs` at load time (load is synchronous-per-file and unmeasured here). `tool.invoke.start/ok/error` events inherit from F16's `ToolRegistry.invoke` unchanged — those already carry `durationMs`.
- **JS sandbox uses `new Function()` with a narrow `ctx` object.** Feature + tech-stack explicitly pick this trade-off; this is not true isolation (renderer-realm). The sandbox `ctx` omits `app`, `window`, `require`, `fetch` by not providing them; lexical access to those globals inside the Function body is still possible in JavaScript, but the declared API surface makes the intent clear. Stronger isolation (Worker / child process) is tracked as a future tech-stack decision.
- **`append` op concatenates with a newline separator** when the existing file does not end with one. Feature says "append" without pinning separator semantics; a newline-safe join preserves most plain-text use cases.
- **No runtime hot-reload of `.leo/tools/*.json`.** Feature Open question §5 acknowledges the SRS is silent; shipped as reload-on-Plugin-reload only.
- **Registration in main.ts parked.** The feature's `Plugin.onload` invocation `const loaded = await loadUserTools({vault, registry: toolRegistry, logger, notice});` belongs to the main.ts composition slice where `toolRegistry`, `vault`, and `notice` are all constructed.

## Assumptions

- `.leo/tools/*.json` declarations are authored by the vault owner (trusted author); the sandbox is a discipline boundary, not a security boundary. The user `Notice` on load failures + the force-`requiresConfirmation: true` on `js` are both defensive.
- `isSafeVaultPath` from the F16 `readNoteTool` is the shared path-traversal predicate; reused verbatim for vault-op ops.
- The declared `parameters` JSON Schema is passed through to the provider's OpenAI `tools` array verbatim (no JSON-Schema → Zod compilation in this slice — project-wide pattern is to keep JSON Schema as-is for the OpenAI tools parameter).
- `ToolRegistry.register` throws on duplicate id. The loader uses `registry.lookup(id) === undefined` as a pre-check so the collision error message is clearer than the generic dup-error.

## Open questions

- Sandbox boundary strength (feature Open question §1) — parked.
- Declaration format JSON-only (feature Open question §2) — shipped as JSON only.
- Cross-skill discoverability (feature Open question §3) — UI concern; deferred.
- Network / fetch access in js impls (feature Open question §4) — not provided; would require a per-domain permission model.
- File-system reload (feature Open question §5) — reload-on-Plugin-reload only.
- JSON-Schema dialect (feature Open question §6) — passed through verbatim; validation happens at the LLM provider boundary and at tool invoke time via each tool's `validate()`.
