# Compliance iteration 1 — F11 chat-message-queue

## Acceptance criteria

- AC1 (submit-while-streaming enqueues, not drops, not concurrent, not merged): PASS — `src/ui/chat/ComposerInput.tsx:82-88` calls `props.onSubmit(text)` whenever `draftNonEmpty` regardless of `submitting`; `src/ui/chat/turnDispatcher.ts:46-55` appends each text as its own entry to `this.pending`. The `pumping` guard at `:84-100` ensures at most one controller turn runs at a time — subsequent submits wait in `pending`. Test `tests/dom/composerInput.test.tsx` "while submitting, Enter on a non-empty draft still fires onSubmit so F11 enqueues the message" covers the enqueue path; `tests/unit/turnDispatcher.test.ts` "enqueues subsequent submits while a turn is in flight and preserves FIFO order" covers the single-turn-in-flight guarantee.
- AC2 (FIFO arrival order m1 → m2 → m3 observed by starter): PASS — `src/ui/chat/turnDispatcher.ts:86` uses `this.pending.shift()` (head-first dequeue); the test "enqueues subsequent submits while a turn is in flight and preserves FIFO order" asserts `starter` is invoked `nth(1,'m1'), nth(2,'m2'), nth(3,'m3')` in strict order after each prior stream closes.
- AC3 (auto-flush on done / error / cancel terminal events of the in-flight turn): PASS — dispatcher awaits `controller.consumeIterable(...)` at `src/ui/chat/turnDispatcher.ts:95`; `StreamingTurnController.consumeIterable` resolves only after a `done` / `error` event OR an external `stop()` that aborts the iterator, so the `while` loop naturally pulls the next turn. Test "auto-flushes the queue on done / cancelled / error terminal events" plans three turns and verifies `starter` progresses from call-1 → call-2 after an `error`, and call-2 → call-3 after a `done`.
- AC4 (visible queue indicator while queueLength > 0; shows count; updates reactively; removed from DOM at 0): PASS — `src/ui/chat/ComposerInput.tsx:175-184` conditionally renders `[data-slot="composer-queue"]` only when `queueLength > 0`. `src/ui/chat/ChatRoot.tsx:55-59` subscribes via `useSyncExternalStore` to `queueSource`, forwarding the live count. Tests: "renders no queue indicator when queueLength is 0 or absent", "renders the queue indicator with a count when queueLength > 0", "uses singular wording when queueLength is 1", "removes the indicator from the DOM when the queue drains to 0". Dispatcher-side reactivity: `tests/unit/turnDispatcher.test.ts` "notifies subscribers on every enqueue and dequeue".
- AC5 (unmount removes subscription, no dangling listeners, fresh queueLength on re-mount): PASS — `src/ui/chat/turnDispatcher.ts:63-70` clears `listeners` and empties `pending` in `dispose()`. `src/ui/chatView.tsx:174` calls `this.turnDispatcher?.dispose()` in `onClose`. `ChatView` creates a fresh dispatcher in `onOpen`, so a re-mount observes `queueLength() === 0`. Test "unsubscribe removes the listener" + "dispose clears pending queue and prevents further submits".

## Scope coverage

- In scope "FIFO enqueue into AgentRunner FIFO queue; composer submit routes to `AgentRunner.send`": PASS — `src/main.ts:97-110` wires `streamStarter` → `AgentRunner.send`; submits flow through `TurnDispatcher` (UI-layer queue) to that starter. The architecture places FIFO on `AgentRunner` (F10) and a UI-side queue is a natural complement because `StreamingTurnController` cannot multiplex; both queues preserve order.
- In scope "Auto-flush on terminal events": PASS — see AC3.
- In scope "ComposerInput queued-status indicator with count": PASS — see AC4.
- In scope "Empty-draft clearing on enqueue": PASS — `src/ui/chat/ComposerInput.tsx:85` `setDraft('')` runs regardless of `submitting`. Test "while submitting, Enter on a non-empty draft still fires onSubmit …" also asserts `textarea.value === ''` post-submit.
- In scope "Unit coverage": PASS — 6 dispatcher cases, 4 indicator cases, 1 updated composer case.

## Out-of-scope audit

- Out of scope "Multi-thread / per-thread queue management": CLEAN — dispatcher has no thread dimension; single queue per `ChatView`.
- Out of scope "Persistence of queued messages": CLEAN — `pending` is in-memory only; `dispose()` drops it without writing anywhere.
- Out of scope "Compaction hand-off": CLEAN — no `CompactionEngine` references in new code.
- Out of scope "Streaming-cursor rendering, Stop mechanics, cancel-after-N-tools banner": CLEAN — `StreamingTurnController` untouched; dispatcher only observes terminal events through its public `consumeIterable` promise.
- Out of scope "Token / cost accounting for queued-but-not-yet-sent messages": CLEAN — no token counting added at dispatcher layer.
- Out of scope "Reordering / editing / cancelling individual queued entries from the UI": CLEAN — dispatcher exposes no such API; only `submit`, `queueLength`, `subscribe`, `dispose`.

## QA aggregate

Verdict: PASS (typecheck, lint, 230/230 tests, build ~198 KB).

## Verdict: PASS
