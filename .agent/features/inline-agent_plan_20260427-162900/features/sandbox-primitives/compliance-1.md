# Compliance iteration 1 — F03 sandbox-primitives

## Acceptance criteria
- AC1 (mode 0o700 under tempDir/leo-inline-agent/<runId>): PASS — `sandbox.test.ts` "init() creates directory ... mode 0o700" stat-checks `mode & 0o777 === 0o700` on POSIX. `Sandbox.init` calls `fs.mkdir(root, { mode: 0o700 })`.
- AC2 (path traversal rejection): PASS — `sandbox.test.ts` "resolve() rejects path traversal" covers `../etc/passwd`, `/etc/passwd`, and `legit/../../escape`.
- AC3 (symlink rejection): PASS — `sandbox.test.ts` "checkSafe() rejects symlink nodes" creates a real symlink in the sandbox pointing to a sibling tempfile and asserts rejection. Skipped on Windows where `symlinkSync` requires admin rights.
- AC4 (cleanup runs in finally regardless of exit): PASS — `sandbox.test.ts` "Adapter sandbox lifecycle" runs the adapter end-to-end and verifies the sandbox dir is gone after the iterator drains. `index.ts:start()` wraps the F16 stub between `try { ... } finally { await sandbox.cleanup(); }` — early `return`/`throw`/`break` from the iterator triggers the `finally` block on `for await` exit.
- AC5 (`addBytes` projection): PASS — `sandbox.test.ts` "addBytes/willExceedQuota track projected total" exercises both directions and the `> quotaBytes` boundary.
- AC6 (no `ENOENT` past boundary, fs/promises): PASS — every `fs` call in `sandbox.ts` either swallows the error (`cleanup`, `sweepOrphans`) or maps it to a typed result (`init` → `sandbox_collision`/`sandbox_init_failed`; `checkSafe` → `not_found`). Verified by "checkSafe() returns not_found" and "sweepOrphans is no-op when root dir absent".
- AC7 (sweepOrphans mtime > 1h): PASS — `sandbox.test.ts` "sweepOrphans removes stale dirs and skips fresh ones" sets mtime to 2h ago vs now and asserts only the stale dir is removed. Construction-time invocation: `index.ts:78-81` (`Sandbox.sweepOrphans` called inside the constructor with `.catch` swallow + warn log).

## Scope coverage
- In scope "Sandbox class with sweepOrphans/init/resolve/checkSafe/bytes/addBytes/cleanup": PASS — all methods present in `sandbox.ts` and exported via `inlineAgent/index.ts`.
- In scope "Adapter `start()` calls init() before any tool wiring; cleanup() runs in finally": PASS — `index.ts:start()` body.
- In scope "Unit tests covering ...": PASS — 13 dedicated cases + 1 lifecycle integration case.

## Out-of-scope audit
- Out of scope "File-op tool factories (F08)": CLEAN — no tool factories shipped this slice.
- Out of scope "write_file's actual byte accounting": CLEAN — `addBytes` is exposed but not called from any tool yet (F08 will).
- Out of scope "Symbolic-link content normalization for hard links": CLEAN — only lstat-based symlink detection.

## QA aggregate
`qa-1.md` verdict PASS — typecheck/lint/test/build all green; 1630/1630.

## Verdict: PASS
