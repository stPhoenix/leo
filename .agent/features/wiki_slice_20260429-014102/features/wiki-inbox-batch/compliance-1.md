# Compliance iteration 1 — F15 wiki-inbox-batch

## Acceptance criteria
- AC1: PASS — `runInboxBatch` iterates `open` rows in order with `for…of`, awaiting each `startRun.handle.terminal` before continuing. Test "drains sequentially: ticks success, annotates errors, skips done rows" verifies `startCalls` order.
- AC2: PASS — Successful terminal triggers `tickRef`. Test "ticked: 1" + "expect final).toContain('- [x] https://example.com/a')".
- AC3: PASS — Error terminal triggers `annotateErrorOnRef`. Test asserts `error: fetch_vault_missing: gone` annotation while keeping `- [ ]`.
- AC4: PASS — Each per-item `startRun` invocation creates its own `WikiWidgetController` (F11 wires this internally) and registers it in `liveControllerRegistry`. Duplicate-detect surface flows through the same `requestDuplicateChoice` callback the single-source path uses; behaviour is identical because both paths go through `processSourceFetchPersist`.
- AC5: PASS — Loop checks `signal.aborted` before each iteration; pre-aborted signal short-circuits before any `startRun`. Test "cancel mid-batch" asserts `calls === 0` after pre-abort.
- AC6: PASS — End-to-end test "drains sequentially…" exercises three items (URL happy + vault missing + attachment missing) and asserts every tick + annotation + per-item status.

## Scope coverage
- In scope "kind:'inbox' input handled by the orchestrator": PASS — `delegateWikiIngest.ts` routes inbox to `runInboxBatch` before reaching `argsToSource`.
- In scope "Sequential drain (concurrency 1) over open inbox items": PASS — synchronous loop.
- In scope "Per-item invoke of single-source ingest, reusing F11 subgraph": PASS — `startRun` is the same factory closure passed into `delegate_wiki_ingest`.
- In scope "Per-item terminal: DONE → tick(ref); ERROR → annotateError; CANCELLED mid-batch → in-flight item completes per F11 cancel semantics, remaining items not started": PASS — see AC1–AC5.
- In scope "Per-item duplicate-detect interrupt surfaces in the F06 widget like single-source ingest": PASS — same code path; AC4 disposition.

## Out-of-scope audit
- Out of scope "parallel inbox drain": CLEAN — no concurrency in `runInboxBatch`.
- Out of scope "partial-line cleanup": CLEAN — only ticks open rows + annotates errors; non-row lines preserved verbatim by F14's parser.

## QA aggregate
QA verdict: PASS (typecheck/lint/2242 tests/build all PASS).

## Integration notes
- `inboxBatch.ts` reaches `main.ts` transitively via `delegate_wiki_ingest`'s `inbox` dep; the tool itself is registered at `main.ts:748-…`.
- F14's `tickRef` and `annotateErrorOnRef` now have a runtime consumer.
- No stub bodies (§5.3.2): every branch returns a real shape; per-item error paths annotate with real error codes.

## Verdict: PASS
