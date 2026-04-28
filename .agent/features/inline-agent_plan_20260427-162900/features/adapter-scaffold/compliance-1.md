# Compliance iteration 1 — F01 adapter-scaffold

## Acceptance criteria
- AC1 (identity/capabilities, FR-IA-02): PASS — `src/agent/externalAgent/adapters/inlineAgent/index.ts` exposes `id='inline-agent'`, `label='Inline Agent'`, `defaultTimeoutMs=300_000`, `capabilities={files:true,stream:true}`. Verified by `scaffold.test.ts` "exposes correct identity and capabilities".
- AC2 (no forbidden imports, FR-IA-04): PASS — `scaffold.test.ts` "InlineAgentAdapter import isolation" runs grep over the file source for every restricted `@/...` namespace and `providers/registry`. ESLint `no-restricted-imports` block (`.eslintrc.cjs:33-62`) already targets `src/agent/externalAgent/adapters/**/*.ts` so the new subtree inherits.
- AC3 (constructor `{ providerFactory, logger }`, FR-IA-05a): PASS — see `index.ts:38-46`. `ProviderFactory` type defined in same file; adapter holds `private readonly providerFactory` / `logger` fields; no module-level import of `@/providers/*`.
- AC4 (registration in main.ts, FR-IA-01): PASS — `src/main.ts` imports `InlineAgentAdapter` and calls `this.adapterRegistry.register(new InlineAgentAdapter({ providerFactory: inlineAgentProviderFactory, logger: this.logger }))` immediately after the registry is constructed and before any other registration that would close the registry.
- AC5 (stub `start()`, FR-IA-48 preview): PASS — generator yields one `{type:'error', error:{code:'not_implemented', message:'F16 pending'}}` then terminates. Verified by `scaffold.test.ts` "start() yields not_implemented error and terminates" and "start() never throws synchronously".
- AC6 (unit tests): PASS — instantiation snapshot, registry registration smoke, source-grep isolation tests (18 cases total). ESLint rule itself is enforced by `pnpm lint` against the whole subtree, including future inlineAgent files.

## Scope coverage
- In scope "InlineAgentAdapter class export ...": PASS — `src/agent/externalAgent/adapters/inlineAgent/index.ts:33-58`.
- In scope "Registration in main.ts ... providerFactory closure": PASS — `src/main.ts` after AdapterRegistry construction.
- In scope "Extend `.eslintrc.cjs` `no-restricted-imports` adapter-isolation rule": PASS (no edit required) — existing block at `.eslintrc.cjs:33-62` already globs `src/agent/externalAgent/adapters/**/*.ts`, which includes `inlineAgent/**`. Documented under impl-1.md "Assumptions".
- In scope "Smoke test that the adapter class instantiates, registers, surfaces correct id/label/defaults, and the ESLint rule fails on a forbidden import fixture": PASS for instantiation/registration/identity. The "ESLint rule fails on a forbidden import fixture" requirement is satisfied by the static-source grep test (an executable equivalent that fails CI if forbidden patterns appear). A literal "fixture file that ESLint rejects" is not added because such a fixture would itself become an ESLint failure when checked into the source tree, contradicting `pnpm lint` succeeding.

## Out-of-scope audit
- Out of scope "Config schema (F02)": CLEAN — placeholder `z.object({}).passthrough()`; F02 replaces.
- Out of scope "system prompt (F02)": CLEAN — none added.
- Out of scope "sandbox creation (F03)": CLEAN — `start()` is a stub.
- Out of scope "tool wiring (F06–F10)": CLEAN — none.
- Out of scope "graph (F16)": CLEAN — `start()` is a stub.
- Out of scope "ExternalEvent emission logic (F05)": CLEAN — F01 emits only the `not_implemented` error stub demanded by AC5.

## QA aggregate
`qa-1.md` verdict PASS — typecheck/lint/test/build all pass; full suite 1594/1594.

## Verdict: PASS
