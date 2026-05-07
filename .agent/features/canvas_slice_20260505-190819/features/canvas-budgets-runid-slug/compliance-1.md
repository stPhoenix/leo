# Compliance iteration 1 — F04 canvas-budgets-runid-slug

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/budgetsRunIdSlug.test.ts` "exposes expected NFR-CANVAS-10 values" asserts every constant; `CANVAS_BUDGETS as const` at `src/agent/canvas/budgets.ts:1-15`.
- AC2: PASS — "formats YYYYMMDD-HHmmss-<tail> deterministically" asserts `'20260505-193824-abcdef'`.
- AC3: PASS — "produces kebab leaf + 6-hex SHA-256 suffix" asserts `/^conf-2026-q1-[0-9a-f]{6}$/`.
- AC4: PASS — "distinct paths sharing leaf produce different slugs" — both leafs are `notes` but full paths differ → different SHA-256 → different slugs.
- AC5: PASS — "normalizes spaces and unicode; never contains '/' or '..'" + "falls back to 'canvas' prefix when leaf normalizes to empty".

## Scope coverage
- In scope "`src/agent/canvas/budgets.ts` exporting `CANVAS_BUDGETS`": PASS — `src/agent/canvas/budgets.ts:1-17`.
- In scope "`src/agent/canvas/runIdRegistry.ts` exporting `generateCanvasRunId`": PASS — `src/agent/canvas/runIdRegistry.ts:32-36`.
- In scope "`src/agent/canvas/slug.ts` exporting `canvasPathToSidecarSlug` + `parseSidecarSlug`": PASS — `src/agent/canvas/slug.ts:20-37`.
- In scope "Pure functions only — no IO, no clock leakage (clock injected for tests)": PASS — `now`/`tail` factories injectable; SHA-256 reads no FS, only Web Crypto.

## Out-of-scope audit
- Out of scope "Mutex bookkeeping": CLEAN.
- Out of scope "Sidecar persistence": CLEAN.
- Out of scope "Settings UI": CLEAN.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
F04 is a foundation feature; no wiring bullet in `### In scope`. Modules will be referenced by F05–F23 consumers; not yet imported from `src/main.ts`. Confirmed intentional per features-index.md dependency graph.

## Verdict: PASS
