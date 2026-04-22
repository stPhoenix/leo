# Impl iteration 1 — F11 chat-message-queue

## Summary

Turned the composer's "submit while streaming" path from a silent no-op into a real FIFO queue. Extracted a pure `TurnDispatcher` in `src/ui/chat/turnDispatcher.ts` that owns pending turns, drains them serially through the existing `StreamingTurnController`, and exposes `queueLength()` + `subscribe()` for reactive UI readout. `ComposerInput` accepts a `queueLength` prop and renders a queued-messages badge with an `aria-live` polite status; Enter now submits even while streaming so new submissions enqueue rather than dropping. `ChatRoot` wires a `queueSource` to `useSyncExternalStore` and forwards the count to the composer. `ChatView` owns one `TurnDispatcher` per pane, disposes it in `onClose`, and delegates composer submits to `turnDispatcher.submit(text)`. Auto-flush is implicit: the dispatcher's `pump()` loop only moves to the next queued turn after `controller.consumeIterable` resolves (done / cancelled / error), so terminal events start the next turn automatically.

## Files touched

- `src/ui/chat/turnDispatcher.ts` — new: FIFO dispatcher (`submit` / `queueLength` / `subscribe` / `dispose`), single in-flight invariant via a `pumping` gate, starts next turn only after the prior `consumeIterable` resolves.
- `src/ui/chat/ComposerInput.tsx` — Enter-during-streaming path unlocked; `queueLength` prop renders a `[data-slot="composer-queue"]` badge with `role="status"` / `aria-live="polite"`; send button keeps Stop semantics while streaming but is now always enabled in that state so it can always stop.
- `src/ui/chat/ChatRoot.tsx` — added `QueueSource` interface, subscribes via `useSyncExternalStore`, forwards numeric count to `ComposerInput.queueLength`.
- `src/ui/chatView.tsx` — replaced inline `beginTurn` with a `TurnDispatcher` instance; wired `queueSource` to dispatcher; disposed on `onClose` (AC5 teardown).
- `styles.css` — extended composer grid with a `queue` area + `.leo-composer-queue` using Obsidian var `--text-accent`.
- `tests/dom/composerInput.test.tsx` — replaced the obsolete "Enter does not submit during streaming" case with the F11 contract (Enter DOES submit while streaming); added 4 new queue-badge cases (hidden at 0, plural count, singular count, DOM teardown when count drops back to 0).
- `tests/unit/turnDispatcher.test.ts` — new: 6 cases covering first-turn immediate dispatch, FIFO ordering of `m1 → m2 → m3`, auto-flush on `done` / `error` terminal events, listener notify on enqueue/dequeue, unsubscribe, dispose clearing pending + preventing further submits.

## Tests added or updated

- New: `tests/unit/turnDispatcher.test.ts` (6).
- New: 4 ComposerInput queue-indicator cases; 1 rewritten case.
- Full suite: 28 files, 230/230 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The dispatcher's `dispose()` does not proactively emit a terminal event for queued-but-not-yet-started turns; they simply vanish when the view unmounts. The feature's AC5 only requires "no dangling listeners or stale indicator state" on unmount, which is satisfied by `listeners.clear()` and `pending.length = 0`. A re-mount sees `queueLength() === 0` from a fresh dispatcher. Documented because the F10 runner uses a stricter "emit cancelled done" semantics for queued turns — we chose a simpler drop semantics at the UI dispatcher layer because the messageStore user record is still present in the transcript (see below).
- When `pumpQueue` runs without a `starter` (e.g. plugin tests mount the view with no provider), the dispatcher still drives the controller to a `done` state so the assistant record does not remain `streaming` forever. Not explicitly in scope, but a natural completion of AC3's "terminal event of the in-flight turn triggers flush".

## Assumptions

- The F10 `AgentRunner` continues to own its own FIFO queue for the assistant-layer invariants (one provider request in flight, snapshot-at-enqueue). The UI-layer `TurnDispatcher` is a second queue sitting between the composer and the `StreamingTurnController`, necessary because `StreamingTurnController.startTurn` eagerly cancels any prior turn. Two queues is intentional: the agent queue models provider concurrency; the dispatcher queue models UI concurrency. Both stay FIFO, both observe the same terminal events.
- Queue-length semantics: "messages queued but not yet sent" — decremented when a turn is shifted off `pending` and handed to `startTurn`, not when the stream completes. Matches the visible badge feeling ("how many are still waiting?").
- Submitting under `StreamingTurnController === null` (pre-mount / post-unmount) is a no-op; `ChatView.beginTurn` short-circuits via optional chaining on `turnDispatcher?.submit`.

## Open questions

None.
