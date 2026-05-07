# Compliance iteration 1 — F09 canvas-source-planner

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/plan.test.ts` "returns markdown files alphabetically and respects fanoutMax".
- AC2: PASS — "returns files indexed by metadataCache.getTagFiles".
- AC3: PASS — "matches scalar field equality" + "matches array-membership".
- AC4: PASS — "250 sources cap to 200 with droppedCount = 50".
- AC5: PASS — "dedupes same path across hints; keeps first-resolved hint".
- AC6: PARTIAL — deterministic kind order verified by "orders by mention < url < ..."; explicit byte-snapshot against `tinyVault` deferred per Deviation note.
- AC7: PASS — `attachment` hint maps 1:1 in "mention/url/attachment/conversation map to single item".

## Scope coverage
- In scope "`expandSourceHints({...}) → { items, droppedCount }`": PASS — `src/agent/canvas/plan.ts:42-77`.
- In scope per-kind expanders: PASS — `src/agent/canvas/plan.ts:79-145`.
- In scope deterministic ordering: PASS — `KIND_ORDER` map + alpha tie-break.
- In scope dedupe + fanout cap: PASS — `src/agent/canvas/plan.ts:64-76`.

## Out-of-scope audit
- Out of scope "Source body fetching": CLEAN — F10 owns.
- Out of scope "Source body extraction": CLEAN — F11 owns.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
F09 has no wiring bullet in `### In scope`. Module will be imported by F10/F16. Not yet referenced from `src/main.ts`. Confirmed intentional.

## Verdict: PASS
