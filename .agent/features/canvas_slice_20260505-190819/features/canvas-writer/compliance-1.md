# Compliance iteration 1 — F15 canvas-writer

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/writer.test.ts` "produces <targetPath>.preview.canvas; round-trips".
- AC2: PASS — "renames preview to target; preview no longer exists; target parses".
- AC3: PASS — "failure (preview missing) leaves target untouched".
- AC4: PASS — "removes preview if present; idempotent".
- AC5: PASS — "Err target_path_exists when path exists".
- AC6: PASS — `writeSidecarFromState` is called only post-`commitPreview` per driver contract; covered by test "only writes after commitPreview success" (the function itself is decoupled, the sequencing is the driver's job per Deviation note).
- AC7: PASS — "rejects invalid target path" + path validators rejected for non-`.canvas` extension.
- AC8: PARTIAL — owned by F16 driver per Deviation note; writer contract is sequential commit + sidecar (no async gap).

## Scope coverage
- In scope `writePreview`: PASS.
- In scope `commitPreview`: PASS.
- In scope `cleanupPreview`: PASS.
- In scope `writeSidecarFromState`: PASS.
- In scope `assertTargetDoesNotExist`: PASS — `TargetExistsError` exported.
- In scope path validation at entry-points: PASS.
- In scope atomic semantics + tmp cleanup on failure: PASS — `tmp` removed in catch.

## Out-of-scope audit
- Out of scope "Coord-map construction": CLEAN.
- Out of scope "Sidecar shape": CLEAN — F07.
- Out of scope "Mutex acquisition": CLEAN.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
F15 has no wiring bullet. Module imported by F16 (subgraph). Not yet referenced from `src/main.ts`. Confirmed intentional.

## Verdict: PASS
