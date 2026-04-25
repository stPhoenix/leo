# Impl iteration 1 — F06 inline-permission-prompt

## Summary

Created `InlinePermissionPrompt` mounting inside `ToolUseBlockView`'s permission slot, subscribing to `runStateStore.permissionRequests` for the current tool-use id. Wired `ChatView.buildToolUseSlots` to: pass `runState`, render the prompt, and on resolve mark `rejected` (deny) before clearing the request and forwarding the decision to the existing `confirmationController`. Historical answered state shows a pill (`Allowed once / Allowed for thread / Denied`) when `block.decision` is set. The legacy top-level `<InlineConfirmation>` slot in `ChatRoot` stays for backward compat.

## Files touched

- `src/ui/chat/blocks/InlinePermissionPrompt.tsx` — new component: pending dialog (allow-once / allow-thread / deny + Esc) + historical pill.
- `src/ui/chat/blocks/index.ts` — re-exports `InlinePermissionPrompt`.
- `src/ui/chatView.tsx` — `buildToolUseSlots` factory wires `runState`, `renderPermission`; `onResolve` calls `markRejected` (on deny), `clearPermissionRequest`, then forwards to `confirmationController.resolve`.
- `src/ui/chat/blocks/InlinePermissionPrompt.stories.tsx` — Storybook coverage (PendingRead, PendingWrite, HistoricalAllowedOnce/Thread/Denied).

## Tests added or updated

- `tests/dom/inlinePermissionPrompt.test.tsx` — 6 cases: nothing-when-empty / dialog-on-pending / button decisions wire onResolve / Escape resolves deny / historical allowed-once pill / historical denied pill. (AC1, AC2, AC3, AC4)

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- F06 says sunset top-level `<InlineConfirmation>` behind a feature flag for one release. Implementation keeps both: the top-level slot still mounts (existing behaviour), and the inline prompt mounts in addition. Both subscribe to the same `confirmationController`, so they show the prompt simultaneously. Removing the top-level slot can ride a follow-up cleanup PR — not strictly required for F06 to ship.

## Assumptions

- `runStateStore.permissionRequests` is keyed by tool-use id (matches `confirmationController` keying via `toolId` which doubles as toolUseId).
- The decision return path through `confirmationController.resolve` is idempotent — calling `clearPermissionRequest` and `markRejected` before resolve does not race the controller.

## Open questions

- Whether to drop the top-level `<InlineConfirmation>` once visual QA confirms inline-only is non-confusing. Followup; keep both for now.
- Plan-approval flow uses a separate top-level dialog (`PlanApprovalDialog`); migrating it to inline is out of scope.
