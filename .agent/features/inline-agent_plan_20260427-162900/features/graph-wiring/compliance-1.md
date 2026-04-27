# Compliance iteration 1 — F16 graph-wiring

## Acceptance criteria
- AC1 (signal threading): PASS by construction — `composeAbortSignal(host, wallClockMs)` produces the composed signal that the graph passes into every classifier/planner/branch invocation; tools (`fetch_url`/`search_web`/file ops) wire that same signal into `fetch`/`tool.invoke`.
- AC2 (host abort: ≤1 s rejection + 2 s grace + cleanup): PASS by composition — composed signal is shared with every in-flight tool; `sandbox.cleanup()` runs in `finally`; the host subgraph (subgraph.ts:abortGraceMs) already enforces the 2 s grace per the existing F03 contract.
- AC3 (recursion guard panic): PASS — `assertNoExternalDelegate` test-positive + negative + `FORBIDDEN_TOOL_NAMES` export.
- AC4 (override skips classifier): PASS — `routing.mode === 'simple' | 'deep'` paths fall through `classifyTask` without an LLM call (F11 already verified); F16 routes accordingly.
- AC5 (multistep planner empty → fallback to simple): PASS — graph checks `planResult.ok === false` and re-routes to simple-branch with `planner-fallback` warn.
- AC6 (cumulative iteration_limit / token_limit / timeout → emit error + flush): PASS — token_limit propagates from inner loops as a `BridgeChunk { kind: 'error', error: { code: 'token_limit', ... } }`; the graph yields it; the `try/finally` continues into `flushPublishedArtifacts` for partial publication. Wall-clock timeout fires the composed signal which short-circuits in-flight tool/model calls.
- AC7 (sandbox cleanup on done/error/abort/throw): PASS — `graph.test.ts` "full simple-route happy path: sandbox cleaned + done emitted" + "sandbox cleanup runs on error path".
- AC8 (never throws synchronously): PASS — `graph.test.ts` "errors do not throw out of the iterable".

## Scope coverage
- In scope "graph.ts runInlineAgentGraph": PASS.
- In scope "Sandbox + runState + composed signal": PASS.
- In scope "Recursion-guard assertion": PASS.
- In scope "Classifier → branch dispatch": PASS.
- In scope "Multistep planner+research+synthesize loop": PASS.
- In scope "Simple branch": PASS.
- In scope "flushPublishedArtifacts then done": PASS.
- In scope "All paths thread signal": PASS.
- In scope "try/finally cleanup": PASS.
- In scope "Adapter `start()` replaces stub iteration with `yield* runInlineAgentGraph(...)`": PASS — `index.ts:start()` delegates after the provider whitelist gate.

## Out-of-scope audit
- Out of scope "Cross-cutting integration tests": CLEAN — F18 owns.
- Out of scope "Bundle headroom guard": CLEAN — F17.
- Out of scope "New UI": CLEAN.

## QA aggregate
`qa-1.md` verdict PASS — 1828/1828, lint/typecheck/build green.

## Verdict: PASS
