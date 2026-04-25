# F06 — UI: inline permission prompt

## Layout

Pending (mounted inside ToolUseBlockView's permission slot):

```
● Bash(cmd: "rm -rf node_modules")               ← header from F04
   ⚠ Allow Bash to run `rm -rf node_modules`?
       [ Allow once ]  [ Allow for thread ]  [ Deny ]   (Esc = Deny)
   └─ args (hidden until decided)
   └─ result panel slot (empty)
```

Historical answered (decision persisted on block):

```
● Bash(cmd: "rm -rf node_modules")
   · Decision: Denied (or "Allowed once", "Allowed for thread")
   └─ result panel slot              (rejection result block here)
```

## State machine

```
absent ──recordPermissionRequest──▶ pending
pending ──resolve(allow-once)──▶ resolved-allow ──markRunning──▶ (running)
pending ──resolve(allow-thread)─▶ resolved-allow + allowlist update ──▶ (running)
pending ──resolve(deny)────────▶ resolved-deny ──markRejected──▶ (rejected)
pending ──Esc──────────────────▶ resolved-deny
resolved-* ──persist on block.decision──▶ historical (button-less)
```

## Event flow

```
1. LangGraph fires interrupt() for a tool with requiresConfirmation=true.
2. AgentRunner emits StreamEvent.tool_confirmation; resolve() captured.
3. confirmationController.set(pending) → runStateStore.recordPermissionRequest(toolUseId, request).
4. ToolUseBlockView (subscribed) renders InlinePermissionPrompt in its permission slot.
5. User clicks button → confirmationController.resolve(decision).
6. resolve() → AgentRunner resumes graph with Command({resume: decision}).
7. AgentRunner calls runStateStore.markRunning(id) or markRejected(id) accordingly.
8. confirmationController fires controller.subscribe → runStateStore.clearPermissionRequest(id).
9. Block.decision written for replay (F13 persists).
```

## Component mapping

| UI region | Component | Source |
|---|---|---|
| Prompt container | `InlinePermissionPrompt` | this feature |
| Header / question | `<PromptHeader>` (internal) | this feature |
| Action buttons | `<PromptButtons>` (internal) | this feature |
| Historical pill | `<DecisionPill decision>` | this feature |
| Permission state source | `runStateStore.permissionRequests` (F03) | F03 |
| Resolver | `confirmationController.resolve` | existing [`src/agent/confirmationController.ts`](../../../../../src/agent/confirmationController.ts) |
| Color tokens | Obsidian CSS vars per [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer) | — |

### Storybook

`src/ui/chat/blocks/InlinePermissionPrompt.stories.tsx`. Stories:

- `PendingRead` — read-only category.
- `PendingWrite` — write category, args hidden until decided.
- `KeyboardFocus` — story exercises Tab + Esc via play function.
- `HistoricalAllowedOnce` — replay state.
- `HistoricalAllowedThread` — replay state.
- `HistoricalDenied` — replay state, no buttons.

Mocks: `mockRunStateStore` from F14 with one entry in `permissionRequests`.

## Back-link

[feature.md](./feature.md)
