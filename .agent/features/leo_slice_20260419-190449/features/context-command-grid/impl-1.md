# Impl iteration 1 — F47 context-command-grid

## Summary

Added the `/context` command pure-logic layer across two modules. `src/ui/contextGrid.ts` owns `CATEGORY_ORDER` (the eleven §8 positions), `orderCategories`, `pickGridDimensions` (5×5 / 10×10 / 5×10 / 20×10 over the `contextWindow {<1M, ≥1M}` × `panelWidth {<80ch, ≥80ch}` matrix), `exactSquares`, `allocateSquares` (`max(1, round)` for main categories, `round` for free space, `0` for deferred), `fullnessFor` (whole / fractional / zero per §9.3), `symbolFor` (`◉` at ≥ 0.7, else `◐` per §9.5), and `buildGrid` that emits squares in the §9.4 order non-reserved-main → free-space → reserved-buffer-tail while clamping to the grid total. `src/ui/contextCommand.ts` owns the slash-command regex `/^\/context\s*$/`, the palette command id `leo-show-context` + name `Leo: Show context`, and `createContextCommand(deps)` which wires a single handler shared by both dispatch paths, issues a turn-scoped `AbortController` per invocation, cancels any prior in-flight call, renders on success, and routes thrown errors through `onError` + a `context.command.failed` log event instead of rendering partial state. Deferred categories pass through the renderer with `tokens > 0` but never contribute squares and are excluded from the denominator via `includedInDenominator`.

## Files touched

- `src/ui/contextGrid.ts` — new. Exports `ContextCategory`, `CategoryId`, `CATEGORY_ORDER`, `orderCategories`, `pickGridDimensions`, `exactSquares`, `allocateSquares`, `fullnessFor`, `symbolFor`, `buildGrid`, `includedInDenominator`, `GridDimensions`, `GridSquare`.
- `src/ui/contextCommand.ts` — new. Exports `createContextCommand`, `isContextSlashCommand`, `CONTEXT_SLASH_COMMAND_REGEX`, `CONTEXT_PALETTE_COMMAND_ID`, `CONTEXT_PALETTE_COMMAND_NAME`.

## Tests added or updated

- `tests/unit/contextGrid.test.ts` — 18 cases covering AC1–AC10 except AC9 (ResizeObserver re-render is a React/DOM-level assertion deferred until the UI component lands):
  - **AC2 category order**: pins the eleven-position tuple.
  - **AC3 conditional categories**: minimal case with three rows stays in category order.
  - **AC4 deferred exclusion**: `includedInDenominator` + `allocateSquares` zero-square assertion.
  - **AC5 grid dimensions**: four-quadrant `{contextWindow, panelWidthCh}` matrix → `{5×5, 10×10, 5×10, 20×10}`.
  - **AC6 square allocation**: sub-1 category bumped to 1, zero free-space rounds to 0, 3.6 rounds to 4, deferred yields 0.
  - **AC7 partial fullness**: boundary table at 0 / 0.3 / 0.7 / 0.999 / 1.0 with symbol gate.
  - **AC8 rendering order**: non-reserved/non-free first → free space → reserved tail; free-space squares appear before the reserved tail.
  - **AC1 + AC10 command dispatch**: `isContextSlashCommand` regex (match + argument rejection), `createContextCommand` happy/error paths, cancellation aborts the in-flight signal, palette id/name pinned, and both slash/palette paths invoking the same handler.

Net delta: +18 tests (866 → 884 passing).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **No React component shipped in iteration 1.** The feature's UI — grid + breakdown mounted inside F04's ItemView — is deferred to a follow-up. Iteration 1 ships the pure grid math + command-dispatch helpers + test matrix, which is what the ACs test against. AC9 (ResizeObserver re-render) is the only AC that specifically needs the React layer; it is noted as parked pending the UI component and is mechanically easy to satisfy given the helpers below.
- **`ContextData` shape coupling is deferred.** The renderer reads `ContextCategory[]` directly, letting F46 or F48 adapt their `ContextData` to this shape without locking either direction of the dependency. When F48 lands, a narrow adapter in the UI layer translates `ContextData` → `ContextCategory[]`.
- **Slash-command dispatch plumbing**: shipped as a regex + handler factory; callers (composer submit path) will read the regex before sending and route to the handler when it matches. Matches Open question §3 "submit-path detect" proposal.
- **Palette command visibility (Open question §6)**: shipped as globally registered via the exported name/id; silent no-op when the ChatView is absent is the caller's policy.

## Assumptions

- **Panel-width measurement** (Open question §1): `pickGridDimensions` takes `panelWidthCh` directly so callers (React component) can compute char-based width via a one-time offscreen-glyph measure + `ResizeObserver`. The pure helper is orthogonal to how width is measured.
- **Deferred categories** (Open question §2): absent-is-legal; renderer skips them when missing. When present with `tokens > 0`, they still surface in the breakdown list via `orderCategories` and `includedInDenominator === false`.
- **Free space rounding edge** (Open question §4): when `round(exact) === 0`, the buffer of remaining squares stays empty (categories above naturally fill the grid). No "last category steals" logic.
- **Reserved category source** (Open question §5): a reserved category is any `ContextCategory` with `isReserved: true`; `compact_buffer` is expected to be the only one today, but the renderer is agnostic to id.

## Open questions

- **React component for ItemView mount**: deferred; AC9 ResizeObserver re-selection will be exercised when the component lands.
- **Plugin.addCommand wiring**: this feature ships the id/name constants + handler factory; `main.ts` will call `plugin.addCommand({ id: CONTEXT_PALETTE_COMMAND_ID, name: CONTEXT_PALETTE_COMMAND_NAME, callback: () => cmd.invoke() })` when the runtime plugin layer is wired.
- **`ContextData` → `ContextCategory[]` adapter**: lands with F48 or `main.ts` when the real pipeline is hooked up.
