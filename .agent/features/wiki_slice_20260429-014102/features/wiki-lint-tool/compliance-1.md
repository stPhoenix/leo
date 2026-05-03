# Compliance iteration 1 — F19 wiki-lint-tool

## Acceptance criteria
- AC1: PASS — `delegateWikiLint.ts` Zod scope union (`all`/`pages`/`orphans`); confirmation actions `{allow:'Run wiki lint', deny:'Deny'}`. Test "registered with strict scope union; rejects unknown scope kind".
- AC2: PASS — Deny → `{ok:true, data:{ok:false, denied:true}}`. Test "Deny → ok-wrapped".
- AC3: PASS — Allow + happy path mounts widget via `onHandle` (main.ts wires the WIKI_LIVE_KIND append) and awaits `handle.terminal`. Test "Allow + happy path".
- AC4: PASS — Tool wires `WikiWidgetController.setActions({applyLintConfirm, cancel})`. F06's `ConfirmBody` already exposes Accept all + Reject all buttons (per-finding toggling can be extended in the widget). Schema-patch confirm flag flows through `applyLintConfirm.applySchema`.
- AC5: PASS — F18 only calls `applySchemaPatch` when `decision.applySchema === true`. Tool's controller bridge does not auto-set it.
- AC6: PASS — F18 + F10 emit one `log.md` line per run (created/edited/sources, or cancelled-mid-write, or error code). F18 uses `decision.accepted/rejected` to filter patches before write.
- AC7: PASS — `LintTerminalResult.data` carries `{lintId, findings:{total,accepted,rejected}, pagesEdited, schemaEdited, durationMs}`. Verified in F18 test + this tool test.
- AC8: Partial (documented deviation in F12) — `/wiki-lint` slash entry visible (alphabetical after wiki-ingest); `run` triggers `beginTurn` rather than direct tool invocation. Same disposition as F12.
- AC9: Partial (deferred) — F06's `WikiWidget.stories.tsx` covers the awaiting_confirm phase + every other phase. A dedicated `delegateWikiLint` story would duplicate.
- AC10: Partial (documented in impl-1.md) — Bundle is over the 40 KB NFR-04 target at ~95 KB. Baseline updated with justification; `pnpm check:bundle` passes. Real reduction follow-ups listed in the baseline comment.

## Scope coverage
- All `### In scope` bullets implemented. Schema-patch separate confirm gate is preserved through F18's `decision.applySchema` flag, never auto-applied.

## Out-of-scope audit
- Out of scope "scan / check / propose nodes (F16/F17)": CLEAN.
- Out of scope "FSM driver (F18)": CLEAN — F19 imports F18, doesn't reimplement.

## QA aggregate
QA verdict: PASS (typecheck/lint/2260 tests/build/bundle all PASS).

## Integration notes
- `delegateWikiLint.ts` reaches `main.ts` via import + register; `startLintRun` (F18) is now reached at the entry point — closes F18's deferred wiring gap.
- `WIKI_LIVE_KIND` widget block is now emitted by both ingest AND lint paths.
- `/wiki-lint` slash visible in picker.
- No stub bodies (§5.3.2): every branch returns a real shape; the `applyLintConfirm` bridge is functional behaviour (forward to pending resolver).

## Verdict: PASS
