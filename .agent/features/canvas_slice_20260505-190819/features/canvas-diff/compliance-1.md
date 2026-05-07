# Compliance iteration 1 — F14 canvas-diff

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/diff.test.ts` "kept when in both".
- AC2: PASS — "added when in new but not sidecar".
- AC3: PASS — "removed when in sidecar but not current canvas".
- AC4: PASS — "drift Δx = 20 → locked: true" + "drift Δx = 8 → locked: false".
- AC5: PASS — "uses max(|Δx|, |Δy|) — y-axis drift triggers lock".
- AC6: PASS — "sidecar edge missing in current canvas → edgesRemoved".
- AC7: PASS — "new edges always re-emit (not tombstoned)".
- AC8: PASS — `tryParseCurrentCanvas` "returns Err canvas_parse_failed for malformed".
- AC9: PASS — `buildTombstoneSummary` "matches snapshot wording".
- AC10: PASS — `clearTombstonesByName` "clears tombstone when refined plan re-asks for the name".

## Scope coverage
- In scope `diffAgainstSidecar(...)`: PASS — `src/agent/canvas/diff.ts:34-92`.
- In scope `DiffResult` shape: PASS — exported types.
- In scope locked-coord map: PASS — `lockedCoords` populated when drift exceeds threshold.
- In scope edge tombstones via triple difference: PASS — `src/agent/canvas/diff.ts:78-89`.
- In scope `buildTombstoneSummary`: PASS — `src/agent/canvas/diff.ts:96-114`.
- In scope `tryParseCurrentCanvas`: PASS — `src/agent/canvas/diff.ts:120-138`.
- In scope tombstone-clearing helper: PASS — `clearTombstonesByName` at `src/agent/canvas/diff.ts:140-160`.

## Out-of-scope audit
- Out of scope "Free-space placement of added": CLEAN — F13 owns; F14 supplies `addedIds` only.
- Out of scope "Sidecar persistence": CLEAN.
- Out of scope "Refine sub-agent": CLEAN.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
F14 has no wiring bullet. Module imported by F16 (subgraph) and F20 (content-edit tool). Not yet referenced from `src/main.ts`. Confirmed intentional.

## Verdict: PASS
