# F11 — Bottom-of-chat live indicator

## Purpose

Render a persistent line below the transcript that summarises the agent's current activity: `Running <tool> · <elapsed>`, `Thinking…`, `Reasoning…`, or hidden when idle. Includes a stalled detector flipping to `Working… (no output for {n}s)` after 10 s without events. `Esc` cancels the stream and marks every in-progress tool canceled. Covers [FR-17](../../context.md#functional-requirements), [NFR-05](../../context.md#non-functional-requirements), [NFR-07](../../context.md#non-functional-requirements), [NFR-11](../../context.md#non-functional-requirements).

## Scope

In scope:
- New component `BottomLiveIndicator` under `src/ui/chat/BottomLiveIndicator.tsx`. Mounted by `ChatRoot` between `MessageList` and `ComposerInput`.
- Subscribes to:
  - `streamingController.phase` (existing) for the current message status.
  - `messageStore` last-message blocks → which content-block kind is currently streaming.
  - `runStateStore.inProgressToolUseIds` → "Running <toolName> · <elapsed>".
- Stalled detector: track `lastEventAt` (clock-injected); if `>10 s` without an event flip label.
- Animations: shimmer on "Thinking…", spinner glyph optional, blink reused via `useBlink` from F04.
- Esc keyboard handler — scope listener to `chat-root` element, fall back to a visible Stop button. Calls `streamingController.stop()` then `runStateStore.markCanceled` for every id in `inProgressToolUseIds`.
- Animation policy: drop frames silently if `requestAnimationFrame` unavailable; never block content updates.

Out of scope:
- Cost / usage banners — separate feature.
- Compact-boundary divider rendering — handled by existing banner/widget rows.
- Provider rate-limit banners — already exist in repo (`ConnectionState`).

## Acceptance criteria

1. Indicator hidden when phase=`idle` and no in-progress tool. (FR-17)
2. When phase=`streaming` and last block is text → label `Thinking…` with shimmer animation. (FR-17)
3. When last block is `thinking` → label `Reasoning…` with shimmer.
4. When `inProgressToolUseIds.size > 0` → label `Running <userFacingName> · <elapsed>` (use first id; if multiple list count). (FR-17)
5. Stalled: if `now - lastEventAt > 10000`, label flips to `Working… (no output for {n}s)`. Recovers when next event arrives. (FR-17, NFR-07)
6. Esc → calls `streamingController.stop()` and bulk-`markCanceled` for in-progress ids. Listener scoped to chat root and unmounted on dispose. (NFR-11)
7. Aria: container is `role=status aria-live=polite`. Text changes do not steal focus.
8. Clock injectable for tests; default `Date.now`. (NFR-07)
9. DOM tests cover idle, thinking, reasoning, running, stalled, esc-cancel.
10. Storybook covers each state above + transitions.

## Dependencies

- Upstream: [F02](../F02-stream-aggregator/feature.md), [F03](../F03-run-state-store/feature.md).
- Touches: new `src/ui/chat/BottomLiveIndicator.tsx`, [`src/ui/chat/ChatRoot.tsx`](../../../../../src/ui/chat/ChatRoot.tsx), [`src/chat/streamingController.ts`](../../../../../src/chat/streamingController.ts) (expose `lastEventAt`, `stop()` already exists).
- Downstream: none.

## Implementation notes

- Indicator rules + stalled detector + animation taxonomy: see [`livestatus.md` §8](../../../../srs/livestatus.md).
- Animation primitives (blink/shimmer/spinner): see [`livestatus.md` §8](../../../../srs/livestatus.md). Shimmer = char-index sweep; spinner glyphs in [`livestatus.md` §16](../../../../srs/livestatus.md).
- Cancellation discipline: see [`architecture.md` §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) and [`architecture.md` §5.6](../../../../architecture/architecture.md#56-cancellation).
- Keyboard listener cleanup: see [`code-style.md` § React 18](../../../../standards/code-style.md#react-18).

## Open questions

- Tooltip/text format when multiple tools run in parallel (Leo enforces one in-flight, but sub-agents can multiplex). Default: show count + first tool name.
- Should Esc respect a "modifier key" to avoid accidental cancels? Default: plain Esc per SRS; provide settings flag later if user complains. Tracked as [OQ-03](../../context.md#open-questions).
