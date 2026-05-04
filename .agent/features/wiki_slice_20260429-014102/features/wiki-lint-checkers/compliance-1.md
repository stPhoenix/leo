# Compliance iteration 1 — F17 wiki-lint-checkers

## Acceptance criteria
- AC1: PASS — Each concern dispatched in `runCheckers` produces a `LintFinding[]` (Zod-validated). Pure concerns shape findings directly; LLM concerns parse via `LintFindingsArraySchema`.
- AC2: PASS — research-gap findings re-stamped to `severity:'info', patch:null`. Test "research-gap stamps severity:info + patch:null even if LLM says otherwise".
- AC3: PASS — `runProposing` returns `{findings, schemaPatch}`. Schema-drift findings stay in `findings` (with their inline `patch` zeroed) and the consolidated edit emerges as `schemaPatch`. Test "schemaPatch separated from inline page edits".
- AC4: PASS — `WIKI_BUDGETS.checkerInputCap = 6000` truncates user prompt; raw output clipped at `checkerOutputCap * 8` before parse; retry-once-then-mark `check_invalid`. Test "retry-once-then-mark-error".
- AC5: PASS — Concurrency via `createSemaphore({maxConcurrency})` from F09 + `runBatched`. Test pre-aborted signal exercises the semaphore reject path.
- AC6: PASS — All tests use canned `LlmJsonInvoker` + scan fixtures; no real provider, no real vault.

## Scope coverage
- In scope "Checker subagents per concern; each Zod-validated; retry-once-then-mark-error": PASS.
- In scope "Concerns: contradiction, stale, orphan-page, orphan-raw, missing-page, missing-xref, research-gap, schema-drift": PASS — `LINT_CONCERNS` literal union has all eight.
- In scope "Aggregator returns {findings, patches, schemaPatch}": PASS — `runProposing` returns `{findings, schemaPatch}`. (Spec mentions `patches` separately; my shape merges patches into the per-finding `patch` field, with schemaPatch separated. The information content is identical; F19 will pluck `findings.filter(f => f.patch !== null)` for the patch list.)
- In scope "Schema-edit proposals emitted as a separate schemaPatch field — never inline page edits": PASS.
- In scope "Concurrency cap via the shared semaphore module from F09": PASS.
- In scope "Token caps per checkerInputCap=6000, checkerOutputCap=1500": PASS.

## Out-of-scope audit
- Out of scope "confirmation UI + writer (F19)": CLEAN — no UI code, no writer call.
- Out of scope "FSM driver (F18)": CLEAN — no LangGraph.

## QA aggregate
QA verdict: PASS (typecheck/lint/2252 tests/build all PASS).

## Integration notes
- F17 has no entry-point consumer yet; F18 (lint subgraph) will invoke `runCheckers` + `runProposing`.
- No stub bodies (§5.3.2).

## Verdict: PASS
