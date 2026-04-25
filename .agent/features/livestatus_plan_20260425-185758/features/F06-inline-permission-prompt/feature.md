# F06 — Inline permission prompt

## Purpose

Move the existing `InlineConfirmation` dialog *out of* its top-level slot in `ChatRoot` and *into* the relevant `ToolUseBlockView`, so the prompt sits inline above the tool's args. The decision becomes part of the tool-use's visual history; on scroll-back the user sees the question and the answer in context. Backed by F03's `permissionRequests` map. Covers [FR-10](../../context.md#functional-requirements), [NFR-05](../../context.md#non-functional-requirements), [NFR-12](../../context.md#non-functional-requirements).

## Scope

In scope:
- Repurpose `confirmationController` → write its pending request through `runStateStore.recordPermissionRequest(toolUseId, request)`.
- New component `InlinePermissionPrompt` that mounts only inside `ToolUseBlockView`'s permission slot when `runStateStore` carries a pending request for the current `toolUseId`.
- Decision wiring: clicking *Allow once / Allow for thread / Deny* calls `confirmationController.resolve(decision)`, which (a) mutates per-thread allowlist as today, (b) calls `runStateStore.clearPermissionRequest(id)`, (c) calls `markRunning(id)` (allow) or `markRejected(id)` (deny).
- Persistence: persisted decision lives on the `tool_use` block as `block.decision: 'allow-once' | 'allow-thread' | 'deny' | undefined`. Replay reads decision; if `deny` → renders the prompt as historical *answered* state ("Denied" pill, no buttons).
- Keyboard: existing focus-trap + Escape behaviour preserved; scope listener to the active prompt's container.
- Aria: `role=dialog aria-modal=true aria-label="confirm tool {toolId}"` on the prompt; `aria-live=assertive` retained.
- Sunset top-level `<InlineConfirmation />` slot in [`ChatRoot.tsx`](../../../../../src/ui/chat/ChatRoot.tsx) once renderer migration lands. (Keep behind feature flag for one release.)

Out of scope:
- Changing the `ConfirmationDecision` shape — already `allow-once | allow-thread | deny`.
- Plan approval dialog (`PlanApprovalDialog`) — separate flow, not migrated here.
- Granular per-arg allowlists.

## Acceptance criteria

1. When `confirmationController` records a pending request, `runStateStore.permissionRequests` contains the entry keyed by `toolUseId`. (FR-10, FR-04 transitive)
2. `InlinePermissionPrompt` renders only inside the matching `ToolUseBlockView`'s permission slot. The legacy top-level slot becomes a no-op when feature flag is on. (FR-10)
3. Decisions:
   - `allow-once` → `markRunning(id)`; tool dispatches; `clearPermissionRequest(id)`.
   - `allow-thread` → existing per-thread allowlist update + `markRunning(id)` + clear.
   - `deny` → `markRejected(id)`; clear; tool runner returns rejection result block.
   - `Esc` → equivalent to `deny`. (FR-10, NFR-12)
4. Decision persisted on `block.decision`; replay shows historical answered state (no buttons). (FR-10)
5. Edit lock invariant: a denied edit-tool never enters `EditorBridge.withLock` — verified by Vitest using a fake editor bridge. (NFR-12)
6. Aria + keyboard tests: focus lands on first button when prompt mounts; Tab cycles through buttons; Escape resolves `deny`. (NFR-05)
7. Storybook (`InlinePermissionPrompt.stories.tsx`) covers: pending-read, pending-write, denied-historical, allowed-historical, none.

## Dependencies

- Upstream: [F03](../F03-run-state-store/feature.md), [F04](../F04-tool-use-renderer/feature.md).
- Touches: new `src/ui/chat/blocks/InlinePermissionPrompt.tsx`, [`src/agent/confirmationController.ts`](../../../../../src/agent/confirmationController.ts), [`src/ui/chat/InlineConfirmation.tsx`](../../../../../src/ui/chat/InlineConfirmation.tsx) (deprecate top-level usage), [`src/ui/chat/ChatRoot.tsx`](../../../../../src/ui/chat/ChatRoot.tsx), [`src/agent/agentRunner.ts`](../../../../../src/agent/agentRunner.ts) (interrupt resume path).
- Downstream: F13 (persistence of `block.decision`).

## Implementation notes

- Inline-prompt-in-context rationale and shape: see [`livestatus.md` §9](../../../../srs/livestatus.md).
- Existing confirmation pattern in repo: see [`architecture.md` §1 Interrupt-driven tool flow](../../../../architecture/architecture.md#1-architectural-principles) and [`architecture.md` §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation).
- Edit-lock fail-safe rule: see [`architecture.md` §1 Fail-safe editor ops](../../../../architecture/architecture.md#1-architectural-principles).
- Keyboard / aria patterns: see [`code-style.md` § React 18](../../../../standards/code-style.md#react-18) (effects with cleanup) and existing pattern in [`InlineConfirmation.tsx`](../../../../../src/ui/chat/InlineConfirmation.tsx).
- Decision feedback rendering color tokens: Obsidian CSS vars per [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer).

## Open questions

- Migration path: land the inline prompt behind a settings flag, or replace top-level slot atomically? Default: feature flag for one release, then remove.
- For `PlanApprovalDialog` (existing) — currently top-level — should it be moved to the same inline pattern? Out of scope here; raise as follow-up if user asks.
