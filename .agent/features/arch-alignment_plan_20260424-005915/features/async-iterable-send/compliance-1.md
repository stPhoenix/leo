# Compliance iteration 1 — F07 async-iterable-send

## Acceptance criteria

- AC1 (`AgentRunner.send(msg, thread): AsyncIterable<StreamEvent>` matches architecture §4): **PASS** — `src/agent/agentRunner.ts:162` `send(msg: AgentUserMessage, thread: ThreadId): AsyncIterable<StreamEvent>`; `StreamEvent` is the canonical union from `src/agent/streamEvents.ts` (F06). `AgentUserMessage = { role: 'user'; content: string }` matches arch §4 `UserMessage` shape.
- AC2 (No UI or test file constructs / subscribes to `EventChannel` directly): **PASS** — `grep -rn "EventChannel" src/ tests/` returns only the class declaration in `src/agent/graph.ts:44` and the two internal consumers in `src/agent/agentRunner.ts` (`import`, `events: EventChannel<StreamEvent>` field, `new EventChannel<StreamEvent>()` instantiation). Zero hits in `src/ui/**`, `tests/unit/**`, `tests/dom/**`, or `tests/llm/**`. It is not exported from `@/agent/agentRunner`; callers consume the async iterable only.
- AC3 (Cancellation causes the async iterator to exit cleanly after a final `done` with cancelled flag): **PASS** — `runner.cancel(thread)` aborts the slot's `AbortController`; `driveWithGraph` catches the abort, `finalizeNode` pushes `{ type: 'done', cancelled: true }` and closes the channel. Covered by `tests/unit/agentRunner.test.ts` "cancel(thread) aborts the in-flight turn and emits cancelled=true done", "cancel(thread) drops queued turns for that thread with cancelled done", and "dispose cancels in-flight and drops queued turns" — all green against the two-arg signature.
- AC4 (Back-pressure documented): **PASS** — see `impl-1.md` "Back-pressure notes" section. Producer is the provider stream inside `callModelNode`; consumer is `EventChannel.iterable()`. Unbounded `pending[]` under consumer pause is acknowledged and justified (single-in-flight FIFO, cancellation is the hard stop).
- AC5 (Full Vitest suite green in the same commit that flips the return type): **PASS** — 118 test files / 1095 tests all green.

## Scope coverage

- "Update `AgentRunner.send()` return type to `AsyncIterable<StreamEvent>`": PASS — already returns `AsyncIterable<StreamEvent>` (per F06); signature updated to the arch-spec two-arg shape this iteration.
- "Provide a generator-based adapter over `EventChannel` (or ditch)": PASS — `EventChannel.iterable()` returns the adapter; returned to the caller directly.
- "Migrate `ChatView` and `src/ui/chat/turnDispatcher.ts` to `for await` consumption": PASS — `streamStarter` in `src/main.ts` is the only producer of `ChatStreamStarter` and it already does `for await (const ev of source)`; `turnDispatcher` and `streamingController` consume the returned iterable via `for await`. No code in either file touches `EventChannel`.
- "Migrate all tests that currently pump the EventChannel to `for await`": PASS — tests already used `for await` via `collect()` helper; signature-only migration performed (`{thread, message}` → `(msg, thread)`).
- "Keep `AgentRunner.cancel(thread)` and `AgentRunner.queueLength()` signatures unchanged": PASS — both untouched.

## Out-of-scope audit

- "Internal graph implementation": CLEAN — no graph node changes.
- "Stream event variant set": CLEAN — union unchanged since F06.
- "UI visual changes": CLEAN — no React/CSS diffs.

## QA aggregate

QA verdict PASS (typecheck / lint / tests / build all clean; 1095/1095 tests; 1.40 MiB bundle). See `qa-1.md`.

## Integration notes

No new modules shipped by F07. Signature change touches `src/main.ts` (entry-anchored) and all test files. `EventChannel` remains internal to `graph.ts`/`agentRunner.ts`.

## Verdict: PASS
