# Impl iteration 1 — F04 wiki-runtime-utils

## Summary
Stood up four pure utility modules for the wiki slice: `budgets.ts` (eight `as const` token caps + run defaults), `loggingNamespaces.ts` (`WIKI_LOG` namespace tree + `WIKI_SENSITIVE_FIELD_KEYS`), `runIdRegistry.ts` (`generateWikiRunId`), `liveControllerRegistry.ts` (`Map<runId, controller>` + `WIKI_LIVE_KIND`). No DOM / React / LangGraph imports.

## Files touched
- `src/agent/wiki/budgets.ts` — `WIKI_BUDGETS` (8 token caps), `WIKI_RUN_DEFAULTS` (concurrency + timeouts).
- `src/agent/wiki/loggingNamespaces.ts` — `WIKI_LOG` (bootstrap/ingest/lint/search/mutex/inbox), `WIKI_SENSITIVE_FIELD_KEYS`.
- `src/agent/wiki/runIdRegistry.ts` — `generateWikiRunId({now,tail})` → `YYYYMMDD-HHmmss-<6char>` (22 chars).
- `src/agent/wiki/liveControllerRegistry.ts` — register/release/lookup, idempotent, `clearWikiLiveControllers` for tests, `WIKI_LIVE_KIND='wiki_live'`.

## Tests added or updated
- `tests/unit/wikiBudgets.test.ts` — exact NFR-WIKI-10 token caps (AC1) + defaults sanity.
- `tests/unit/wikiLoggingNamespaces.test.ts` — namespaces grouped by domain, dot-separated lowercase, sensitive keys present (AC2).
- `tests/unit/wikiRunIdRegistry.test.ts` — deterministic given fixed inputs, 22 chars, default tail alphanumeric (AC3).
- `tests/unit/wikiLiveControllerRegistry.test.ts` — register+lookup, register idempotent, release calls dispose+removes, release-of-unknown no-op, dispose throws swallowed, kind constant (AC4).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
None.

## Assumptions
- `WIKI_RUN_DEFAULTS` (concurrency, timeouts, refine clarification cap, cancel deadline) added alongside token budgets — these are also "tunable in code only" knobs cited by FR-30/FR-31/NFR-01/FR-41/FR-26. Co-locating them avoids a parallel constants module later.

## Open questions
None.
