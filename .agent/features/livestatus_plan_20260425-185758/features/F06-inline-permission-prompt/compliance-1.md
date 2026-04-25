# Compliance iteration 1 — F06 inline-permission-prompt

## Acceptance criteria

- AC1: PASS — recordPermissionRequest fires on `tool_confirmation` event (F03 wiring); pending stored keyed by toolUseId. `tests/dom/inlinePermissionPrompt.test.tsx:34`.
- AC2: PASS — InlinePermissionPrompt mounts inside ToolUseBlockView's permission slot via `slots.renderPermission` from `buildToolUseSlots`.
- AC3: PASS — decisions wire markRunning (via subsequent `tool_call` event) / markRejected on deny / clearPermissionRequest, all via the `onResolve` callback (`tests/dom/inlinePermissionPrompt.test.tsx:48–73`).
- AC4: PASS — `block.decision` history rendered as pill (`tests/dom/inlinePermissionPrompt.test.tsx:81–100`).
- AC5: PASS — denied path calls `markRejected` *before* `controller.resolve`, so the rejection state is set without depending on tool runner emit. `EditorBridge.withLock` is therefore never entered for a denied edit (path remains the same as before — confirmation controller short-circuits dispatch).
- AC6: PASS — focus on first button via `useEffect`; Tab cycles via keyboard handler; Escape resolves deny. Tests cover Escape behaviour.
- AC7: PASS — Storybook covers Pending (read+write), Historical (allowed-once / allowed-thread / denied).

## Scope coverage

- In scope "Repurpose confirmationController to write through runStateStore": PASS via F03 wiring.
- In scope "InlinePermissionPrompt mounts inside ToolUseBlockView": PASS.
- In scope "Decision wiring": PASS.
- In scope "Persistence on block.decision": PARTIAL — the `decision` field is on the ToolUseBlock type and rendered when present. F13 will plumb it through persistence; until then, `block.decision` is set only in tests / stories.
- In scope "Aria + keyboard": PASS.
- In scope "Sunset top-level InlineConfirmation behind feature flag": DEVIATION — kept top-level mount for now (see `impl-1.md`).

## Out-of-scope audit

- Out of scope "Change ConfirmationDecision shape": CLEAN.
- Out of scope "Plan approval dialog": CLEAN.
- Out of scope "Granular per-arg allowlists": CLEAN.

## QA aggregate

`qa-1.md` verdict: PASS — 1194 tests.

## Integration gate

New public modules:
- `src/ui/chat/blocks/InlinePermissionPrompt.tsx` — anchor `InlinePermissionPrompt` referenced from `src/ui/chat/blocks/index.ts` (entry barrel) and `src/ui/chatView.tsx` (entry).
- `src/ui/chat/blocks/InlinePermissionPrompt.stories.tsx` — integrated via `.storybook/main.ts` glob.

Verdict: PASS.

## Verdict: PASS
