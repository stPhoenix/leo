# Compliance iteration 1 — F05 canvas-logging-namespaces

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/loggingNamespaces.test.ts` "exposes the four roots" + "every shared root carries…" + "reveal root carries probe + invoke + openCanvas events".
- AC2: PASS — `CANVAS_LOG` is declared `as const` (deeply readonly literal types). Mutation would fail typecheck; the type-level guarantee is present in `src/agent/canvas/loggingNamespaces.ts:62`.
- AC3: PASS — `CANVAS_SENSITIVE_FIELD_KEYS` typed `readonly string[]` at `src/agent/canvas/loggingNamespaces.ts:97`; test asserts the documented set.
- AC4: PASS — snapshot test "matches snapshot to keep the surface stable" wrote `tests/unit/canvas/__snapshots__/loggingNamespaces.test.ts.snap`.

## Scope coverage
- In scope "`src/agent/canvas/loggingNamespaces.ts` exporting `CANVAS_LOG`": PASS — file + named export.
- In scope "`CANVAS_SENSITIVE_FIELD_KEYS = …`": PASS — constant exported with documented members.
- In scope "ESLint policy declaration": PASS — file is the canonical reference (mirrors `WIKI_LOG` precedent); no separate ESLint rule file is required (sensitive-field policy is enforced by sink redactor at runtime, not by ESLint).

## Out-of-scope audit
- Out of scope "Logger implementation": CLEAN.
- Out of scope "Per-feature log call sites": CLEAN — only F02/F03 minor reveal calls; declared in tree.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
F05 is a foundation feature with no wiring bullet. Module will be imported by F06–F23 consumers; not yet referenced from `src/main.ts`. Confirmed intentional.

## Verdict: PASS
