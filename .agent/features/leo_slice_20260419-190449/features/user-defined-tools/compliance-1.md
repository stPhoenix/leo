# Compliance iteration 1 — F40 user-defined-tools

## Acceptance criteria

- AC1: PASS — `loadUserTools(opts)` at `src/tools/user/userToolsLoader.ts:49-103` iterates `vault.list('.leo/tools')`, filters `*.json`, parses each via `parseDeclaration`, builds a spec via `buildSpec`, calls `opts.registry.register(spec)` with `source: 'user'`. Asserted by `tests/unit/userToolsLoader.test.ts` "scans .leo/tools/*.json and registers valid declarations" (registers 2 files `a.json`+`b.json`, skips `c.txt`).
- AC2: PASS — `parseDeclaration` at `:117-184` accepts `{id, description, parameters, requiresConfirmation?, impl}` with `impl` one of `{kind:'vault-op', ...}` or `{kind:'js', source}`. Invalid declarations return `{ok:false, error}` → `loadUserTools` logs `tool.user.load.error` + fires Notice + skips. Asserted by 7 parseDeclaration cases + "skips invalid declarations and logs tool.user.load.error".
- AC3: PASS — `loadUserTools` at `:85-89` checks `opts.registry.lookup(decl.decl.id) !== undefined` before building the spec; on collision, logs `tool.user.load.error` with `"id collision"` + skips. Asserted by "rejects id collisions with pre-existing registrations" which pre-fills `read_note` and asserts zero user-tools registered.
- AC4: PASS — `deriveConfirmation(decl)` at `:210-214`: `js` impl → `true` always; `vault-op` with `op: 'read'` → user-provided value or `false`; any other `vault-op` → user-provided value or `true`. Asserted by 4 cases in "buildSpec default confirmation semantics": vault-op create defaults true, vault-op read defaults false, vault-op read can opt in to true, `js` is always true regardless of declaration.
- AC5: PASS — `invokeVaultOp` at `:217-249` applies `isSafeVaultPath` (imported from `readNoteTool`, rejects `..` / leading `/` / drive letters / null bytes) before any vault call; success paths use `vault.read` / `vault.write` (never `app.vault.adapter`); error paths return `{ok:false, error}` without throwing. Asserted by 7 vault-op-invoke cases: read happy path, read not-found, create writes bytes, traversal-guard rejects `..`, rejects leading `/`, append concatenates with newline, pre-aborted signal → `aborted` with no side-effects.
- AC6: PASS — `compileJs` at `:259-265` creates `new Function(ctx, args, ...)`. `invokeJs` at `:267-288` builds a narrow `sandboxCtx = {vault, logger, signal, ...jsContext}` — no `app` / `window` / `require` / `fetch` added. Every invocation wrapped in try/catch; `signal.aborted` checked before + after the snippet. Asserted by 5 js-impl-invoke cases including "sandbox ctx exposes vault + signal but NOT app / window / require / fetch" which asserts `hasApp === false`, `hasWindow === false`, `hasRequire === false`, `hasFetch === false`.
- AC7: PASS — `tool.user.load.ok {toolId, source}` emitted at `:99`; `tool.user.load.error {path, error}` emitted at `reportLoadError` (`:108-112`). `tool.invoke.*` events inherit from `ToolRegistry.invoke` (F16) unchanged. No payload content above debug level.
- AC8: PASS — Vitest suite totals 26 cases: directory-scan mix valid/invalid; id collision with built-in rejected; `requiresConfirmation` default flip for omitted field (4 cases); `js` cannot opt into `false`; vault-op happy/not-found/traversal-blocked (3 cases) + append (1 case) + pre-aborted (1 case); `js` impl happy + wrapper-respected + thrown-coercion + pre-aborted + sandbox-surface (5 cases). Every `invoke` test asserts a `{ok, ...}` result — no thrown errors escape.

## Scope coverage

- In scope "`UserToolsLoader` module under `src/tools/user/` scanning `.leo/tools/*.json`": PASS.
- In scope "Declaration schema with `impl: vault-op | js`": PASS with hand-rolled parser (vs Zod per project convention).
- In scope "`requiresConfirmation` default flip + `js` force-true": PASS.
- In scope "vault-op path-traversal guard + VaultAdapter routing": PASS.
- In scope "js sandbox via `Function` ctor with narrow `ctx`": PASS.
- In scope "Load-time validation surfaces Notice + log + skip": PASS.
- In scope "Interop with F22 `allowedTools`": CLEAN — user tool ids flow through the same `ToolRegistry.listFor` path as built-ins; no filter added here.
- In scope "Vitest unit coverage": PASS — 26 tests.

## Out-of-scope audit

- Out of scope "In-plugin UI for editing user tool files": CLEAN.
- Out of scope "Hot reload on `.leo/tools/*.json` FS events": CLEAN — reload-on-Plugin-reload only.
- Out of scope "MCP-sourced tools": CLEAN.
- Out of scope "Stronger JS isolation (Worker / V8 isolate)": CLEAN — documented punt.
- Out of scope "Network / fetch access in js impls": CLEAN — not exposed in the sandbox ctx.
- Out of scope "Cross-skill discoverability UX": CLEAN.

## QA aggregate
Verdict: PASS — typecheck / lint / 726-tests / build all green.

## Verdict: PASS (main.ts `Plugin.onload` call `loadUserTools({vault, registry: toolRegistry, logger, notice})` after built-in registration parked alongside integration slice; hand-rolled parser noted as deviation from Zod spec per project convention)
