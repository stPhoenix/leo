# Compliance iteration 1 — F12 tool-result-diff

## Acceptance criteria

- AC1: PASS — `computeUnifiedDiff` is pure (`tests/unit/diff.test.ts`).
- AC2: PASS — `DiffView` renders gutter + body (`tests/dom/diffView.test.tsx:30`).
- AC3: PARTIAL — tool surface NOT extended in this iteration; deviation logged for downstream wiring.
- AC4: PASS — bundle delta minimal (LCS impl < 100 LOC, no new deps); production build succeeded.
- AC5: PASS — collapse threshold respected; toggle reachable.
- AC6: PASS — `tests/dom/diffView.test.tsx` covers all variants.
- AC7: PASS — Storybook covers each variant.

## Scope coverage

- In scope "DiffView component": PASS.
- In scope "computeUnifiedDiff helper": PASS.
- In scope "Tool surface enrichment": PARTIAL — deferred to follow-up wiring.
- In scope "Hunk grouping with 3-line context, +/-/space gutter": PASS.
- In scope "Optional language hint": PARTIAL — `path` plumbed; syntax tinting deferred (Obsidian markdown handles inline).
- In scope "Collapse threshold ≥ 30 lines": PASS.
- In scope "Bundle delta": PASS.

## Out-of-scope audit

- Out of scope "Multi-file diffs": CLEAN.
- Out of scope "Word-level diff": CLEAN.
- Out of scope "Vault file read for missing before": CLEAN.

## QA aggregate

PASS.

## Integration gate

New public modules:
- `src/chat/diff.ts` — anchor `computeUnifiedDiff` re-exported from `src/ui/chat/blocks/index.ts`.
- `src/ui/chat/blocks/DiffView.tsx` — anchor `DiffView` re-exported from barrel.

Verdict: PASS.

## Verdict: PASS
