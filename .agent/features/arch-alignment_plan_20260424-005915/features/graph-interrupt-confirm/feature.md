# F05 — Tool confirmation via graph interrupt

## Purpose

Replace the ad-hoc `confirmTool` callback and `ConfirmationController` resume-plumbing with LangGraph's `interrupt()` + resume so tool-confirmation gating is expressed as a first-class graph pause — see [context.md § Runtime orchestration / FR-03](../../context.md#runtime-orchestration) and [architecture.md § 1 "Interrupt-driven tool flow"](../../../../architecture/architecture.md#1-architectural-principles).

## Scope

In scope:
- Inside `handleToolCalls` (introduced by F04), call `interrupt({call, spec})` before invoking any tool with `requiresConfirmation === true` that is not already in the per-thread allowlist.
- Emit a `tool_confirmation` stream event when the graph suspends on the interrupt.
- Resume the graph with the user decision (`allow_once` / `allow_for_thread` / `deny`) via the standard LangGraph resume mechanism.
- On `allow_for_thread`, update the thread allowlist atomically before resuming.
- Keep `ConfirmationController` as a thin adapter that turns graph interrupts into existing UI confirmation UX — do not duplicate state.
- Preserve existing inline confirmation test surface in [`src/agent/confirmationController.ts`](../../../../../src/agent/confirmationController.ts) and related tests.

Out of scope:
- Redesigning UI confirmation UX (SRS FR-CHAT-13 unchanged).
- Plan-mode gating (F04 scope).
- Stream event union shape (F06).

## Acceptance criteria

1. No remaining `confirmTool`-style function passed into `AgentRunner`; confirmation is mediated by graph `interrupt()`. (FR-03)
2. The graph resumes correctly on all three user decisions without losing queued tool calls. (NFR-04)
3. `allow_for_thread` persists into thread metadata (SRS FR-AGENT-11 path) and is honored on subsequent turns. (NFR-04)
4. Cancellation mid-interrupt aborts the graph and releases any pending tool slot. (NFR-04)
5. Existing tests in [`tests/unit/`](../../../../../tests/unit/) around confirmation pass with minimal adapter shims. (NFR-01)
6. Tool calls with `requiresConfirmation === false` never trigger an interrupt. (NFR-01)

## Dependencies

- [F04 — langgraph-stategraph](../langgraph-stategraph/feature.md)
- [../../context.md § Runtime orchestration](../../context.md#runtime-orchestration)
- [../../features-index.md](../../features-index.md) row F05

## Implementation notes

- Principle — [architecture.md § 1 Architectural Principles](../../../../architecture/architecture.md#1-architectural-principles) "Interrupt-driven tool flow".
- Flow — [architecture.md § 5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation) sequence diagram.
- Error / cancellation semantics — [architecture.md § 7](../../../../architecture/architecture.md#7-error-handling-strategy) and [§ 10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).
- Standards — [code-style.md](../../../../standards/code-style.md), [best-practices.md](../../../../standards/best-practices.md).

## Open questions

1. Should the interrupt payload carry the pretty-printed args or raw? Default: raw, UI pretty-prints (matches current [`InlineConfirmation.tsx`](../../../../../src/ui/chat/InlineConfirmation.tsx)).
2. How are concurrent confirmations for parallel tool calls surfaced? Default: architecture says "tool calls serial within a request" (SRS FR-AGENT-07), so only one interrupt is ever pending — enforce with a single-slot assert.
