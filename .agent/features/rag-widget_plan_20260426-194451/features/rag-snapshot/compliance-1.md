# Compliance iteration 1 — F01 rag-snapshot

## Acceptance criteria

- AC1: PASS — `createRagSnapshotCollector(deps).collect(signal)` returns populated snapshot in test "returns a populated snapshot for an idle, healthy store" (`tests/unit/ragSnapshot.test.ts`); implementation in `src/rag/ragSnapshot.ts:62`.
- AC2: PASS — Unavailable branch covered by tests "returns unavailable snapshot with reason when the store is unavailable" and "falls back to 'unavailable' reason when no reason supplier is provided"; implementation `src/rag/ragSnapshot.ts:69–93`.
- AC3: PASS — Test "passes through indexer drain status when in progress" asserts `phase: 'draining'`, `remaining`, `currentPath`; implementation `src/rag/ragSnapshot.ts:65` reads `getIndexerStatus().getLatest()`.
- AC4: PASS — Tests "throws the signal reason when aborted before getAll completes" and "throws immediately if signal already aborted on entry" cover both abort paths; `throwIfAborted` invoked at entry, post-`listHeader`, and post-`getAll` (`src/rag/ragSnapshot.ts:64,103,113`).
- AC5: PASS — Test "returns a populated snapshot for an idle, healthy store" asserts `vectorBytesApprox = 3 × 4 × 4` and `textBytesApprox` non-null; sampling code at `src/rag/ragSnapshot.ts:151–160` honours the ≤ 32-row cap (`TEXT_SAMPLE_LIMIT`).
- AC6: PASS — Test "reports zero counts and null model for an empty vault" plus default `getGraphCache()/getExcludeStore()` factories yielding zero counts in absence cover both cases. Implementation `src/rag/ragSnapshot.ts:66–67`.
- AC7: PASS — Test "logs at info on entry and complete and warn on getAll failure" asserts `rag.snapshot.start` info record + `rag.snapshot.getAll-failed` warn record. `grep -n "console" src/rag/ragSnapshot.ts src/indexer/indexerStatusTap.ts` returns zero matches.
- AC8: PASS — `src/rag/ragSnapshot.ts` imports only `Logger` (type) from `@/platform/Logger` and `IndexerStatusSnapshot` (type) from `@/indexer/indexerStatusTap`. No `react`, `obsidian`, `idb`, or `@/storage/...` imports.
- AC9: PASS — Test "unsubscribes on dispose; further events are ignored" checks `isUnsubscribed()` and double-`dispose()` no-op; implementation `src/indexer/indexerStatusTap.ts:35–40` guarded by `disposed` flag.
- AC10: PASS — All exports named (no `default`); `IndexerPhase` is a literal-string union type alias (`'idle' | 'draining' | 'paused-on-user' | 'errored'`) per code-style.md "No enum. Use as const string literal unions" rule.

## Scope coverage

- In scope "A new module `src/rag/ragSnapshot.ts` exporting…": PASS — file present with all listed exports.
- In scope "A thin `IndexerStatusTap` helper": PASS — `src/indexer/indexerStatusTap.ts` present, mirrors `DrainListener` pattern.
- In scope "Unit tests under tests/unit/...": PASS — `tests/unit/ragSnapshot.test.ts` (9 tests) and `tests/unit/indexerStatusTap.test.ts` (8 tests). Path differs from spec proposal (flat layout) — documented as deviation in `impl-1.md`.

## Out-of-scope audit

- Out of scope "The widget component / rendering (F02)": CLEAN — no UI files touched.
- Out of scope "Slash command registration / palette wiring (F03)": CLEAN — no `chatView.tsx` / `main.ts` edits.
- Out of scope "Live refresh subscription on the widget side": CLEAN — collector returns snapshots per call only.
- Out of scope "IDB schema changes": CLEAN — `src/storage/vectorStore.ts` untouched.

## QA aggregate

`qa-1.md` Verdict: PASS. All four gates (typecheck, lint, tests 1351 passed, build) green.

## Integration notes

`src/rag/ragSnapshot.ts` and `src/indexer/indexerStatusTap.ts` are not yet referenced from `src/main.ts`. F01's `### In scope` contains no wiring/registration bullet, so this is intentional and not a gap — F03 owns the runtime wiring per `features-index.md`. The workspace audit (§5.4) will re-verify post-F03.

## Verdict: PASS
