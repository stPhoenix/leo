# Compliance iteration 1 — F02 openfang-http-client

## Acceptance criteria
- AC1 (POST envelope + Bearer + sessionId-when-set): PASS — `httpClient.test.ts` "issues POST with JSON-RPC envelope and Bearer header" + "includes sessionId when provided".
- AC2 (lenient status parsing): PASS — "parses bare-string and object status forms identically".
- AC3 (task.id usable for follow-up calls): PASS — implicit in submit→poll→cancel chains across the suite.
- AC4 (cancel one-shot, warn-not-throw): PASS — "200 → resolves silently" + "non-2xx → resolves and logs warn".
- AC5 (download returns bytes + mime): PASS — "returns bytes and Content-Type".
- AC6 (Bearer header, composed signal + httpTimeoutMs, typed error with snippet ≤256): PASS — "non-2xx … OpenfangHttpError with status + endpoint" (table 401/403/404/500), "rejects with code=http_timeout when handler hangs", "mid-request abort rejects".
- AC7 (LogFn only, no plugin-internal imports): PASS — `httpClient.ts` imports only `./configSchema`; verified by source-scan test "module source imports nothing from @/platform, @/storage, @/chat, @/ui, @/editor".
- AC8 (apiKey never reaches log): PASS — `redactKey` test + "LogFn never sees the raw apiKey across submit + poll + cancel + download".
- AC9 (no new top-level dep): PASS — uses platform `fetch`; only new test-file import is `msw` (already a project devDependency).
- AC10 (endpoint URL strings match SRS): PASS — `/a2a/tasks/send`, `/a2a/tasks/{id}`, `/a2a/tasks/{id}/cancel`, plus caller-supplied artifact `relUrl` joined to `baseUrl` exactly (no double-slash; baseUrl trailing slash already stripped in F01).
- AC11 (unknown shapes default sanely): PASS — `normalizeTask` defaults `messages` and `artifacts` to `[]`; test "defaults messages and artifacts to [] when missing".

## Scope coverage
- In scope `createOpenfangHttp` factory: PASS — `httpClient.ts:130`.
- In scope `OpenfangHttp` interface (4 methods): PASS — `httpClient.ts:51-58`.
- In scope `LogFn` alias: PASS — `httpClient.ts:3-7`.
- In scope `A2a*` types: PASS — `httpClient.ts:9-49`.
- In scope `redactKey` helper: PASS — `httpClient.ts:71-77`.
- In scope `withTimeout` helper: PASS — `httpClient.ts:85-108`.
- In scope `OpenfangHttpError`: PASS — `httpClient.ts:60-69`.
- In scope unit tests with msw: PASS — 17 tests covering all listed cases.

## Out-of-scope audit
- Out of scope "Polling backoff loop": CLEAN — single-request transport only.
- Out of scope "Status interpretation beyond parsing": CLEAN — the client returns the status payload verbatim.
- Out of scope "Artifact part-type enumeration": CLEAN — F02 just exposes `downloadArtifact(relUrl, signal)`.
- Out of scope "Failure-prefix decoding": CLEAN.
- Out of scope "Insecure-HTTP rejection": CLEAN — F05 will guard.
- Out of scope "Retries": CLEAN — single-shot calls.

## Integration notes
F02 ships pure transport; integration gate skips per §5.3.1 (no `### In scope` bullet matches the wiring regex; consumed by F03/F04/F05). Stub-body gate skips. The factory + types will be referenced from `src/main.ts` transitively via F06.

## QA aggregate
QA verdict PASS (typecheck/lint/tests/build all 0).

## Verdict: PASS
