# Compliance iteration 1 — F08 tool-file-ops

## Acceptance criteria
- AC1 (resolve + checkSafe before any IO): PASS — every factory's first step is `sandbox.resolve()` followed by `sandbox.checkSafe()` (or skipped for the `not_found` path on writes). Verified by "read_file: AC1 path-escape rejected" and the Zod-boundary case for each tool.
- AC2 (read_file offset/limit/maxBytes/eof/binary): PASS — three dedicated read_file cases plus the too_large boundary.
- AC3 (write_file parent dir + base64 + quota): PASS — three dedicated write_file cases.
- AC4 (list_dir alphabetical + bytes for files only): PASS — "list_dir: AC4 alphabetical entries with file bytes" + sub-path case + not_found.
- AC5 (delete_file file/dir/non-empty/not_found): PASS — three dedicated delete_file cases.
- AC6 (no thrown ENOENT past boundary): PASS — every fs failure path returns a typed result; `read_file: AC6 missing → not_found typed error (no throw)` enforces it for the most common case; the symmetric handling exists for write/list/delete.
- AC7 (Zod parse rejects malformed input): PASS — "all tools: AC7 Zod boundary rejects malformed input" exercises each.

## Scope coverage
- In scope "schemas.ts file-ops subset": PASS — `tools/schemas.ts` (added in F06 slice).
- In scope "fileOps.ts factories": PASS — `tools/fileOps.ts`.
- In scope "Binary detection inline": PASS — `looksBinary` + dedicated tests.
- In scope "quota_exceeded projection": PASS — `sandbox.willExceedQuota(delta)`.
- In scope "list_dir bytes for files only": PASS — type=`'file'` entries include `bytes`, type=`'dir'` entries do not.
- In scope "Unit tests": PASS — 22 cases.

## Out-of-scope audit
- Out of scope "Recursive delete": CLEAN — non-empty dir → `not_empty`.
- Out of scope "Atomic write semantics": CLEAN.
- Out of scope "File-watching": CLEAN.

## QA aggregate
`qa-1.md` verdict PASS — 1728/1728, lint/typecheck/build green.

## Verdict: PASS
