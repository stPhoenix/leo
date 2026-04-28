# Impl iteration 1 — F13 logging-bundle

## Summary

Shipped two cross-cutting hygiene items: (1) a canonical namespace surface in `loggingNamespaces.ts` (`EXTERNAL_AGENT_LOG.subgraph|adapter|writer|tool|refine|persist`) plus a `SENSITIVE_FIELD_KEYS` allowlist that drives the lint scan; (2) a `pnpm check:bundle` script that compares the production `main.js` byte size against `.agent/budgets/bundle-baseline.json` and fails when the delta exceeds 30 KB. The lint test (`tests/unit/externalAgent/loggingPolicy.test.ts`) scans every `.ts` under `src/agent/externalAgent/` and `src/tools/builtin/delegateExternal.ts` and rejects sensitive field keys (`refinedAsk`, `refinedPrompt`, `responseText`, `textBuffer`, `originalAsk`, `clarifyingQuestion`) at `info|warn|error` level, plus any `console.{log,info,warn,error,debug}` call (per OQ-01-F13). A separate scan reaffirms the adapter import-restriction rule (NFR-EXT-02). Existing logger call sites already used the canonical event names (`externalAgent.subgraph.transition`, `externalAgent.write.ok`, etc.); the new `EXTERNAL_AGENT_LOG` constant is the documentation surface for adapters / future maintainers.

## Files touched

- `src/agent/externalAgent/loggingNamespaces.ts` — new canonical event namespace + sensitive field-key list.
- `tests/unit/externalAgent/loggingPolicy.test.ts` — 32 tests (per-file sensitive-key scan + per-file console scan + adapter import scan).
- `scripts/checkBundle.mjs` — new node script comparing `main.js` size against baseline (creates `scripts/` directory).
- `.agent/budgets/bundle-baseline.json` — baseline + delta cap (creates `.agent/budgets/` directory).
- `package.json` — added `check:bundle` script.

## Tests added or updated

- AC1 — `EXTERNAL_AGENT_LOG` exports compile across all features (typecheck + tests pass).
- AC2 — Existing `externalAgent.subgraph.transition` calls flow through `Logger.debug` in `subgraph.ts:128-131` (verified visually); F03's happy-path test indirectly exercises the path (no regression).
- AC3 — `loggingPolicy.test.ts` scans every `*.ts` under the slice, asserts none of the 6 sensitive keys appear in `info|warn|error` payloads.
- AC4 — `pnpm check:bundle` exits 0 today (delta 0 against fresh baseline); exits 1 with a clear delta message when budget exceeded.
- AC5 — `package.json` exposes `pnpm check:bundle` for CI integration; recommended order is `pnpm build && pnpm check:bundle` (documented in the script's failure message).
- AC6 — `loggingPolicy.test.ts` "adapter file imports are restricted" reaffirms the rule with a pure-text scan; ESLint override from F01 enforces at lint time.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- New directories `scripts/` and `.agent/budgets/` were created (per the spec's flagged `OQ-02-F13` + Operating Rule 5). These are tooling-tier directories with one file each; both are required for the bundle-budget check to function. Documenting here as a deliberate addition.
- Existing logger call sites already used the canonical event strings (`externalAgent.write.ok`, etc.) — F13 added the `EXTERNAL_AGENT_LOG` constant alongside rather than rewriting every call site. The lint test enforces field-key hygiene regardless of whether call sites read from the constant or use the literal string, so the constants are documentation + autocomplete surface, not the only source of truth.
- The bundle-budget mechanism is delta-based (baseline + cap) rather than absolute: at slice landing the baseline = current size; future commits whose `main.js` grows by >30 KB fail until the baseline is consciously updated.

## Assumptions

- Per OQ-01-F13: console calls forbidden in slice source.
- Per OQ-02-F13: baseline at `.agent/budgets/bundle-baseline.json`.
- Per OQ-03-F13: `Notice(...)` not scanned in this iteration; deferred to a wider lint pass.

## Open questions

OQ-01/02/03-F13 honored / deferred per spec proposal. No new open questions.
