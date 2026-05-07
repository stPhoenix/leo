# Compliance iteration 1 — F12 canvas-reducer

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/reduce.test.ts` "dedupes by wikilink target across sources".
- AC2: PASS — "dedupes by normalized name when no wikilink".
- AC3: PASS — "invokes LLM-alias step when ambiguous overlap detected".
- AC4: PASS — "hubs sorted by degree desc, alpha tie-break, capped 5".
- AC5: PASS — "components count + sorted sizes".
- AC6: PASS — "alias-resolver two failures → reduce_invalid".
- AC7: PASS — "empty input → empty graph & insights, no LLM call".

## Scope coverage
- In scope "`reduceEntityGraph(...)`": PASS — `src/agent/canvas/reduce.ts:69-159`.
- In scope "Pure pre-resolution pass (wikilink → URL → normalized-name)": PASS — `canonicalIdFor` at `reduce.ts:161-170`.
- In scope "LLM-alias step invoked only for ambiguous overlaps": PASS — `maybeResolveAliases` short-circuits to empty map when `detectAmbiguousOverlaps` returns nothing.
- In scope schemas via `schemas.ts`: PASS — `EntityGraph`, `Insights`, `Edge` etc. already declared.
- In scope canonical-id format `<type>:<slug>` / `wikilink:<target>` / `url:<href>`: PASS.
- In scope retry on alias-resolver Zod parse: PASS — single retry, then `ReducerInvalidError`.

## Out-of-scope audit
- Out of scope "Diff-against-sidecar": CLEAN — F14 owns.
- Out of scope "Insights rendering": CLEAN — F18/F19/F20/F21 own.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
F12 has no wiring bullet. Module imported by F14/F16/F19/F20/F21. Not yet referenced from `src/main.ts`. Confirmed intentional.

## Verdict: PASS
