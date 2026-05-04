# Impl iteration 1 — F18 wiki-lint-subgraph

## Summary
Implemented the lint FSM driver `startLintRun(input, deps): LintStartResult`. Acquires the F05 mutex, registers a F06 widget controller, walks SCANNING (F16) → CHECKING (F17 checkers) → PROPOSING (F17 proposing) → CONFIRMING (callback to F19's UI) → WRITING (F10 writer) → DONE/CANCELLED/ERROR. AbortSignal threads through every phase; the outer `try/finally` releases the mutex and live controller on every path. CONFIRMING uses an injectable `requestConfirmation` callback (F19 wires it to LangGraph `interrupt()` via the F06 widget's awaiting_confirm phase).

## Files touched
- `src/agent/wiki/lint/subgraph.ts` — `startLintRun`, `LintStartResult`, `LintRunHandle`, `LintTerminalResult`, `LintConfirmDecision`. Driver logic + scope filtering + per-finding view-model wiring + schema-patch apply path.

## Tests added or updated
- `tests/unit/wikiLintSubgraph.test.ts` — happy path (orphan-only scope, all rejected → DONE with findings.total:1, rejected:1, mutex released) (AC1, AC4); mutex contention returns busy (AC6); null confirmation → CANCELLED terminal (AC2); LLM throw routes to ERROR + mutex released (AC4, AC6).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- AC7 (CONFIRMING via LangGraph `interrupt()`): implemented via `requestConfirmation` callback rather than direct `interrupt()`. F19 will wire that callback to the F06 widget's awaiting_confirm phase, which in turn integrates with LangGraph's pause/resume. Same semantics; the callback indirection makes F18 unit-testable without a LangGraph driver harness.
- AC3 (Cancel during WRITING completes current file then transitions): the writer (F10) completes its current per-file write deterministically; the driver passes `cancelledMidWrite: true` only when abort is observed before WRITING completes. F10 already handles partial-failure recovery, so AC3's invariant holds end-to-end.
- v1 WRITING applies `replace_body`-only patches as page edits. Other patch kinds (append, replace_section) are NOT applied as page edits in this iteration; F19 will refine the writer mapping when its UI ships, since the precise patch shape depends on what F19 produces from confirm decisions. Schema-patch application (`append`/`replace_body`) is functional in v1.

## Assumptions
- `LintConfirmDecision = {accepted, rejected, applySchema}` is the contract F19 will satisfy; v1 tests use synthetic decisions without round-tripping through a real UI controller.
- `findings.total` reflects all findings produced by checkers + proposing — not the count of acceptable patches. F19 surfaces this same total on the widget.

## Open questions
None.
