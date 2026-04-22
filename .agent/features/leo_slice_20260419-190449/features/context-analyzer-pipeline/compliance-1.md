# Compliance iteration 1 — F46 context-analyzer-pipeline

## Acceptance criteria
- AC1 (input/output shape per §6.1): PASS — `ContextAnalyzerInputs` carries `messages`, optional `originalMessages`, `model`, `terminalWidth`, `signal`, `logger`, `counters`, `projectView`, `microcompact`; `ContextData` exposes all seven per-category counts, `skillTokens`, `skillCountFailed`, `totalTokens`, `tokenTotalSource`, `pipelineMessageCount`, `model`. Shape test asserts every field.
- AC2 (pipeline order filter → projectView → microcompact → analyze): PASS — explicit order in `src/agent/contextAnalyzer.ts:33-45`; ordering test with tagging spies asserts calls 0/1/2 are `pv → mc → analyze` with the prior step's output as input.
- AC3 (boundary filter keeps the later of the two types): PASS — `filterAfterLastBoundary` at `src/agent/contextAnalyzer.ts:126-142` scans forward and keeps the maximum index across both markers; two fixtures (compact-then-micro and micro-then-compact) assert the later wins.
- AC4 (seven `Promise.all` concurrent counters + skill runs after): PASS — the batch at `src/agent/contextAnalyzer.ts:55-72`; parallel-concurrency test asserts `maxConcurrency === 7` across an add/delete bookkeeping window and uses a `Proxy` to observe the skill counter fires strictly after `batchDone`.
- AC5 (error-isolated skill): PASS — try/catch at `src/agent/contextAnalyzer.ts:80-89`; test asserts `skillTokens=0`, `skillCountFailed=true`, and a `context.skill_count_failed` log record with the caught error's message.
- AC6 (first rejection wins for the parallel batch): PASS — `Promise.all` propagates the first rejection upward; test asserts `analyzeContextUsage` rejects with the thrown error from `countBuiltInToolTokens`.
- AC7 (API vs estimated final total): PASS — `extractApiUsageTotal` at `src/agent/contextAnalyzer.ts:150-162` walks `originalMessages` backwards for the latest assistant with `usage`, sums `input + cache_creation + cache_read`; orchestrator sets `tokenTotalSource='api'` on hit, `'estimated'` and the sum of the seven counts on miss. Two fixtures verify each branch.
- AC8 (abort propagation): PASS — `throwIfAborted` at `src/agent/contextAnalyzer.ts:167-171` fires before each pipeline step and after the parallel batch; pre-aborted fixture asserts the function rejects with `AbortError`.
- AC9 (domain-layer purity): PASS — `src/agent/contextAnalyzer.ts` imports only `@/platform/Logger`, `@/providers/types`, `./microcompact`, `./autocompact`; import-graph test asserts the module exports only `analyzeContextUsage` + `filterAfterLastBoundary` with no Obsidian / React / network surface.

## Scope coverage
- In scope "pure `analyzeContextUsage` orchestrator with §6.1 input/output shape": PASS.
- In scope "filter → projectView (optional) → microcompact (optional) → analyze pipeline": PASS.
- In scope "`Promise.all` of seven counters + error-isolated skill counting": PASS.
- In scope "API-usage-tier vs estimated final-total selector + `tokenTotalSource` label": PASS.
- In scope "`AbortSignal` plumbing and early rejection": PASS.
- In scope "Vitest coverage for each AC": PASS — 12 cases.

## Out-of-scope audit
- Out of scope "Per-op counter logic": CLEAN — all seven (+skill) are injected; the module declares no bodies.
- Out of scope "`ContextData` field semantics beyond 'typed result'": CLEAN — orchestrator wires totals + source; grid / category ordering / suggestion thresholds are left to F47/F48.
- Out of scope "3-tier estimator internals": CLEAN — uses F41 only via injected counters.
- Out of scope "Microcompact clearing rules / compactable-tool allowlist": CLEAN — consumed only through the optional `microcompact` injector.
- Out of scope "Autocompact threshold / summarization": CLEAN — orchestrator does not call autocompact.
- Out of scope "`projectView` collapse": CLEAN — identity slot reserved, no implementation shipped.
- Out of scope "Session memory compaction": CLEAN — not referenced.

## QA aggregate
All 4 gates PASS (typecheck, lint, 866 / 866 tests across 85 files, build `main.js` ~254 KB unchanged — tree-shaken until F47/F48 wire `/context`). See `qa-1.md`.

## Verdict: PASS
