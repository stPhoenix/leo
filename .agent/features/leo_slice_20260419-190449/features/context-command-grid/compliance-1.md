# Compliance iteration 1 — F47 context-command-grid

## Acceptance criteria
- AC1 (`/context` + palette → single handler): PASS — `createContextCommand` returns a `{ invoke, cancel }` handle both dispatch paths share; `isContextSlashCommand` + `CONTEXT_PALETTE_COMMAND_ID` + `CONTEXT_PALETTE_COMMAND_NAME` pin the matching predicates. Test "both slash and palette paths route to the same handler" asserts identical invocation counts from two callsites.
- AC2 (eleven-position category order): PASS — `CATEGORY_ORDER` pinned at `src/ui/contextGrid.ts:17-29`; snapshot test asserts the exact tuple.
- AC3 (absent rows skip in-place): PASS — `orderCategories` lookups via `Map<CategoryId, ContextCategory>` preserve category order without introducing placeholders; minimal "system_prompt + messages + free_space" fixture produces the three rows in `§8` order.
- AC4 (deferred rows render, contribute zero squares, excluded from denominator): PASS — `allocateSquares` returns `0` for `isDeferred: true`; `includedInDenominator` returns `false`; `buildGrid` omits deferred categories from its non-reserved/non-free loop. Tests assert both properties on a deferred fixture.
- AC5 (grid dimensions matrix): PASS — `pickGridDimensions` covers every `{contextWindow, panelWidthCh}` quadrant; four-case parametric test asserts `{5×5, 10×10, 5×10, 20×10}` totals.
- AC6 (`max(1, round)` for main, `round` for free): PASS — `allocateSquares` branches on `isFreeSpace` / `isDeferred`; three fixtures cover sub-1 bump, zero-free-space, 3.6→4 rounding, plus a deferred-yields-0 check.
- AC7 (partial-square fullness boundaries + ≥0.7 symbol gate): PASS — `fullnessFor` emits `1`/`fractional`/`0`; `symbolFor` gates at 0.7; boundary table test covers 0, 0.3, 0.7, 0.999, 1.0.
- AC8 (rendering order: categories → free → reserved tail): PASS — `buildGrid` runs three loops in fixed order; "places non-reserved/non-free categories first, then free space, then reserved buffer at the end" test asserts the tail is all-reserved and free-space squares precede the reserved tail.
- AC9 (panel-width-change re-selects dimensions without remount): PARKED pending React UI component. The pure helper `pickGridDimensions` is the re-selection primitive; `ResizeObserver` wiring lands with the component mount. Documented in `impl-1.md` deviations.
- AC10 (rejected invocation surfaces error without partial render): PASS — `createContextCommand` wraps `analyze` in try/catch, emits `context.command.failed` via the logger when present, calls `onError(err)`, and never calls `render`. Tests cover success path, error-without-render path, and cancellation aborts in-flight signal.

## Scope coverage
- In scope "slash command registration handler + palette command id/name": PASS (constants + factory shipped).
- In scope "wiring to F46 pipeline through an injected `analyze` seam + turn-scoped `AbortController`": PASS.
- In scope "category breakdown renderer + deferred handling": PASS (pure ordering helper, renderer loop).
- In scope "responsive grid selector with `{25, 100, 50, 200}` totals": PASS.
- In scope "Square allocation + partial fullness + symbol gate + rendering order": PASS.
- In scope "Vitest coverage per NFR-TEST-08": PASS — 18 cases across the five helpers + command-factory.

## Out-of-scope audit
- Out of scope "`analyzeContextUsage` / `ContextData` shape": CLEAN — renderer reads `ContextCategory[]` directly, no F46 coupling here.
- Out of scope "Suggestion generation + status-line (F48)": CLEAN — nothing in this module.
- Out of scope "Non-interactive markdown output": CLEAN — not implemented.
- Out of scope "Context-collapse / projectView": CLEAN — orthogonal.
- Out of scope "Autocompact buffer size calc": CLEAN — consumed via reserved-category token field only.
- Out of scope "Visual wireframes / ARIA / focus": CLEAN — React UI parked.

## QA aggregate
All 4 gates PASS (typecheck, lint, 884 / 884 tests across 86 files, build `main.js` ~254 KB unchanged — modules tree-shaken until `main.ts` wires the palette command + composer slash dispatch). See `qa-1.md`.

## Verdict: PASS
