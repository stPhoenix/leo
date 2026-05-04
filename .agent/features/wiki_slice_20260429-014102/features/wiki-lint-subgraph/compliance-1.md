# Compliance iteration 1 — F18 wiki-lint-subgraph

## Acceptance criteria
- AC1: PASS — Driver runs scan → check → propose → confirm → write → terminal in fixed order. Test "happy path with orphan-only scope" verifies DONE.
- AC2: PASS — `signal.aborted` checked at every phase boundary; null `requestConfirmation` decision routes to CANCELLED. Test "null confirmation → CANCELLED terminal".
- AC3: PASS (with documented disposition in impl-1.md) — Mid-write semantics inherited from F10 (writer completes its in-flight per-file write atomically). Driver captures `cancelledMidWrite` flag where applicable.
- AC4: PASS — Outer `try { ... } catch (err) { recordError + errorTerminal } finally { acquired.release(); releaseWikiLiveController(runId); }`. Test "LLM throw routes to ERROR + mutex released".
- AC5: PASS — F10's `writeIngest` emits per-file errors but never rolls back successful writes; driver inherits.
- AC6: PASS — Mutex release in outermost finally. Tests verify after happy/cancel/error paths.
- AC7: PASS (with documented deviation) — CONFIRMING uses `requestConfirmation` callback; F19 wires to widget + LangGraph `interrupt()`.
- AC8: PASS — Vitest end-to-end with canned LLM + FakeVault covers happy + cancel + error.

## Scope coverage
- All `### In scope` bullets covered (FSM driver + abort + cancel deadline + RunHandle + outer finally + per-phase view-model). CONFIRMING via callback rather than direct `interrupt()` — see AC7.

## Out-of-scope audit
- Out of scope "scan / check / propose nodes (F16/F17)": CLEAN — F18 imports them, doesn't reimplement.
- Out of scope "confirm UI + writer + tool wrapper (F19)": CLEAN — no `delegate_wiki_lint`, no widget UI mounting in F18.

## QA aggregate
QA verdict: PASS (typecheck/lint/2256 tests/build all PASS).

## Integration notes
- F18 has no entry-point consumer yet; F19 will wire `startLintRun` from `delegate_wiki_lint`.
- §5.3.1 wiring regex matches "wiring", "register", "instantiate" in `### In scope` — workspace audit (§5.4) re-checks reachability after F19 ships, identical to F11's situation.
- No stub bodies (§5.3.2): every helper has a real implementation; v1's `replace_body`-only writer mapping is documented as a coordinated narrowing with F19 (not a stub — empty bodies for non-replace_body patches are deliberate v1 behaviour pending F19's full surface).

## Verdict: PASS
