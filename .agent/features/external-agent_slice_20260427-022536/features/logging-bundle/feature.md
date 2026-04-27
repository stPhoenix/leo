# F13 — Logging hygiene + bundle budget

## Purpose

Two cross-cutting hygiene items the SRS calls out: (1) every external-agent state transition + (eventual) adapter event flows through the existing `Logger` under a dedicated namespace, with payload content gated to `debug` level so refined-prompt and response text never leak into `info`+ logs; (2) the bundle-size impact of the v1 external-agent slice (contract + plumbing + UI + settings; concrete adapters deferred) stays within the budget.

Implements [`context.md`](../../context.md) NFR-EXT-05 and NFR-EXT-06.

## Scope

**In scope**
- Add a `LogNamespace` constant `externalAgent` in `src/platform/Logger.ts` (or alongside the existing namespace declarations) plus child namespaces:
  - `externalAgent.subgraph` — state transitions, slot acquire/release.
  - `externalAgent.adapter` — adapter events received (event type + level only at `info`; full payload at `debug`).
  - `externalAgent.writer` — folder/file writes.
  - `externalAgent.tool` — `delegate_external` confirmation outcomes.
- Logging policy enforced by review checklist + a small lint helper (or grep test): no string literal beginning with `'externalAgent.'` at a level above `debug` may include the substring `refinedAsk`, `refinedPrompt`, `responseText`, or `textBuffer`. Verified by a Vitest "lint" test that scans `src/agent/externalAgent/` source files.
- esbuild bundle-size assertion: a `pnpm run check:bundle` task (extending the existing build) compares the size delta of `main.js` minified before/after the external-agent slice and fails CI if the delta exceeds 30 KB. Threshold matches NFR-EXT-06's revised value (concrete adapters track their own budget separately when added later).
- Documentation update in [`.agent/standards/best-practices.md`](../../../../standards/best-practices.md) **not** required — keep policy in code/tests, not docs (per "no narrating obvious code" rule and per the Operating Rule "Do not create additional files without asking" — applies to docs too).

**Out of scope**
- General logging refactor across the rest of the codebase.
- Per-adapter bundle measurement (deferred along with concrete adapters F09 / F10).
- Telemetry / Langfuse integration changes (separate concern; existing tracer at `src/platform/tracer.ts` continues to operate).

## Acceptance criteria

1. `src/platform/Logger.ts` exports the new namespace constant(s); references compile across all features F01–F12.
2. Every `subgraph.transition(...)` call (in F03 / F04 / F05) is preceded by a `logger.debug('externalAgent.subgraph.transition', { from, to, runId })`. Verified by inspection + a unit test that mocks the logger and asserts the call sequence for a happy-path mock-adapter run.
3. The Vitest lint test scans every `*.ts` under `src/agent/externalAgent/` and `src/tools/builtin/delegateExternal.ts`. For every `logger.<info|warn|error>(...)` call, asserts the second argument (when an object) does NOT contain the keys `refinedAsk`, `refinedPrompt`, `responseText`, `textBuffer`. Honors NFR-EXT-05.
4. `pnpm run check:bundle` (or equivalent npm script extension) builds the bundle, reads `main.js` byte size, compares against a checked-in baseline file, and fails if the delta exceeds 30 KB. Implementation: a small Node script under `scripts/checkBundle.mjs` (creating `scripts/` if absent — flag this as a new directory before adding).
5. CI integration: existing CI pipeline (referenced from `package.json` scripts in [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md) §"Test suites") runs `check:bundle` after `build`. Failure produces a clear diff message including the offending size delta.
6. Logger calls in adapter implementations (when adapters land in a follow-up phase) are *not* allowed — adapters surface logs as `ExternalEvent.log` events, which the subgraph then logs through `externalAgent.adapter.<event-type>`. Honors NFR-EXT-02 (adapter isolation) and the contract from F01.

## Dependencies

- **F01** — uses contract types in lint scan and event-shape mapping in `externalAgent.adapter` namespace.
- **F08** — UI doesn't log directly; included as dependency only because the bundle delta is measured *after* F08 lands. (Listing F08 keeps the bundle baseline meaningful.)
- **F11** — same reason as F08.
- Cross-doc:
  - [`context.md#nfr-ext-05`](../../context.md#non-functional-requirements)
  - [`context.md#nfr-ext-06`](../../context.md#non-functional-requirements)

## Implementation notes

- Logger discipline — levels and structured key/value per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §Logging.
- Existing logger module location — `src/platform/Logger.ts` per [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md).
- Bundle budget conventions — [`.agent/standards/tech-stack.md`](../../../../standards/tech-stack.md) §"Bundle Budget".
- esbuild config — extend in `esbuild.config.mjs` per [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md).
- Lint pattern — Vitest test file under `tests/unit/externalAgent/loggingPolicy.test.ts`; pure-text scan, no AST parser dependency added.
- Architecture layer — `Logger` is Adapter layer per [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3.4; this feature only adds named namespaces, no structural change.

## Open questions

- **OQ-01-F13** Should the lint test also forbid `console.log` in `src/agent/externalAgent/` source? **Proposed**: yes — single-rule extension; aligns with [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §Logging ("No `console.log` in committed code").
- **OQ-02-F13** Bundle baseline file location — `.agent/budgets/bundle-baseline.json` vs root `bundle-baseline.json`. **Proposed**: `.agent/budgets/` (groups planning/standards/budgets under `.agent/`); creating the directory needs explicit confirmation per Operating Rule 5 — flag during implementation.
- **OQ-03-F13** Should the lint scan also flag `Notice(...)` calls (Obsidian user-visible toast) carrying refined-prompt content? Likely yes — but `Notice` is rarely used in this slice; defer to a wider lint pass.
