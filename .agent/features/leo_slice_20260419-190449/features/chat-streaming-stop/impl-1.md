# Impl iteration 1 — F07 chat-streaming-stop

## Summary

Added a `StreamingTurnController` that owns the per-turn `AbortController`, batches `StreamEvent.token` bursts through `requestAnimationFrame`, and drives the tail assistant bubble, cancellation / error banners, and an assertive live region. Extended `ChatMessageRecord` with an `AssistantStatus` and a new `banner` role; `MessageList` now paints a `::after`-style streaming cursor (`data-slot="streaming-cursor"`) on `status === 'streaming'` and renders `role="status"` banner rows for cancelled / error records. `ChatRoot` subscribes to a `PhaseSource` via `useSyncExternalStore`; `ChatView` wires the controller end-to-end: composer submit starts a turn through an optional `streamStarter` dep, Esc / stop-button forward to `controller.stop()`, and the ItemView teardown disposes the controller, cancels the rAF handle, and clears the live region.

## Files touched

- `src/chat/types.ts` — extended `MessageRole` with `banner`; added `AssistantStatus`, `BannerKind`, and optional `status` / `banner` fields on `ChatMessageRecord`.
- `src/chat/messageStore.ts` — added an `update(id, patch)` mutator that reuses the existing `notify()` path for per-token tail edits without remounting earlier messages.
- `src/chat/streamingController.ts` (new) — full per-turn state machine: `startTurn` / `consume` / `consumeIterable` / `stop` / `dispose` / `recordToolCompleted`, rAF batching, abort-aware error vs cancellation finalisation, injectable schedulers/announce/nowIso for deterministic tests.
- `src/ui/chat/MessageList.tsx` — `AssistantBubble` renders the streaming cursor gated on `status === 'streaming'`; new `BannerRow` renders cancellation / error rows as `role="status"`; the list discriminates on `m.role === 'banner'` before falling through to the assistant branch.
- `src/ui/chat/ChatRoot.tsx` — accepts a `PhaseSource` (default static-idle), consumes it via `useSyncExternalStore`, derives `isSubmitting` (streaming/cancelling), and folds it into the composer props at the end so it overrides any caller hook.
- `src/ui/chatView.tsx` — owns the controller, assertive live region, and phase-listener set; `beginTurn(text)` appends the user message, starts the controller, and forwards the optional `streamStarter` iterable via `consumeIterable`; composer hooks now route to real controller actions; `onClose` disposes the controller + live region.
- `styles.css` — `.leo-sr-only`, `.leo-streaming-cursor` with a theme-variable background and the `leo-cursor-blink` keyframe, `.leo-banner` + `.leo-banner-cancelled/-error` rows (all colours via Obsidian semantic tokens), and a `@media (prefers-reduced-motion: reduce)` block neutralising the cursor animation.

## Tests added or updated

- `tests/unit/streamingController.test.ts` (new, 18 cases) — covers every AC in isolation: tail-only append order and earlier-record stability, rAF batching under 100-event bursts, `stop()` aborting the shared controller and suppressing further tokens, banner wording + tool-count pluralisation, assertive announcements on start/cancel/error/natural-done, phase transitions for streaming → cancelling → cancelled → idle (and the error and done variants), `dispose()` aborting + cancelling the pending rAF, `consumeIterable` natural-end + thrown-error + abort-mid-stream paths.
- `tests/dom/streamingView.test.tsx` (new, 9 cases) — cursor renders only for `status === 'streaming'` and disappears on `done` / `cancelled`; cancellation + error banners render with `role="status"` and correct `data-tool-count` / message; composer send-button label flips `Send ↔ Stop response` as the phase source transitions; Esc while streaming forwards `onStopIntent`; full `ChatRoot` + `StreamingTurnController` integration test appending tokens through rAF, asserting earlier rows stable, cursor present, composer in stop state, and cancellation clears cursor + appends banner + restores composer.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

None. The tool-running interlude is out of scope here (ships with F16+); this feature exposes `recordToolCompleted()` so the counter is drivable from the future AgentController but does not implement tool-running state transitions itself.

## Assumptions

- The provider emits a terminal `done` after an abort. When `stop()` is followed by `done`, the controller finalises as `cancelled`. If the provider instead throws an abort-reason, `consumeIterable` observes `signal.aborted` and still finalises as `cancelled`.
- `ChatView.beginTurn` accepts an optional `streamStarter` dep. Real wiring to `ProviderManager` / `AgentController` arrives with F10; today `main.ts` leaves it undefined, so a composer submit appends the user message and starts a streaming turn that immediately idles (no provider call). Controller state still transitions correctly; future features only need to supply `streamStarter`.
- The assistive announcer for this feature is a second `role="status" aria-live="assertive"` sibling under `.leo-chat-view-host` so it stays decoupled from the polite `role="log"` announcer F05 owns in `MessageList`.

## Open questions

None.
