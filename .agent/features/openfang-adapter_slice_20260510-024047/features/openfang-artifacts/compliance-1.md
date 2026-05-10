# Compliance iteration 1 — F04 openfang-artifacts

## Acceptance criteria
- AC1 (selectFileRefs in-order + tolerates missing): PASS — `artifacts.ts:24-50` + 3 selectFileRefs tests.
- AC2 (dedupeRelPaths uniqueness): PASS — `artifacts.ts:64-79` + 4 dedupe tests.
- AC3 (one file event per success): PASS — `artifacts.ts:86-128` + "happy", "content is always Uint8Array".
- AC4 (404 continues + warn log with `{artifactId,name}`): PASS — `artifacts.ts:113-116` + "404 on one of three".
- AC5 (other errors re-thrown): PASS — `artifacts.ts:117` + "non-404 error re-thrown".
- AC6 (sequential): PASS — `for...of await` loop + "sequential — never parallel" maxInFlight assertion.
- AC7 (Uint8Array content): PASS — `artifacts.ts:122` `content: dl.bytes` (typed `Uint8Array`).
- AC8 (vault isolation): PASS — module imports `../base` (type only) + `./httpClient`; "vault isolation" import-allowlist test.

## Scope coverage
- In scope `selectFileRefs`: PASS.
- In scope `dedupeRelPaths`: PASS.
- In scope `downloadArtifacts` async iterable: PASS.
- In scope unit tests at `artifacts.test.ts`: PASS — all 9 listed cases plus 6 extras.

## Out-of-scope audit
- Text emission: CLEAN — no `text` event yielded.
- File persistence: CLEAN — only emits events.
- Cross-run cache: CLEAN.
- Per-file size caps: CLEAN.

## Integration notes
F04 ships pure logic + IO call into F02's `downloadArtifact`; integration gate skips per §5.3.1 (no wiring bullet — consumed by F05). Stub-body gate skips.

## QA aggregate
QA verdict PASS (typecheck/lint/tests/build all 0).

## Verdict: PASS
