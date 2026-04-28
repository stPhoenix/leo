# Impl iteration 1 — F10 agent-controller-core

## Summary

Added the `AgentRunner` singleton plus its collaborators (`ContextAssembler`, `Truncator`, `estimateTokens`, `GENERAL_SKILL`) in a new `src/agent/` layer. `AgentRunner.send({thread,message})` captures the F08 `FocusedContext` snapshot at enqueue time, enqueues the turn behind a promise-chain FIFO, and returns an `AsyncIterable<AgentTurnEvent>` backed by an internal push channel. The runner assembles `{skillSystem, activeNote, ragHits, history, skillExamples}` in the architectural priority order, truncates bottom-up (examples → history → rag, never active note) when a pre-compaction budget is exceeded, invokes `ProviderManager.stream` with a per-turn `AbortController`, and emits a final `{type:'done', cancelled}` event on every exit path. `cancel(thread)` aborts the in-flight turn and marks queued turns for the same thread as cancelled; `dispose()` does both for all threads. Wired into `LeoPlugin.onload` so `ChatView` now actually talks to the LM Studio provider via a translator adapter (`AgentTurnEvent` → `StreamEvent`), and to `onunload` so plugin teardown cancels the in-flight turn.

## Files touched

- `src/agent/types.ts` — domain types (`AgentUserMessage`, `AgentHistoryMessage`, `AgentTurnEvent`, `RagHit`, `Skill`, `AssembledPromptSegments`, `TurnInput`, `GENERAL_SKILL`).
- `src/agent/tokenCount.ts` — `estimateTokens` (`len/4` tier per FR-COMPACT-02 stub).
- `src/agent/truncator.ts` — pure `truncate(segments, budget)` enforcing ladder skill-examples → history (oldest first) → rag; active note untouched.
- `src/agent/contextAssembler.ts` — `assembleContext` + `renderPrompt`; emits system message with active-note block + rag block + example block, then history in order.
- `src/agent/agentRunner.ts` — singleton with FIFO, AbortController-per-turn, structured `agent.turn.*` logging, in-memory per-thread history, and an `EventChannel` backing the returned `AsyncIterable`.
- `src/main.ts` — constructs `AgentRunner`, wires `ChatView.streamStarter` to translate `AgentTurnEvent` → `StreamEvent` and cancel the in-flight turn when the `AbortSignal` from `StreamingTurnController` fires; `onunload` now calls `agentRunner.dispose()`.
- `tests/unit/truncator.test.ts` — 6 cases covering ladder order, active-note preservation, shrinking-budget monotonicity.
- `tests/unit/contextAssembler.test.ts` — 3 cases covering segment order, null-file path, rendered system-message structure.
- `tests/unit/agentRunner.test.ts` — 9 cases: token/usage/done forwarding, FIFO ordering, snapshot-at-enqueue, cancel-mid-flight cancelled-done marker, cancel-queued, truncate log + active-note survival, dispose, provider error forwarding, history accumulation across turns.

## Tests added or updated

- `tests/unit/truncator.test.ts` (6 new)
- `tests/unit/contextAssembler.test.ts` (3 new)
- `tests/unit/agentRunner.test.ts` (9 new)
- Full suite: 27 files, 220/220 tests pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Default pre-compaction budget is set to 16 000 tokens (feature's open question noted SRS silence). Conservative placeholder; overridable via `AgentRunnerOptions.budget`; will be revisited when `CompactionEngine` ships in F43.
- LangGraph is named in the tech stack / code-style as the "turn-loop host", but for this slice — single turn, no tool nodes yet — a direct `for await` over `ProviderManager.stream` inside `AgentRunner.drive` is the canonical shape per architecture §5.2. The graph integration surface will land with F16 (tool registry) when nodes / edges are actually needed. Documented here because the deviation is intentional.
- Feature lists F10 as "no UI"; we still wired `ChatView.streamStarter` so the existing chat sidebar gets live provider streaming end-to-end. The wiring itself ships no new UI — it replaces a `streamStarter: undefined` callsite with a delegating function in `main.ts`. Keeping this in scope because it satisfies AC6's "AbortController wired through the provider fetch callsite" observably.

## Assumptions

- `cancel(thread)` drops queued turns for that thread (feature's open question proposed this; architecture §5.6's "cancelled after N tools" is about mid-flight tools, silent on queued). Queued turns receive `{type:'done', cancelled:true}` and are still consumed by the caller's iterator.
- `default` is the thread id until F14 / F37 add multi-thread management; `main.ts` hard-codes `thread: 'default'` in the `ChatView` adapter.
- Rag hits and skill loader are stubbed: `rag.query` returns `[]`, `skill` defaults to a hard-coded `GENERAL_SKILL`. F21 / F22 / F31 / F33 will replace the stubs via `AgentRunnerOptions.rag` / `.skill`.
- Provider event translation: on turn completion, the runner replaces the provider's `{type:'done'}` with its own `{type:'done', cancelled}` (never forwards the provider's done to consumers); this keeps a single terminal event.

## Open questions

None. The SRS-silent items (budget, token tier, queued-cancel semantics) are resolved here with the cheapest-viable defaults and documented as assumptions; verifier / F42+ can revisit.
