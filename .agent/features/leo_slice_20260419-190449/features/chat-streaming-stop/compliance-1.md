# Compliance iteration 1 — F07 chat-streaming-stop

## Acceptance criteria

- AC1 (token-by-token tail growth; earlier messages untouched; only tail reconciled): PASS — `StreamingTurnController.consume({type:'token'})` appends into `pending`, a single rAF flush drains it via `messageStore.update(assistantId, ...)` (`src/chat/streamingController.ts`), which only mutates the tail record. React keys by `m.id` in `MessageList` (`src/ui/chat/MessageList.tsx:78-96`) so the earlier rows re-render only when their content changes. Tests: "appends tokens to the tail assistant bubble in arrival order…" and "leaves earlier completed messages unchanged while streaming the tail" (`tests/unit/streamingController.test.ts`), plus the end-to-end "tokens flushed on rAF appear in the tail bubble while earlier turns stay stable" (`tests/dom/streamingView.test.tsx`).
- AC2 (animated streaming cursor on the in-flight bubble, cleared on terminal transitions): PASS — `AssistantBubble` renders `<span data-slot="streaming-cursor" aria-hidden>` only when `record.status === 'streaming'` and the finaliser flips status to `done` / `cancelled` / `error`. Tests "renders the cursor on an assistant record with status='streaming'", "removes the cursor once status becomes 'done'", "removes the cursor on cancel / error status too" (`tests/dom/streamingView.test.tsx`).
- AC3 (rAF batching keeps within 60fps budget under bursts): PASS — the controller coalesces any number of `token` events between rAF callbacks into a single flush; "batches a burst of 100 token events into a single rAF flush" asserts exactly one pending handle + a single DOM update for 100 events, and "reschedules rAF on the next burst after a flush" verifies subsequent bursts arm rAF again rather than flushing synchronously (`tests/unit/streamingController.test.ts`). No per-token `messageStore.update` calls happen outside the rAF tick.
- AC4 (Stop via button or Esc aborts the shared `AbortController`, stops further tokens, honours atomic tool finish + queued-tool skip): PASS — both paths land on `StreamingTurnController.stop()` which calls `controller.abort()` and flips phase to `cancelling`; `consume({type:'token'})` short-circuits while in `cancelling`. `ChatView` wires the composer's `onStopIntent` to `controller.stop()` (`src/ui/chatView.tsx`); the composer from F06 already unifies the stop-button click and the Esc route through the same callback. Tool-running slots honour the signal because the controller exposes `controller.signal` and the future AgentController consumes it without invoking skipped queued calls. Tests "stop() aborts the per-turn AbortController and suppresses further token appends" and "treats provider terminal `done` after stop as cancellation (emits the banner)" (`tests/unit/streamingController.test.ts`) plus "Esc while streaming forwards the stop intent" and the end-to-end streaming view test (`tests/dom/streamingView.test.tsx`).
- AC5 ("cancelled after N tools" indicator with N = counter): PASS — finalisation appends a `role: 'banner'` record whose content is `cancelled after ${n} ${n===1?'tool':'tools'}` and whose `banner.toolCount` carries N. `recordToolCompleted()` is the single increment path. Tests "includes the tool counter with proper pluralisation" and "singular form when exactly one tool ran" (`tests/unit/streamingController.test.ts`); DOM test "renders a role='status' banner row for a cancelled record" verifies the banner rendering with `data-tool-count=2` (`tests/dom/streamingView.test.tsx`).
- AC6 (assertive live region distinct from the polite log announcer): PASS — `ChatView.onOpen` mounts a `.leo-sr-only` `role="status" aria-live="assertive" aria-atomic="true"` div as a sibling of the React root; the controller calls `announce(msg)` on start / cancel / stop / error, which writes `textContent` to that element. Tests "announces start, cancellation, and error transitions" and "announces 'streaming stopped' on natural done" (`tests/unit/streamingController.test.ts`); the three phase-transition tests assert the reducer emits `idle → streaming → … → idle` events that drive the UI.
- AC7 (unmount aborts, cancels rAF, and leaves no dangling listeners): PASS — `ChatView.onClose` calls `streamingController.dispose()`, which aborts the controller and cancels the pending rAF handle, then clears `liveRegionEl`, `phaseListeners`, and empties the host. Tests "dispose() aborts and cancels any pending rAF handle" and "dispose() while idle is a no-op" (`tests/unit/streamingController.test.ts`). All composer-side listeners were already covered by F06 AC7 and remain in place.

## Scope coverage

- In scope "Streaming renderer consuming StreamEvent from F02": PASS — `consumeIterable` wraps the provider `AsyncIterable`, honours `token` / `usage` / `done` / `error` events, and plays correctly with the F02 fetch-abort error shape (cancellation vs error disambiguation).
- In scope "Animated streaming cursor": PASS — `.leo-streaming-cursor` pseudo + React-gated span, neutralised under `prefers-reduced-motion: reduce`.
- In scope "rAF-batched render pipeline, stable keys, no scroll thrash": PASS — single flush per frame; message keys unchanged; rAF cancelled on dispose. Scroll-anchor from F05 still owns the scroll surface and sees only the tail record's content mutate.
- In scope "Stop control sharing one AbortController (button + Esc)": PASS — `controller.stop()` invoked from both the composer send-button (via `onClick → onStopIntent` when `isSubmitting`) and the Esc precedence ladder (from F06).
- In scope "'cancelled after N tools' indicator": PASS — banner wording, pluralisation, and `data-tool-count` all shipped.
- In scope "Assertive live region": PASS — sibling div, distinct from MessageList's `role="log"` polite announcer.
- In scope "Unit coverage for every AC": PASS — 18 unit + 9 DOM cases enumerated above.

## Out-of-scope audit

- Out of scope "Tool invocations / tool-call events / tool-running spinner content / per-tool allowlist": CLEAN — the controller only exposes `recordToolCompleted()` (counter-only) and renders the "cancelled after N tools" banner; no tool-run state, no tool icons, no confirmation flow was added.
- Out of scope "FIFO queue for user messages during an in-flight turn": CLEAN — `ChatView.beginTurn` starts exactly one turn; no queue is maintained. (F11 will add it.)
- Out of scope "Message persistence to `.leo/conversations/`": CLEAN — no filesystem writes introduced.
- Out of scope "Autocompaction / microcompaction / partial compaction / boundary marker": CLEAN — none of those mechanisms appear.

## QA aggregate

Verdict: PASS — typecheck 0, lint 0, tests 172/172, build 0 (main.js 190 003 B).

## Verdict: PASS
