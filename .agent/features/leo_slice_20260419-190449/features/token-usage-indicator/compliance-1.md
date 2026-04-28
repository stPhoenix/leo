# Compliance iteration 1 — F12 token-usage-indicator

## Acceptance criteria

- AC1 (provider usage with all three fields populated → footer renders verbatim input/output/total): PASS — `src/ui/chat/turnDispatcher.ts:106-114` `trackUsage` captures `usage.input` / `usage.output` when present; `src/chat/tokenUsage.ts:21-38` returns provider values verbatim and computes `total = input + output`. Test `tests/dom/tokenUsageFooter.test.tsx` "renders input / output / total counts verbatim when all three fields are provided" + `tests/unit/turnDispatcher.test.ts` "commits provider-supplied usage verbatim on done".
- AC2 (no usage → both fields estimated via `Math.ceil(len/4)`, total = sum, visible estimate marker): PASS — `src/chat/tokenUsage.ts:25-38` falls back when provider fields are absent and flags `estimatedInput`/`estimatedOutput`; footer at `src/ui/chat/MessageList.tsx:204-216` prefixes `~` per estimated axis and on the total when either axis is estimated. Tests: `tokenUsage.test.ts` "falls back to len/4 when provider omits both fields…", `tokenUsageFooter.test.tsx` "shows the ~ estimate marker and total marker when both fields are estimated", `turnDispatcher.test.ts` "falls back to len/4 estimation when the provider omits usage".
- AC3 (partial usage → present fields verbatim, only missing axes estimated): PASS — `computeTokenUsage` handles each axis independently (only sets `estimated*` when that specific provider value is `undefined`). Tests: `tokenUsage.test.ts` "mixes provider value with fallback when only input is missing" / "… only output is missing", `tokenUsageFooter.test.tsx` "marks only the missing field as estimated in partial-usage paths".
- AC4 (footer values captured on done / error / cancel with stable input/output/total triple): PASS — `src/ui/chat/turnDispatcher.ts:102-116` wraps the stream in a generator whose `try { … } finally { this.commitUsage(…) }` guarantees `commitUsage` fires regardless of exit path. Tests: `turnDispatcher.test.ts` "commits provider-supplied usage verbatim on done", "commits tokens on provider error using tokens received up to the error", "commits tokens on Stop / cancel after partial stream".
- AC5 (Obsidian CSS vars only, legible under min-width, keyboard reachable): PASS — `.leo-bubble-usage` in `styles.css` uses only `--background-modifier-border`, `--text-muted`, `--font-ui-smaller`, `--size-4-*`. `stylesAudit.test.ts` continues to PASS with the new classes (no hex/rgb). Footer is a `<footer>` with inline `<span>`s inside the assistant bubble, so F05's keyboard traversal order is unchanged; no interactive children added that need custom tabindex.
- AC6 (no $ cost in Phase 1): PASS — no `$` / cost field touched in either the type, the estimator, or the footer component; F38 scope retained for cloud adapters.
- AC7 (coverage for all five paths + `len/4` boundaries 0 / 1 / 4 / 5): PASS — see AC1–AC4 tests plus `tokenUsage.test.ts` boundary suite (0 / 1 / 4 / 5 / negative clamp) and the three provider mix variants.

## Scope coverage

- In scope "Per-assistant-message footer slot showing input / output / total": PASS — `TokenUsageFooter` in `MessageList.tsx`.
- In scope "Usage extraction from provider `usage` / `done` events": PASS — `trackUsage` in `turnDispatcher.ts`.
- In scope "Fallback estimator `ceil(promptChars/4)` / `ceil(outputChars/4)` with visible marker on estimates": PASS — `computeTokenUsage` + footer `~` prefix.
- In scope "Counts captured on done / error / cancel": PASS — `try/finally` in `trackUsage`; test coverage for each path.
- In scope "Obsidian CSS variables only; degrades to single muted line; keyboard reachable": PASS — see AC5.
- In scope "Unit coverage for all five paths + estimator boundaries": PASS — see AC7.

## Out-of-scope audit

- Out of scope "Cost-in-$ for cloud providers": CLEAN — no `$` / cost field in any file touched.
- Out of scope "3-tier token estimator": CLEAN — only the `len/4` tier exists; no hybrid / per-block rules.
- Out of scope "/context breakdown, grid, suggestion engine, status line": CLEAN — none added.

## QA aggregate

Verdict: PASS (typecheck, lint, 250/250 tests, build ~200 KB).

## Verdict: PASS
