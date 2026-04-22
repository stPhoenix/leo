# Compliance iteration 1 — F48 context-suggestions-statusline

## Acceptance criteria
- AC1 (near-capacity + autocompact-aware detail): PASS — `src/ui/contextSuggestions.ts:55-74` branches on `isAutoCompactEnabled`; 79/80/81 boundary + autocompact-on/off detail-string tests + `savingsTokens = totalTokens - autoCompactThreshold` verified.
- AC2 (large-tool-results per-tool advice): PASS — `PER_TOOL_RULES` table at `src/ui/contextSuggestions.ts:45-53` pins Bash/Read/Grep/WebFetch (50/30/30/40 %), `GENERIC_TOOL_RULE` at 20 % fires only at ≥ 20 %; five tests cover severity + multiplier per tool and the ≥10k / >15 % dual threshold.
- AC3 (read-bloat suppressed when Read already flagged): PASS — `toolsFlagged.has('Read')` gate at `src/ui/contextSuggestions.ts:95`; two tests cover both branches.
- AC4 (memory-bloat top 3 files): PASS — sort+slice at `src/ui/contextSuggestions.ts:111-116`; fixture with five files asserts detail names exactly `big1/big2/big3`.
- AC5 (autocompact-disabled window 50–80 %): PASS — branching at `src/ui/contextSuggestions.ts:128-138`; five-case table covers boundaries 49/50/79/80 × on/off.
- AC6 (sort warnings-first + savings-desc + stable ties): PASS — `sortSuggestions` at `src/ui/contextSuggestions.ts:143-155`; mixed-fixture test asserts the exact order.
- AC7 (purity, no fetch): PASS — `fetch` spy test asserts zero invocations.
- AC8 (`buildStatusLineContext` six-field shape + clamp + null-safety): PASS — builder at `src/ui/contextSuggestions.ts:168-193`; three tests cover typical / over-window clamp / null usage.
- AC9 (500 ms trailing-edge debounce + collapse to one write): PASS — `createDebouncedStatusLineUpdater` at `src/ui/contextSuggestions.ts:204-236`; fake-timer test confirms 0 writes before 500 ms and 1 write after.
- AC10 (non-blocking + error-isolated + teardown-safe): PASS — try/catch inside `flush`; `dispose` clears the pending timer and sets `disposed=true` so late callbacks are inert; three tests cover dispose, throwing build, stability of writer.

## Scope coverage
- In scope "Pure `generateContextSuggestions(data)` engine with threshold constants + five ordered checks + per-tool advice": PASS.
- In scope "Sorting pass (warnings-first, savings-desc, stable)": PASS.
- In scope "Pure `buildStatusLineContext` with the six §14 fields": PASS.
- In scope "Debounced status-line update shell with 500 ms trailing edge + error isolation + teardown": PASS.
- In scope "Integration with `isAutoCompactEnabled`": PASS.
- In scope "Vitest coverage per NFR-TEST-08": PASS — 28 cases.

## Out-of-scope audit
- Out of scope "`ContextData` shape / category ordering / grid allocation / command registration": CLEAN — no imports from F46/F47.
- Out of scope "`analyzeContextUsage` / microcompact / 7-parallel ops": CLEAN — consumed via the narrow `ContextSuggestionInputs` shape.
- Out of scope "§13 inline conversation-UI banners": CLEAN — nothing emitted into F13's Notifications channel from this module.
- Out of scope "Per-assistant token footer": CLEAN — F12 surface unchanged.
- Out of scope "Cost-in-$": CLEAN — LM Studio only.
- Out of scope "Non-interactive Markdown output": CLEAN — not shipped.

## QA aggregate
All 4 gates PASS (typecheck, lint, 912 / 912 tests across 87 files, build `main.js` ~254 KB unchanged — React mount + status-bar wiring parked until `main.ts` consumption). See `qa-1.md`.

## Verdict: PASS
