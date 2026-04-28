# Features index

Sequenced top-down: each row implementable on top of all prior rows. `covers` traces back to [`context.md`](context.md) IDs.

**Scope note (post-revision):** F09 and F10 (built-in adapters `claude-code` and `openai-compatible`) were removed from the v1 plan per user direction. v1 ships the contract + plumbing only; concrete adapters land as additive contributions in a follow-up phase. Feature IDs F09 and F10 are intentionally retired and not reused. FR-EXT-32 is therefore deferred (see [`context.md`](context.md) Out of scope + FR-EXT-32 row).

| # | id | slug | name | purpose | deps | ui-needed | priority | covers |
|---|----|------|------|---------|------|-----------|----------|--------|
| 1 | F01 | adapter-contract | Adapter contract & registry | Define `ExternalAgentAdapter` abstract class, `ExternalEvent` / `ExternalAgentInput` types, and `AdapterRegistry`. Establish vault-isolation invariant for adapters. | — | no | high | FR-EXT-28, FR-EXT-29, FR-EXT-31, NFR-EXT-02 |
| 2 | F02 | result-writer | Result writer & RAG exclude wiring | `ResultWriter` writes `externalAgentResults/<runId>/{request,response,error}.md` + adapter files via `VaultAdapter`. Adds folder prefix to `excludeListStore` defaults and filters it at `dirtyQueue` intake. | F01 | no | high | FR-EXT-19, FR-EXT-20, FR-EXT-21, NFR-EXT-03 |
| 3 | F03 | subgraph-state-machine | Subgraph state + state machine | Typed `ExternalAgentState`, LangGraph `StateGraph` skeleton with node stubs, per-thread one-slot enforcement, mock-adapter unit harness. | F01 | no | high | FR-EXT-05, FR-EXT-06, NFR-EXT-08 |
| 4 | F04 | refine-sub-agent | Refine sub-agent (PREPARING phase) | Refine system prompt, LLM loop using thread provider, restricted action set (`ask_clarifying_question`, `emit_final_prompt`), budget enforcement, `interrupt()` for clarifying questions. | F03 | no | high | FR-EXT-07, FR-EXT-08, FR-EXT-09, FR-EXT-10 |
| 5 | F05 | run-phase | Run phase + write/error transitions | Calls `adapter.start()`, threads `AbortSignal`, enforces timeout, accumulates events, drives WRITING / DONE / ERROR transitions, returns structured tool result. | F02, F03 | no | high | FR-EXT-15, FR-EXT-16, FR-EXT-17, FR-EXT-18, FR-EXT-22, FR-EXT-23, FR-EXT-24, NFR-EXT-01, NFR-EXT-07 |
| 6 | F06 | delegate-external-tool | `delegate_external` trigger tool | Built-in tool with `requiresConfirmation: true`, Prepare / Deny actions via existing `confirmationController`, suspended-tool semantics, busy-slot guard. | F03 | no | high | FR-EXT-01, FR-EXT-02, FR-EXT-03, FR-EXT-04, FR-EXT-06 |
| 7 | F07 | widget-controller | Widget controller (bridge) | `widgetController.ts` projects `ExternalAgentState` → widget store events; resolves widget actions back into the subgraph; reload → ERROR rehydration. | F03, F04, F05 | no | high | NFR-EXT-04 |
| 8 | F08 | widget-ui | Inline widget UI + Storybook | `ExternalAgentWidget.tsx` with phase-driven views (preparing, ready, running, terminal collapsed), Send/Edit/Cancel buttons, adapter picker (handles empty registry), timeout/budget inputs, response stream panel, event log. Storybook fixtures per phase. | F07 | yes | high | FR-EXT-11, FR-EXT-12, FR-EXT-13, FR-EXT-14, FR-EXT-25, FR-EXT-26, FR-EXT-27 |
| 9 | F11 | settings-ui | Settings UI section + per-adapter config | "External Agents" section in `SettingsTab`: default-adapter dropdown, per-adapter `enabled` toggle, config blocks rendered from `configSchema`, secret fields via `SafeStorage`. Renders empty-state when registry has zero adapters. Storybook fixtures (use a `MockAdapter` stub from F03). | F01 | yes | high | FR-EXT-30, FR-EXT-33, FR-EXT-34 |
| 10 | F12 | history-persistence | History persistence + rehydration | New persisted block kind `external_agent_widget` in `messageStore` / `chat/types.ts`. Terminal-state widget records (refine transcript, refined prompt, folder, files, duration, error) survive thread reopens. | F08 | no | medium | FR-EXT-26 (persistence portion) |
| 11 | F13 | logging-bundle | Logging hygiene + bundle budget | `Logger` namespace `externalAgent.*`; payloads gated to `debug` level; esbuild bundle-size check ≤ 30 KB added by external-agent contract + plumbing. | F01, F08, F11 | no | medium | NFR-EXT-05, NFR-EXT-06 |

> Feature IDs **F09** and **F10** are intentionally retired (built-in adapter implementations deferred). Sequence numbers (`#`) are renumbered to be contiguous; feature IDs (`Fxx`) are stable.

## Coverage check (forward)

Every requirement in [`context.md`](context.md) appears in at least one `covers` cell above, *except* FR-EXT-32 which is explicitly deferred (see scope note above and `context.md` Out of scope).

| Requirement | Covered by |
|---|---|
| FR-EXT-01 | F06 |
| FR-EXT-02 | F06 |
| FR-EXT-03 | F06 |
| FR-EXT-04 | F06 |
| FR-EXT-05 | F03 |
| FR-EXT-06 | F03, F06 |
| FR-EXT-07 | F04 |
| FR-EXT-08 | F04 |
| FR-EXT-09 | F04 |
| FR-EXT-10 | F04 |
| FR-EXT-11 | F08 |
| FR-EXT-12 | F08 |
| FR-EXT-13 | F08 |
| FR-EXT-14 | F08 |
| FR-EXT-15 | F05 |
| FR-EXT-16 | F05 |
| FR-EXT-17 | F05 |
| FR-EXT-18 | F05, F08 |
| FR-EXT-19 | F02 |
| FR-EXT-20 | F02 |
| FR-EXT-21 | F02 |
| FR-EXT-22 | F05 |
| FR-EXT-23 | F02, F05 |
| FR-EXT-24 | F05 |
| FR-EXT-25 | F08 |
| FR-EXT-26 | F08, F12 |
| FR-EXT-27 | F08 |
| FR-EXT-28 | F01 |
| FR-EXT-29 | F01 |
| FR-EXT-30 | F11 |
| FR-EXT-31 | F01 |
| FR-EXT-32 | **DEFERRED** — concrete built-in adapters out of v1 (see scope note) |
| FR-EXT-33 | F11 |
| FR-EXT-34 | F11 |
| NFR-EXT-01 | F05 |
| NFR-EXT-02 | F01 |
| NFR-EXT-03 | F02 |
| NFR-EXT-04 | F07, F12 |
| NFR-EXT-05 | F13 |
| NFR-EXT-06 | F13 |
| NFR-EXT-07 | F05 |
| NFR-EXT-08 | F03 |

## Dependency graph

```
F01 ─┬─► F02 ─┐
     ├─► F03 ─┬─► F04 ─┐
     │        ├─► F06   │
     │        └─────────┼─► F05 ─┐
     │                  │        │
     │                  └────────┼─► F07 ─► F08 ─► F12
     │                                                ▲
     └────────────────────────────► F11 ──────────────┤
                                                      │
                              F01 + F08 + F11 ───────► F13
```

DAG, no cycles. Topological linearization (matches `#` ordering above): F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08 → F11 → F12 → F13.

## Architecture compliance summary

Per [`.agent/architecture/architecture.md`](../../architecture/architecture.md) §1–§2 (layered, unidirectional deps; pure core / IO at edges; registry pattern; interrupt-driven tool flow), every feature in this index respects:

### Layering

UI features (F08, F11) depend only on Agent-layer features (F07, F01); Agent features (F03–F07) depend on the contract (F01) and on the result-writer Adapter (F02); the result-writer (F02) is itself an Adapter-layer module that imports only `VaultAdapter`, `excludeListStore`, `dirtyQueue`, and pure helpers — never Agent / UI / Chat state. Although `ResultWriter`'s file lives under `src/agent/externalAgent/` for cohesion with the subgraph that consumes it, its **role** is Adapter-layer (it owns vault IO and exposes a typed boundary). The lint rule from F01 enforces this on adapter implementation files; the `ResultWriter` and other Adapter-layer files under the same directory observe the rule by code-review discipline.

### Pure core

F03 state machine, F04 `refinePrompt.ts`, and F02 path sanitizer are pure. IO is isolated to specific IO-edge node functions in F03/F05 and to the `ResultWriter.write` boundary in F02. Pure modules are unit-testable without msw, fake-indexeddb, or any provider stub.

### Registry pattern

F01's `AdapterRegistry` mirrors the existing `ToolRegistry` shape from [`.agent/architecture/architecture.md`](../../architecture/architecture.md) §3.2 (register / list / lookup, frozen after plugin-load registration, settings-aware default selection).

### Interrupt-driven tool flow

F04 (clarifying-question interrupt) and F06 (Prepare/Deny confirmation) reuse the existing LangGraph `interrupt()` + `confirmationController` machinery from [`.agent/architecture/architecture.md`](../../architecture/architecture.md) §1, §5.3. No ad-hoc event buses are introduced. F06's Prepare/Deny labels and per-call (no-allowlist) confirmation are an **additive** extension of the existing controller's options object — not a deviation from the interrupt-driven pattern.

### One in-flight rule (FR-AGENT-07)

This is the cross-feature compliance point worth spelling out. The global `AgentRunner` enforces one in-flight *main-agent turn* per plugin instance via FR-AGENT-07. In the external-agent slice:

- The main agent issues a `delegate_external` tool call; that call requires confirmation (F06).
- On user-Prepare, the tool **suspends** — its Promise does not resolve until the subgraph reaches a terminal state.
- While the tool is suspended, the main agent is paused at `interrupt()` and is **not** consuming the provider stream.
- The subgraph (F03–F05) takes over: it may call `ProviderManager` for the refine sub-agent (F04) and then `adapter.start()` for the run phase (F05). At any moment, exactly one of `{main-agent stream | refine stream | adapter stream}` is active.
- F03's per-thread slot (`Map<threadId, RunHandle>`) is **additive** scope on top of the global rule — it ensures only one subgraph runs per thread; it does not replace or weaken `AgentRunner`'s rule.
- F04's refine sub-agent calls `ProviderManager` **directly**, not through `AgentRunner.send()`. Routing it through `AgentRunner` would deadlock — the main turn already holds `AgentRunner`'s slot. The refine call is internal to the already-in-flight main turn, not a new user message.
- When the subgraph reaches a terminal state, the suspended tool call resumes with the structured tool result (F05's `terminal` node), and the main agent regains the provider stream.

This is the architectural contract: **suspension semantics preserve FR-AGENT-07 across the subgraph boundary**.

### Fail-safe IO

F02 and F05 wrap every IO call in `try/finally`. F02's writer always emits `error.md` on failure paths even when `request.md` / `response.md` writes succeed only partially. F05's `run` node disposes the adapter iterator and clears timeouts in `finally` regardless of how the run ends. When concrete adapters land in the follow-up phase, they are required by F01 + F13 to surface errors as `ExternalEvent.error` rather than throwing, and to terminate within ≤ 2 s of `signal.aborted` (NFR-EXT-01).
