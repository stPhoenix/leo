# Impl iteration 1 — F11 bottom-live-indicator

## Summary

Shipped `BottomLiveIndicator` mounted between `MessageList` and `ComposerInput` inside `ChatRoot`. Subscribes to phase + message store + run-state. Picks one of: idle (hidden), Thinking…, Reasoning…, Running <tool>, Running N tools, Stalled. Stalled detector flips when `now() - lastEventAt > 10000ms`. Esc key — when phase=streaming or any tool runs — calls `onCancel`, which from `ChatView` invokes `runStateStore.cancelAllInProgress()` then `streamingController.stop()`. Stop button mirrors. Clock + interval primitives are injectable for tests.

## Files touched

- `src/ui/chat/BottomLiveIndicator.tsx` — new component.
- `src/ui/chat/ChatRoot.tsx` — mounts `BottomLiveIndicator`; new optional props (`liveIndicatorRunState`, `lastEventAtSource`, `onCancelLive`, `resolveToolName`).
- `src/ui/chatView.tsx` — wires the new props + `resolveToolName` helper that scans `messageStore` blocks for the tool-use id.
- `src/ui/chat/BottomLiveIndicator.stories.tsx` — Storybook (Idle / Thinking / Reasoning / RunningSingleTool / RunningMultiple / Stalled).

## Tests added or updated

- `tests/dom/bottomLiveIndicator.test.tsx` — 7 cases: hidden / Thinking / Reasoning / Running single / Stalled / Esc cancel / Stop button cancel. (FR-17, NFR-11)

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- F11 mentions shimmer / spinner animations. Implementation ships static label; CSS-side shimmer can be added via `data-stalled` / `data-phase` attributes by the styles layer. Not load-bearing for behaviour.
- The "Cancelling…" label is added beyond the SRS list — natural state to surface.

## Assumptions

- Indicator visibility is driven by phase + inProgress count; `lastEventAt` is supplied by the streaming controller (`streamingController.lastEventAt` getter).
- When `runState` isn't provided, indicator falls back to phase + last-block kind only.

## Open questions

- Esc key currently scoped to `document` (matches existing `InlineConfirmation`). Could be scoped to chat root only — tradeoff: scoping requires a ref forwarded from ChatRoot. Leaving global for parity with existing UI conventions.
