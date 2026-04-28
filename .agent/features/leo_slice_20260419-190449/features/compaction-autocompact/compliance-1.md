# Compliance iteration 1 — F43 compaction-autocompact

## Acceptance criteria
- AC1 (`shouldAutoCompact` threshold formula): PASS — `src/agent/autocompact.ts:136-159` computes `tokens - (snipTokensFreed ?? 0) >= autoCompactThreshold` with `autoCompactThreshold = effectiveContextWindow - 13_000` and `effectiveContextWindow = contextWindow - min(maxOutputTokensForModel, 20_000)`; `resolveContextWindow` at `src/agent/compactConstants.ts:41-51` gives `[1m]` → 1_000_000, provider capability, else 200_000. `tests/unit/autocompact.test.ts` — 5 cases: default boundary (below/at), 1 M branch (below/at), provider-capability override, `snipTokensFreed` subtract, `querySource='compact'` early-false.
- AC2 (short-circuit on `querySource='compact'` + `shouldAutoCompact=false`, zero `provider.stream`): PASS — `autoCompactIfNeeded` guards at `src/agent/autocompact.ts:178-204`; ScriptedProvider captures zero requests in both branches.
- AC3 (prompt byte-identical snapshot): PASS — `getCompactPrompt()` returns `NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT + DETAILED_ANALYSIS_INSTRUCTION + (custom ? "\n\nAdditional Instructions:\n"+custom : "") + NO_TOOLS_TRAILER` exactly (`src/agent/compactPrompts.ts:75-86`); constants pinned at `src/agent/compactPrompts.ts:1-68`. Two AC3 tests assert both no-custom and custom concatenations are byte-identical plus anchor-text checks for every section's opening line.
- AC4 (summarization call payload): PASS — `runStreamOnce` at `src/agent/autocompact.ts:292-335` builds `{ model, messages: [{role:'system', content: COMPACT_SYSTEM_PROMPT}, ...call.messages], maxTokens: min(COMPACT_MAX_OUTPUT_TOKENS, opts.maxOutputTokensForModel ?? 20_000) }` with `tools` omitted; test asserts `req.model`, `req.tools === undefined`, `req.maxTokens`, first system message, and last user message anchor text.
- AC5 (pre-API transforms): PASS — `getMessagesAfterCompactBoundary`, `stripReinjectedAttachments`, `stripImagesFromMessages`, `normalizeMessagesForAPI` each covered by a dedicated test; end-to-end exercise happens inside `runCompaction` which applies them in order `after-boundary → append summary-request → strip reinjected → strip images → normalize` (`src/agent/autocompact.ts:213-220`).
- AC6 (post-compact assembly order): PASS — `buildPostCompactMessages` at `src/agent/autocompact.ts:380-393` concatenates `[boundary, ...summary, ...(keep ?? []), ...attachments.message, ...hook]` exactly; test asserts the resulting array equals the concatenation and optional `messagesToKeep` passthrough. Boundary marker carries `{trigger: 'auto', preTokens}`; summary user message carries `{isCompactSummary: true, isVisibleInTranscriptOnly: true}`.
- AC7 (file attachment budgets): PASS — `buildFileAttachments` enforces `POST_COMPACT_MAX_FILES_TO_RESTORE = 5`, per-file cap via `Math.min(POST_COMPACT_MAX_TOKENS_PER_FILE, budgetRemaining)`, total cap via `budgetRemaining` decrement; visibility filter via `collectVisibleFilePaths` path regex. Two tests: 10 candidates × 60 k bytes each → exactly 5 attachments each ≤ 5 000 tokens with summed tokens ≤ 50 000; candidate `already.md` visible in message content excluded, `fresh.md` retained.
- AC8 (skill attachment budgets): PASS — `buildSkillAttachments` at `src/agent/autocompact.ts:486-514` starts `skillBudget = min(POST_COMPACT_SKILLS_TOKEN_BUDGET, remaining)`, per-skill cap via `Math.min(POST_COMPACT_MAX_TOKENS_PER_SKILL, skillBudget)`; test: 6 × 30 k-token skills produce ≤ 5 attachments each ≤ 5 000 tokens with total ≤ 25 000.
- AC9 (30-s keep-alive tick): PASS — `runStreamOnce` schedules `setIntervalFn(fn, keepAliveIntervalMs ?? 30_000)` and clears it in `finally`; test injects `setIntervalFn` capturing the handler, calls it twice mid-stream, asserts two `keepAlive.tick` log records and `clearIntervalFn` fires.
- AC10 (streaming retry max 2, null on 3rd failure + `tengu_compact_failed` + `tengu_compact_streaming_retry`): PASS — `runSummarizationWithRetries` at `src/agent/autocompact.ts:257-290` loops `MAX_COMPACT_STREAMING_RETRIES + 1 = 3` attempts, backs off with `retryBaseMs * 2^attempt` (defaults 1 s, 2 s), returns null on final failure; test with 3 scripted errors asserts `provider.requests.length === 3`, two `tengu_compact_streaming_retry` records, one `tengu_compact_failed {reason: 'no_streaming_response'}`. Success-on-second-try test asserts exactly one retry event.
- AC11 (`formatCompactSummary` fixtures): PASS — regex strip + prefix + blank-line collapse + trim at `src/agent/autocompact.ts:366-378`; 7 fixtures: analysis-only throws, summary-only prefixes, both strips analysis, neither throws, nested `<T>(x:T)` preserved, blank-line run collapse, trailing whitespace trim.
- AC12 (API invariants): PASS — two tests: first non-boundary output message is `role: 'user'` (compact summary); assembled output contains no unpaired `role: 'tool'` messages (compact never emits bare tool_result).
- AC13 (abort propagation clears keep-alive + returns null): PASS — `linkSignals` wires outer `AbortController` to an inner one and removes the listener on cleanup; test triggers abort mid-stream, asserts `clearIntervalFn` fired and the function returned null.

## Scope coverage
- In scope "`autoCompactIfNeeded` / `shouldAutoCompact` entry points with constants, threshold math, prompt builder, summarization streaming with `querySource='compact'` / tools disabled / thinking disabled / maxOutputTokens cap, pre-API transforms, keep-alive, retry loop, post-processing, post-compact assembly, attachments with budgets, recursion guard, telemetry events, Vitest coverage": PASS — all 41 tests cover the surface.
- In scope "Contains `MODEL_CONTEXT_WINDOW_DEFAULT`, `COMPACT_MAX_OUTPUT_TOKENS`, `AUTOCOMPACT_BUFFER_TOKENS`, `POST_COMPACT_*`, `MAX_COMPACT_STREAMING_RETRIES` module-level const": PASS (`src/agent/compactConstants.ts`).
- In scope "`getCompactPrompt` assembles verbatim constants from §10": PASS.
- In scope "Post-compact attachments: files + skills + plan + plan-mode; deferred-tools / agent-listing / MCP-instruction deltas deferred to F51": PASS — builder injects only the four live categories; F51 slots will wire the rest when they land.
- In scope "Recursion guard on `querySource='compact'`": PASS (AC2).
- In scope "`tengu_compact`, `tengu_compact_streaming_retry`, `tengu_compact_failed`": PASS — all three events emitted via F01 Logger.
- In scope "Vitest coverage for threshold boundary, prompt snapshot, assembly order, budgets, keep-alive, retry, recursion guard, `formatCompactSummary`": PASS — 41 cases.

## Out-of-scope audit
- Out of scope "PTL retry / head truncation (F44)": CLEAN — no PTL logic in the module; error path returns null after retry exhaustion.
- Out of scope "Circuit breaker (F45)": CLEAN — no consecutive-failure counter (the caller/F45 owns it); `tengu_compact_failed` is emitted for F45 to consume.
- Out of scope "Session memory compaction (Layer 4)": CLEAN — no session-memory branch.
- Out of scope "Partial compaction (Layer 3 sibling)": CLEAN — only full-compact path.
- Out of scope "Cache-sharing fork (Path A)": CLEAN — Path B direct streaming only.
- Out of scope "Env-var overrides": CLEAN — no `process.env` reads.
- Out of scope "Feature flags (`tengu_cobalt_raccoon`, etc.)": CLEAN — no flag lookups.
- Out of scope "Hooks integration": CLEAN — `hookResults: readonly ChatMessage[]` is always `[]` inside `runCompaction`; the shape stays in place for F46 / future hooks.
- Out of scope "Token-warning UI / status line / `/context`": CLEAN — no UI; those land in F46–F48.
- Out of scope "Post-compact cleanup (`runPostCompactCleanup`)": CLEAN — nothing else to clear in v1; F42 resets its own state when callers invoke it.
- Out of scope "Image/file attachments in pre-summary messages": CLEAN — `stripImagesFromMessages` is a regex no-op on markdown-only content today; F49 wires real image blocks later.

## QA aggregate
All 4 gates PASS (typecheck, lint, 818 / 818 tests across 82 files, build `main.js` ~254 KB unchanged — new modules not yet bundled until AgentRunner wiring lands with F44+). See `qa-1.md`.

## Verdict: PASS
