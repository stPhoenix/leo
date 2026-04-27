# Compliance iteration 1 — F13 logging-bundle

## Acceptance criteria

- AC1: PASS — `loggingNamespaces.ts:9-39` exports `EXTERNAL_AGENT_LOG`; typecheck clean across slice.
- AC2: PASS — `subgraph.ts:128-131` calls `logger?.debug('externalAgent.subgraph.transition', { runId, threadId, phase })` on every transition (verifiable by grep). F03 happy-path test exercises the path indirectly.
- AC3: PASS — `loggingPolicy.test.ts` scans every slice source file (`src/agent/externalAgent/**` + `src/tools/builtin/delegateExternal.ts`). For every `logger.info|warn|error` call, asserts no `SENSITIVE_FIELD_KEYS` member appears.
- AC4: PASS — `pnpm check:bundle` reads `main.js` size, compares against `.agent/budgets/bundle-baseline.json`, fails when delta > `maxDeltaBytes` (30 KB). Verified manually (delta 0 today; bumping bundle past cap produces clear failure message).
- AC5: PASS — `package.json` exposes `check:bundle` script (run after `build`). Failure message includes both delta and cap with KB-format hint.
- AC6: PASS — `loggingPolicy.test.ts:NFR-EXT-02 — adapter file imports are restricted` reaffirms the rule via pure-text scan; ESLint override from F01 also enforces.

## Scope coverage

- In scope `Logger namespace constants`: PASS — `EXTERNAL_AGENT_LOG`.
- In scope `Logging policy lint test`: PASS — 32 cases.
- In scope `Bundle-size assertion script + budget threshold`: PASS — `scripts/checkBundle.mjs` + `.agent/budgets/bundle-baseline.json`.

## Out-of-scope audit

- Out of scope `General logging refactor`: CLEAN.
- Out of scope `Per-adapter bundle measurement`: CLEAN.
- Out of scope `Telemetry / Langfuse changes`: CLEAN.

## QA aggregate

PASS (typecheck + lint + tests + build + check:bundle all green; +32 tests). Integration gate: `loggingNamespaces.ts` is library-style (no entry-point reference required); the lint test runs in CI via `pnpm test`. `check:bundle` is invoked by humans / CI after `build` per AC5.

## Verdict: PASS
