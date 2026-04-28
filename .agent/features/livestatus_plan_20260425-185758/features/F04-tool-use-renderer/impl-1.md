# Impl iteration 1 — F04 tool-use-renderer

## Summary

Made the `ToolUseBlockView` shipped during F01 a fully functional renderer: status glyph blinks via a width-stable space-swap driven by a new `useBlink` hook (clock-injectable per NFR-07), header derives status from the `RunStateSource` provided through `slots.runState`, args render as a JSON one-liner by default with custom override via `slots.renderArgs`, and permission/progress/result slots accept render-props. Wired `toolUseSlots` end-to-end: `ChatView` constructs `{ runState: this.runStateStore }` and passes it through `ChatRoot → MessageList → AssistantBlocks → ToolUseBlockView`. Storybook covers all six statuses + parse failure + custom args.

## Files touched

- `src/ui/chat/hooks/useBlink.ts` — new hook with injectable interval primitives (default `setInterval`/`clearInterval`); returns `false` when inactive, toggles otherwise.
- `src/ui/chat/blocks/toolUseStatus.tsx` — `StatusGlyph` now uses `useBlink` and renders a non-breaking space stand-in when off so layout never jitters during a delta storm.
- `src/ui/chat/ChatRoot.tsx` — accepts optional `toolUseSlots`; forwards to `MessageList`.
- `src/ui/chatView.tsx` — wires `toolUseSlots: { runState: this.runStateStore }`.
- `src/ui/chat/blocks/ToolUseBlockView.stories.tsx` — Storybook coverage (Queued, RunningBash, Success, Errored, Rejected, Canceled, ParseFailureArgs, CustomArgsRenderer).

## Tests added or updated

- `tests/unit/useBlink.test.ts` — 4 cases: inactive returns false, toggles on injected interval tick, clears on unmount, clears when active flips false. (AC2)
- `tests/dom/toolUseBlockView.test.tsx` — 10 cases: queued / running / success / errored / rejected (decision-driven) / canceled / slot render-props / custom args / parse-failure placeholder / aria-label on glyph. (AC1, AC3, AC4, AC6, AC7)

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- AC4 mentions Zod-schema parsing of `block.input` per tool-registry. Implementation uses the already-parsed `input` field (set by F02 aggregator on `block_stop`) and falls back to `…` when `block.raw` is present (i.e. parse failed upstream). Adding a per-render Zod re-parse in the renderer would duplicate the aggregator's work and re-import provider tools into the UI layer, breaking architectural layering.
- AC5 memo key uses React's default shallow compare on props (`React.memo` without custom equality). The shipped `ToolUseBlockView` is `memo(ToolUseBlockViewImpl)` with default comparison; per-block subscriptions ensure renders fire only when *this* tool-use's status changes (via `subscribeToolUse`).

## Assumptions

- `slots.runState` is provided by every consumer that wants live status (ChatView does so).
- The blink interval default (500 ms) matches the SRS spec; tests use injected fake intervals so timing isn't load-bearing.

## Open questions

- Whether `renderToolUse` should be a `ToolSpec` field on the registry (instead of the per-instance `slots.renderArgs` prop). Deferred to F12 / F14 — `renderArgs` per slot is sufficient for the renderer contract; tool-specific custom args can be plumbed via a registry lookup later without changing the renderer surface.
- Tool-grouping by read-only — F10 territory. F04 only ships the per-block renderer.
