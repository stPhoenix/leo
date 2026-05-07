# Compliance iteration 1 — F07 canvas-sidecar

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/sidecar.test.ts` "write then read returns equal value".
- AC2: PASS — "schemaVersion: 2 returns null and logs warn".
- AC3: PASS — "returns null" for missing file.
- AC4: PASS — "returns Err with sidecar_corrupt" + "valid JSON but invalid schema".
- AC5: PASS — "write target normalizes to .leo/canvas/runs/<slug>.json".
- AC6: PASS — "atomic write: failure during rename leaves no partial sidecar, tmp cleaned".
- AC7: PASS — covered transitively by `tests/unit/canvas/budgetsRunIdSlug.test.ts` "distinct paths sharing leaf produce different slugs".

## Scope coverage
- In scope "`src/agent/canvas/sidecar.ts` exporting `readSidecar`/`writeSidecar`": PASS — `src/agent/canvas/sidecar.ts:30-95`.
- In scope "`SidecarV1` Zod schema matching SRS §6 shape": PASS — `src/agent/canvas/schemas.ts:115-128`.
- In scope "Path confinement: write target derived via slug helper": PASS — `sidecarPathFor` at `src/agent/canvas/sidecar.ts:24-27`.
- In scope "schemaVersion mismatch → null + warn": PASS — `src/agent/canvas/sidecar.ts:51-58`.
- In scope "Atomic write: tmp + rename": PASS — `src/agent/canvas/sidecar.ts:78-93`.

## Out-of-scope audit
- Out of scope "EntityGraph schema (F12 owns)": colocated in `schemas.ts` per Deviation note in impl-1.md — schema is the *contract*; F12 owns the *algorithm* that produces values matching it. CLEAN intent-wise.
- Out of scope "Coord-map diff logic": CLEAN — F14 will own diff.
- Out of scope "Sidecar deletion / GC": CLEAN.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
F07 has no wiring bullet in `### In scope`. Module will be imported by F14/F15/F20/F21/F22 consumers; not yet referenced from `src/main.ts`. Confirmed intentional.

## Verdict: PASS
