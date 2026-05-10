# Compliance iteration 1 — F05 openfang-adapter

## Acceptance criteria
- AC1 (zero-arg constructor, no plugin handles): PASS — `index.ts:71-79` static fields only; "OpenfangAdapter constructs with zero arguments" test.
- AC2 (`AsyncIterable<ExternalEvent>` per contract): PASS — `start()` is `async *` returning the contract types.
- AC3 (config validation runs first; invalid → one `error`): PASS — `index.ts:96-102` + "invalid_config" test (`onUnhandledRequest:'error'` proves no HTTP fired).
- AC4 (insecure-transport blocks http://): PASS — `index.ts:105-122` + "insecure_transport" test.
- AC5 (4 codes + fallback, never throws): PASS — `failureDecoder.ts` + 7-row decoder table.
- AC6 (status × context map): PASS — `httpErrorMapping.ts` + 12-row mapper table.
- AC7 (cancel: cancelTask once, ≤ 2 s, `cancelled` error): PASS — `index.ts:153-159` + "cancel during poll" test (elapsed < 3 s, `cancelCalls === 1`).
- AC8 (text precedes file): PASS — `index.ts:215-217` (text yielded before `downloadArtifacts`); "happy path" assertion.
- AC9 (data parts → fenced ```json``` block after text): PASS — `index.ts:60-68` + "data parts render as fenced JSON".
- AC10 (no API key in any log): PASS — "happy path … no API key in any log" + `redactFields` helper.
- AC11 (decoder + mapper are pure): PASS — modules import only types; vault-isolation test confirms no platform/storage/UI imports.
- AC12 (ESLint passes vs all 4 files): PASS — `pnpm lint` 0 errors.

## Scope coverage
- In scope `OpenfangAdapter` class with all 5 static fields: PASS — `index.ts:71-77`.
- In scope `start()` orchestration: PASS — 11-step flow implemented; `cancelled`-task short-circuit added on top.
- In scope `failureDecoder.ts`: PASS.
- In scope `httpErrorMapping.ts`: PASS.
- In scope adapter unit tests: PASS — covers all 11 listed cases.

## Out-of-scope audit
- Adapter registration in main.ts: CLEAN — no edit to `src/main.ts` in this feature; F06 owns it.
- Storybook: CLEAN.
- ResultWriter integration: CLEAN — adapter only emits `ExternalEvent`.
- Refine sub-agent: CLEAN.
- `delegate_external` tool wiring: CLEAN.
- Widget UI: CLEAN.

## Integration notes
F05 ships the adapter class, but `### In scope` does not contain a wiring bullet (registration is explicitly out of scope per feature.md and is owned by F06). §5.3.1 integration gate: applying the wiring regex to `### In scope` yields no match → gate emits the warning path. Module `src/agent/externalAgent/adapters/openfang/index.ts` is not yet referenced from `src/main.ts` — this is intentional and will be resolved by F06. No `INTEGRATION` gap raised.

§5.3.2 stub-body gate: no wiring bullet in scope; skip.

## QA aggregate
QA verdict PASS (typecheck/lint/tests/build all 0).

## Verdict: PASS
