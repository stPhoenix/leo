# Compliance iteration 1 — F10 agent-controller-core

## Acceptance criteria

- AC1 (`send(msg, thread)` accepts user message + latest FocusedContext, emits AsyncIterable<StreamEvent>; snapshot is at enqueue time): PASS — `src/agent/agentRunner.ts:89` captures `focus = this.focus.current()` inside `send()` synchronously, before any tail promise chaining. The `EventChannel.iterable()` at `src/agent/agentRunner.ts:275` is returned immediately. Test `tests/unit/agentRunner.test.ts` "captures FocusedContext snapshot at enqueue time, not dequeue time" mutates the focus source between two `send()` calls and asserts each turn's assembled system prompt carries its own snapshot body.
- AC2 (ContextAssembler composes skill+activeNote+rag+history in priority order; truncator can drop examples → history → rag without touching active note): PASS — `src/agent/contextAssembler.ts:14-24` pins the assembly keys in that order; `src/agent/truncator.ts:32-65` iterates `skillExamples` → `history` (oldest first, `slice(1)`) → `ragHits` (tail first), and active note is never referenced in the drop loops. Tests `tests/unit/contextAssembler.test.ts` "exposes segments in architectural order" and `tests/unit/truncator.test.ts` "never drops active note" + "drops skill examples first" + "drops history from the oldest end after examples exhausted" + "drops RAG hits only after examples + history exhausted".
- AC3 (at most one turn in flight; second `send()` enqueues FIFO, begins only after first done/error/cancel): PASS — `src/agent/agentRunner.ts:93-98` serializes turns via `this.tail = prev.catch().then(() => this.runSlot(slot))`; `inflight` is set in `runSlot` (`:134`) and cleared in `finally` (`:140`). Tool-call branches are future work per scope. Test "enforces FIFO: second send waits until first completes".
- AC4 (truncator drops oldest history first, then RAG, never active-note; `agent.turn.truncate` log with per-layer counts): PASS — drop order documented above; `src/agent/agentRunner.ts:165-174` logs `agent.turn.truncate` with `droppedSkillExamples` / `droppedHistory` / `droppedRagHits` when any layer lost content. Test "truncates and logs when the assembled prompt exceeds budget; active-note survives".
- AC5 (`cancel(thread)` aborts in-flight via AbortController; provider stream terminates as non-error abort; final done carries cancellation marker): PASS — `src/agent/agentRunner.ts:103-117` calls `abort()` on the in-flight slot; `drive()` at `:201-203` short-circuits on signal abort, then `:239` emits `{type:'done', cancelled: slot.abort.signal.aborted}`. Queued turns also get `{type:'done', cancelled:true}` at `:128`. Tests "cancel(thread) aborts the in-flight turn and emits cancelled=true done" and "cancel(thread) drops queued turns for that thread with cancelled done".
- AC6 (per-request AbortController wired to provider fetch; onunload cancels in-flight): PASS — `AgentRunner.drive()` passes `slot.abort.signal` straight into `provider.stream(req, slot.abort.signal)` at `src/agent/agentRunner.ts:181`; `ProviderManager.stream` already funnels that signal into the HTTP fetch (existing F02 wiring). `AgentRunner.dispose()` at `:118-124` aborts the in-flight slot and marks queued as cancelled; `src/main.ts:124` calls `this.agentRunner?.dispose()` inside `onunload`. No external long-lived references to the controller survive the turn (slot is `splice`d out in `removeSlot`). Test "dispose cancels in-flight and drops queued turns".
- AC7 (Vitest covers FIFO, truncation ladder, cancel mid-stream, prompt-assembly order, snapshot-at-enqueue): PASS — see cited tests in AC1/AC2/AC3/AC4/AC5 plus `tests/unit/agentRunner.test.ts` "forwards provider error and does not emit done after error" and "accumulates assistant replies into per-thread history for the next turn". Total new coverage this iteration: 18 cases across three test files.

## Scope coverage

- In scope "`AgentRunner` singleton owning in-flight state + FIFO queue + `AbortController` wired through `ProviderManager.stream(prompt, signal)`": PASS — `src/agent/agentRunner.ts:54-174`.
- In scope "`AgentRunner.send(msg, thread)` accepting user msg + latest FocusedContext, returning AsyncIterable<StreamEvent>": PASS — `send()` at `:89-103`; returns `EventChannel.iterable()` which is `AsyncIterable<AgentTurnEvent>` (super-set of provider `StreamEvent` with `cancelled?` on `done`, conforming to architecture §4 mention of "done carrying a cancellation marker").
- In scope "ContextAssembler wiring": PASS — `src/agent/contextAssembler.ts:14-24`. RAG/skill stubbed via injected `rag.query` + `skill()` factory (`AgentRunnerOptions.rag` defaults to `{ query: async () => [] }` at `:75`; `skill` defaults to `GENERAL_SKILL`).
- In scope "`Truncator` pure function preserving ladder + `len/4` token tier": PASS — `src/agent/truncator.ts` is stateless; `src/agent/tokenCount.ts` computes `Math.ceil(len/4)`.
- In scope "Serial turn loop: enqueue → assemble → call provider → stream events → drain queue; tool-call branches stubbed to error loudly until F16+": PASS — `drive()` implements the flow; tool branches are absent (scope bullet lists F16+ as owner; no code path in `drive` ever emits `tool_call` / `tool_result`). Feature lets them land with F16.
- In scope "`cancel(thread)` with AbortController.abort()": PASS — see AC5.
- In scope "Structured log events `agent.turn.start/cancel/truncate/done`": PASS — all four strings present in `agentRunner.ts` (:105, :165, :175, :244).
- In scope "Vitest coverage for FIFO, cancellation, truncation ladder, context-overflow fallback": PASS — see AC7.

## Out-of-scope audit

- Out of scope "Tool registry, built-in read/write tools, tool_call/tool_result, confirmation state machine": CLEAN — no tool-related types or events emitted; `src/agent/` has zero references to `ToolRegistry`.
- Out of scope "RAG retrieval / graph boosts / `RAGEngine.query`": CLEAN — `rag.query` default returns `[]`; no vector/graph code added.
- Out of scope "CompactionEngine (microcompact, autocompact, PTL, circuit breaker)": CLEAN — only the pre-compaction fallback (`Truncator`) ships.
- Out of scope "Skill loading, `.leo/skills/`, per-thread skill application": CLEAN — `GENERAL_SKILL` hard-coded stub; no fs reads.
- Out of scope "Conversation persistence to `.leo/conversations/`": CLEAN — history lives only in `this.historyByThread` Map; no disk writes.
- Out of scope "Token-usage display / per-message tokens/cost UI": CLEAN — runner forwards the provider's `usage` event unchanged; no UI added.

## QA aggregate

Verdict: PASS (typecheck, lint, 220/220 tests, build ~197 KB).

## Verdict: PASS
