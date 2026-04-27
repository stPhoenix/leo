# Compliance iteration 1 — F06 tool-fetch-url

## Acceptance criteria
- AC1 (invalid scheme): PASS — `fetchUrl.test.ts` "non-http(s) URL → invalid_url" + "malformed URL → invalid_url".
- AC2 (allow precedence + blocklist): PASS — `checkHost: allowlist takes precedence`.
- AC3 (default blocklist): PASS — `checkHost denies default blocklist hosts` checks every entry from the SRS list.
- AC4 (timeout): PASS — `timeout → timeout` uses fake timers + an abort-aware fetch stub.
- AC5 (body cap): PASS — `body cap → truncated:true with totalBytes`.
- AC6 (single metrics event with metadata): PASS — `emits one metrics event with non-payload fields`. Metrics callback never receives `body`/`headers`.
- AC7 (redirect chain re-validation + over-hop): PASS — `redirect chain re-validates against blocklist` + `redirect over hop limit → http_error`.
- AC8 (Zod boundary): PASS — `Zod parse rejects malformed input` covers empty + invalid method.

## Scope coverage
- In scope "schemas.ts (subset for fetch_url)": PASS — `tools/schemas.ts:1-19`.
- In scope "fetchUrl.ts factory + matchers": PASS — `tools/fetchUrl.ts`.
- In scope "Allow/blocklist + redirect re-validation": PASS — `checkHost` + redirect loop.
- In scope "Timeout via AbortController composed with run signal": PASS — `composed.signal` wires both sources.
- In scope "Body cap via stream read; totalBytes accurate": PASS — `readBoundedBody`.
- In scope "JSON parse path + invalid_json": PASS — both happy and failure cases tested.
- In scope "Error mapping": PASS — `blocked|timeout|too_large|invalid_url|invalid_args|invalid_json|http_error` typed result union.
- In scope "One log info per call (via metrics callback wired to event bridge)": PASS — `withMetrics` exposes the callback hook; F12/F14 will pipe into the bridge's `BridgeChunk` stream.

## Out-of-scope audit
- Out of scope "DNS-level rebind protection": CLEAN.
- Out of scope "Streaming response delivery to LLM": CLEAN — body fully buffered.
- Out of scope "Cookie / session handling": CLEAN — every call is stateless; `redirect: 'manual'`.

## QA aggregate
`qa-1.md` verdict PASS — 1693/1693, lint/typecheck/build green.

## Verdict: PASS
