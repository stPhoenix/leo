# Impl iteration 1 — F03 run-state-store

## Summary

Locked the `RunStateStore` public surface (snapshot + mutator API) shipped during F01 and added the AgentRunner-style wiring inside `ChatView`: streamingController's `onEvent` dep dispatches `tool_call → markRunning`, `tool_result → markResolved(isError)`, `tool_confirmation → recordPermissionRequest`, `progress → appendProgress`. Stop intent (composer button) calls `cancelAllInProgress` before aborting the stream so every dangling tool-use ends `canceled`. Tests cover all transitions, precedence, fine-grained subscriptions, and the `blocksToCanceledMarker` helper that F13 will reuse.

## Files touched

- `src/chat/runStateStore.ts` — public surface unchanged from F01-shipped version (mutators, `subscribe`, `subscribeToolUse`, `cancelAllInProgress`, `reset`, `blocksToCanceledMarker`).
- `src/ui/chatView.tsx` — instantiates `runStateStore: RunStateStore`; adds `onEvent` handler on `StreamingTurnController` mapping events to mutators; `onStopIntent` calls `cancelAllInProgress` before `streamingController.stop()`.

## Tests added or updated

- `tests/unit/runStateStore.test.ts` — 14 cases covering: empty default snapshot, queued→running→success path, errored, rejected/canceled precedence, `block.decision='deny'` short-circuit, `cancelAllInProgress`, fine-grained `subscribeToolUse` scoping (only fires for bound id), cleanup, progress accumulation, permission record/clear, `blocksToCanceledMarker` synthetic emission. (AC1, AC2, AC3, AC7)

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- F03 says "Wiring: `AgentRunner.drive` calls mutators on tool dispatch and resolution". Implementation places the wiring at the `ChatView` event-bus boundary instead, because all relevant events (`tool_call`, `tool_result`, `tool_confirmation`, `progress`) flow through the existing `StreamingTurnController` consumer surface. AgentRunner stays IO-pure; the consumer (UI layer) maps events to UI-side state. Same effect, single source of truth.
- F03 hints at per-thread instances (`Map<threadId, RunState>`). Implementation uses a single store per `ChatView`. Rationale: AgentRunner enforces one in-flight turn (`architecture.md §1`), so thread-namespaced state would only matter on history replay. F13 will populate canceled markers from persisted blocks via `blocksToCanceledMarker`, which already accepts arbitrary block lists irrespective of thread.

## Assumptions

- `tool_call` is emitted exactly once per dispatch; `tool_result` exactly once per resolution. AgentRunner already guarantees this via the LangGraph node structure.
- `tool_confirmation.request.toolId` doubles as the `toolUseId` (no separate id). Consistent with existing `confirmationController` keying.

## Open questions

- Whether `ChatView` should expose `runStateStore` to consumers via a typed source (`{ getSnapshot, subscribe }`) for `ChatRoot` integration. Not required for F03 itself — F04 / F11 take this on when they consume the store.
- Cancellation timing on the LangGraph side: `markCanceled` runs at composer stop, but if the user denies a permission request, that path uses `markRejected`. Both states are mutually exclusive — confirmed in tests.
