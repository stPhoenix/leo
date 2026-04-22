# F10 — AgentController core loop

## Purpose

Stand up the `AgentRunner` singleton that every chat turn routes through: it receives the user message plus the Focused Context snapshot emitted by F08 per [FR-AGENT-01](../../context.md#fr-agent-01), assembles the system prompt from active skill + active note + RAG hits + conversation history with the strict truncation priority active note > RAG > history > skill examples per [FR-AGENT-03](../../context.md#fr-agent-03), drives a serial turn loop that keeps exactly one request in flight (tool calls remain serial inside the loop) per [FR-AGENT-07](../../context.md#fr-agent-07), applies a pre-compaction fallback — trim oldest history first, then RAG, preserving active-note context — whenever the assembled prompt risks context-window overflow ahead of the not-yet-built `CompactionEngine` per [FR-AGENT-08](../../context.md#fr-agent-08), and hands every request a scoped `AbortController` so Stop cancels cleanly while any in-flight tool finishes atomically per [FR-AGENT-09](../../context.md#fr-agent-09). It is the spine the later tool-use, confirmation, persistence, and compaction features plug into.

## Scope

### In scope

- `AgentRunner` singleton owning in-flight state, a FIFO queue, and a per-request `AbortController` wired through [F02 provider-lmstudio-core](../provider-lmstudio-core/feature.md)'s `ProviderManager.stream(prompt, signal)` callsite per [FR-AGENT-07](../../context.md#fr-agent-07) and [FR-AGENT-09](../../context.md#fr-agent-09).
- `AgentRunner.send(msg, thread)` entry point that accepts the user message plus the latest `FocusedContext` pushed from [F08 editor-bridge-focused-context](../editor-bridge-focused-context/feature.md) per [FR-AGENT-01](../../context.md#fr-agent-01) and returns an `AsyncIterable<StreamEvent>` matching the contract fixed in [architecture §4](../../../../architecture/architecture.md#4-key-contracts).
- `ContextAssembler` wiring that composes the system prompt from `{activeSkill.systemPrompt, activeNote, RAGHits, history}` in the priority order active note > RAG > history > skill examples per [FR-AGENT-03](../../context.md#fr-agent-03). RAG and skill inputs are stubbed to placeholders until F21/F22/F31 land; the assembly order itself is permanent.
- `Truncator` pure function — given a message set + token budget — returning a trimmed set that preserves the priority ladder above and serves as the pre-compaction fallback per [FR-AGENT-08](../../context.md#fr-agent-08). Token counting uses the rough `len/4` tier until [FR-COMPACT-02](../../context.md#fr-compact-02) ships.
- Serial turn loop: enqueue → assemble → call provider → stream `token` / `usage` / `done` events → drain queue per [FR-AGENT-07](../../context.md#fr-agent-07). Tool-call branches stay a no-op stub that errors out loudly until F16+.
- `cancel(thread)` wired to `AbortController.abort()`; active tool call (when tools land) is allowed to finish atomically, remaining queued tool calls are skipped per [FR-AGENT-09](../../context.md#fr-agent-09).
- Structured log events (`agent.turn.start`, `agent.turn.cancel`, `agent.turn.truncate`, `agent.turn.done`) through the F01 `Logger`; Vitest coverage for queue FIFO order, cancellation, truncation priority ladder, and context-overflow fallback behavior.

### Out of scope

- Tool registry, built-in read/write tools, `tool_call` / `tool_result` handling, and per-tool confirmation state machine → ship with [F16+](../../features-index.md) (`tool-registry-builtin-read`, `tool-confirmation`, built-in read/write tools).
- RAG retrieval / graph boosts / `RAGEngine.query` → ship with F31 `rag-engine-cosine-search`; `AgentRunner` calls a stub hits-provider until then.
- `CompactionEngine` (microcompaction, autocompact, PTL recovery, circuit breaker) → ships in F42+ per [FR-COMPACT-01](../../context.md#fr-compact-01); this feature only delivers the pre-compaction fallback.
- Skill loading, `.leo/skills/` parsing, and per-thread skill application → ship with F21/F22; here the active skill is a hard-coded "General" stub.
- Conversation persistence to `.leo/conversations/` → ships with F14 `conversation-store-persistence`; history lives in memory only for this feature.
- Token-usage display, per-message tokens/cost UI → owned by F12 `token-usage-indicator`; this feature only forwards the provider's `usage` event.

## Acceptance criteria

1. `AgentRunner.send(msg, thread)` accepts a `UserMessage` plus the latest `FocusedContext` from the F08 push channel and emits a `StreamEvent` `AsyncIterable`; the Focused Context snapshot used is the one current at enqueue time, not at dequeue time. (FR-AGENT-01)
2. `ContextAssembler` composes the system prompt from active skill system prompt, active note content, RAG hits (stubbed), and conversation history, and the resulting prompt is structured so a pre-compaction budget check can drop segments in the order skill examples → history → RAG → active note (i.e. priority preservation is active note > RAG > history > skill examples). (FR-AGENT-03)
3. `AgentRunner` enforces at most one turn in flight: a second `send()` while a turn is running enqueues FIFO and only begins after `done` / `error` / `cancel` of the current turn; tool calls within a single turn are driven serially on the same single-turn slot. (FR-AGENT-07)
4. When the assembled prompt exceeds the configured pre-compaction budget, `Truncator` deterministically drops oldest history messages first, then RAG hits, and never drops active-note context; the post-truncation prompt is what is sent to `ProviderManager.stream`, and an `agent.turn.truncate` log event records counts dropped per layer. (FR-AGENT-08)
5. `AgentRunner.cancel(thread)` calls `AbortController.abort()` on the in-flight turn's signal; the provider stream terminates as a non-error abort, any active tool (once F16 lands) is allowed to finish atomically, remaining queued tool calls are skipped, and the `StreamEvent` stream completes with `done` carrying a cancellation marker. (FR-AGENT-09)
6. The per-request `AbortController` is wired through the provider `fetch` call surfaced by [F02](../provider-lmstudio-core/feature.md) and through the (future) `ToolCtx.abort` signal; no code path holds a reference that survives turn completion, and `onunload` cancels the in-flight turn before teardown. (FR-AGENT-07, FR-AGENT-09)
7. Vitest unit suite covers: FIFO ordering under concurrent `send()` calls, truncation priority ladder under shrinking budgets, `cancel()` mid-stream with a mocked provider yielding partial tokens, prompt-assembly field order, and the Focused-Context snapshot-at-enqueue rule. (FR-AGENT-01, FR-AGENT-03, FR-AGENT-07, FR-AGENT-08, FR-AGENT-09)

## Dependencies

- [F02 provider-lmstudio-core](../provider-lmstudio-core/feature.md) — provides `ProviderManager.stream(prompt, signal)` and the `StreamEvent` iterable this feature consumes, plus the `AbortController` wiring target for cancellation per [FR-PROV-01](../../context.md#fr-prov-01), [FR-PROV-03](../../context.md#fr-prov-03), [FR-PROV-05](../../context.md#fr-prov-05).
- [F08 editor-bridge-focused-context](../editor-bridge-focused-context/feature.md) — pushes `FocusedContext` snapshots that `AgentRunner.send` consumes per [FR-EDIT-02](../../context.md#fr-edit-02).
- Drives requirements [FR-AGENT-01](../../context.md#fr-agent-01), [FR-AGENT-03](../../context.md#fr-agent-03), [FR-AGENT-07](../../context.md#fr-agent-07), [FR-AGENT-08](../../context.md#fr-agent-08), [FR-AGENT-09](../../context.md#fr-agent-09).
- Downstream consumers tracked in [features-index.md](../../features-index.md): F07 (streaming UI / stop button), F12 (token usage), F14 (conversation persistence), F16+ (tool registry + confirmation), F21/F22 (skills), F31 (RAG), F42+ (compaction).

## Implementation notes

- [Architecture §3.2 Agent Layer](../../../../architecture/architecture.md#32-agent-layer) — places `AgentRunner`, `ContextAssembler`, `Truncator` in this layer; this feature delivers those three modules.
- [Architecture §4 Key Contracts — AgentRunner / StreamEvent / FocusedContext](../../../../architecture/architecture.md#4-key-contracts) — pins the `send/cancel/queueLength` signature and the `StreamEvent` union this feature emits.
- [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools) — canonical flow `ChatView → AgentRunner → RAG → ContextAssembler → ProviderManager`; this feature realises the non-tool branch.
- [Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation) — fixes the Stop sequence (abort provider, let tool finish, return "cancelled after N tools") that AC 5 encodes.
- [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership) — in-flight request, queue, abort controllers live in-memory on `AgentRunner`; no disk persistence here.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — single `AgentRunner` per plugin, FIFO queue, one `AbortController` per turn, unload cancels in-flight; all enforced by this feature.
- [Architecture §11 Mapping SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules) — `FR-AGENT-*` routes to `AgentRunner` / `graph.ts` / `ContextAssembler` / `Truncator`.
- [Tech stack — Agent Layer](../../../../standards/tech-stack.md#agent-layer) — pins LangGraph as the turn-loop host and fixes `AsyncIterable<StreamEvent>` as the chat-turn API shape used here.
- [Code style — LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer) — governs graph-node purity, state reducers, and how `AgentRunner` composes the compiled graph.
- [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency) — dictates FIFO queue primitives, `AbortSignal` plumbing, and debounced work patterns used by the runner.
- [Code style — Error Handling](../../../../standards/code-style.md#error-handling) — requires `finally` cleanup of the in-flight slot, abort controller, and queue advancement on every exit path (done / error / cancel).
- [Code style — Logging](../../../../standards/code-style.md#logging) — fixes the `event: "agent.turn.*"` + structured fields shape used by the four turn log events.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — selects the harness used by AC 7; provider is mocked at the `ProviderManager` seam, not over HTTP.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — "one in-flight, serial tools" and "truncate by priority" are first-order invariants this feature must make observable in logs.

## Open questions

- Pre-compaction budget value — SRS is silent; [FR-AGENT-08](../../context.md#fr-agent-08) only names the priority ladder. Proposing a conservative static budget (e.g. model context window minus a fixed output reserve) until `CompactionEngine` ships; verifier to confirm.
- Token-counting tier for the pre-compaction fallback — leaning on the rough `len/4` tier from [FR-COMPACT-02](../../context.md#fr-compact-02) until the hybrid estimator ships; SRS does not mandate a tier here.
- Queue semantics when `cancel()` hits a queued (not yet started) turn — SRS covers mid-flight cancel via [FR-AGENT-09](../../context.md#fr-agent-09); queued-turn cancel behavior is implicit. Proposed: `cancel(thread)` also drops queued turns for that thread.
- Relationship to the open question "Queue semantics during compaction" in [context.md](../../context.md#open-questions): once `CompactionEngine` ships, this feature's pre-compaction fallback must hand off cleanly; hand-off contract is deferred to F42+.
