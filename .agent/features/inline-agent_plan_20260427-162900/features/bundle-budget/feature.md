# F17 — Bundle budget verification

## Purpose

Verify the inline-agent adapter adds ≤ 25 KB minified to `main.js`. Update `.agent/budgets/bundle-baseline.json` with the post-merge baseline, run `pnpm check:bundle` to enforce the cap, and document the actual delta. Covers NFR-IA-03.

## Scope

In scope:
- Run `pnpm build` and capture pre/post `main.js` size delta.
- If delta > 25 KB, identify offenders via esbuild metafile analysis (`esbuild.config.mjs` already supports `--metafile`); typical suspects: `@langchain/langgraph/prebuilt` (`createReactAgent`), wider `@langchain/openai` surface.
- If we can fit, set the new baseline in [`.agent/budgets/bundle-baseline.json`](../../../../.agent/budgets/bundle-baseline.json) with the documented `maxDeltaBytes` headroom unchanged.
- Document the resulting size delta in a one-paragraph note appended to [`.agent/budgets/bundle-baseline.json`](../../../../.agent/budgets/bundle-baseline.json) (as a comment field if supported, else in the PR description per repo convention).
- `pnpm check:bundle` is required to pass on CI after the merge.

Out of scope:
- Refactoring inner code paths solely to shave bytes (only triggered if we exceed 25 KB cap).
- Replacing `createReactAgent` with a hand-rolled loop (would defer to OD-IA-1 reversal — out for v1).

## Acceptance criteria

1. `pnpm build` succeeds; `main.js` size delta from current baseline ≤ 25 KB minified ([context.md#nfr-ia-03](../../context.md#non-functional-requirements)).
2. `.agent/budgets/bundle-baseline.json` updated with the new baseline and unchanged `maxDeltaBytes` headroom.
3. `pnpm check:bundle` exits 0 on the merged branch.
4. Build does not introduce a new external (non-bundled) module — `external` list in `esbuild.config.mjs` unchanged.

## Dependencies

- [F16 — graph wiring](../graph-wiring/feature.md) (final adapter wiring complete; without F16 the bundle delta is meaningless).
- [`scripts/checkBundle.mjs`](../../../../scripts/checkBundle.mjs) — existing guard, no API change.
- [`.agent/budgets/bundle-baseline.json`](../../../../.agent/budgets/bundle-baseline.json) — baseline file.
- [context.md#nfr-ia-03](../../context.md#non-functional-requirements).

## Implementation notes

- Tree-shake guidance: import LangChain via subpaths only (`@langchain/core/messages`, `@langchain/langgraph/prebuilt`) — see [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"LangGraph / Agent Layer".
- Bundle budget mechanics + the existing CI guard: [`.agent/standards/project-structure.md`](../../../../.agent/standards/project-structure.md) §"Test suites" entry for `pnpm check:bundle`.
- Tech-stack bundle ceiling: [`.agent/standards/tech-stack.md`](../../../../.agent/standards/tech-stack.md) §"Bundle Budget".
- Best-practices: act on the metric, don't tune indiscriminately ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Continuous Improvement").

## Open questions

- Does adding `createReactAgent` trigger import of a wider portion of `@langchain/langgraph` than the current main agent already pulls in? Verify against current metafile snapshot.
- If 25 KB is overshot by 1–3 KB, do we tighten allowed cap on a one-time exception or refactor? Lean: refactor (drop redundant utility imports, inline small helpers).
- If `node:fs/promises` / `node:os` get accidentally bundled (instead of marked external), the delta could spike — confirm `esbuild.config.mjs` `external` set covers all node built-ins we use.
