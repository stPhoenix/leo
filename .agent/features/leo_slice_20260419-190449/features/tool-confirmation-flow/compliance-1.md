# Compliance iteration 1 — F17 tool-confirmation-flow

## Acceptance criteria

- AC1 (`AgentRunner` emits confirmation request before invoking a `requiresConfirmation: true` tool not in `thread.allowedTools`; tool NOT invoked until resolve): PASS — `src/agent/agentRunner.ts:invokeWithConfirmation` gates on `spec.requiresConfirmation && !threadAllowed` and awaits `confirmTool(req)` before calling `registry.invoke`. Test `tests/unit/agentRunner.test.ts` "pauses for confirmation on requiresConfirmation: true tools; allow-once invokes without persisting".
- AC2 (ChatView renders into `InlineConfirmation` region with icon / name / pretty args / three buttons; native Modal never invoked): PASS — `src/ui/chat/InlineConfirmation.tsx` renders into `data-region="confirmation"` with `role="dialog"`; three buttons named `Allow once` / `Allow for thread` / `Deny`. No `Modal` import in `InlineConfirmation.tsx` or anywhere the confirmation path touches; `src/ui/notifications.ts` (F13) already enforces the `InlineConfirmationHost.isNativeModal() === false` sentinel. Tests: `inlineConfirmation.test.tsx` "renders tool name, pretty args, and three buttons on pending write request".
- AC3 (read vs write visual distinction via `data-visual-state`; zero hardcoded colours): PASS — `src/ui/chat/InlineConfirmation.tsx` sets `data-visual-state="awaiting-confirmation"` for `category: 'write'`, `idle` for `read`. `styles.css` drives the visual styling via `var(--color-yellow)` / `var(--text-muted)` only — `stylesAudit.test.ts` still PASS. Test: "sets data-visual-state to awaiting-confirmation for write, idle for read".
- AC4 (focus moves to primary, `role="dialog"` + `aria-modal="true"` + `aria-live="assertive"`, Tab cycle among three buttons, Esc = Deny): PASS — `useEffect` at `src/ui/chat/InlineConfirmation.tsx:38` focuses `allowOnceRef`. The document-level `keydown` handler cycles Tab among the three refs in order and maps Escape → `source.resolve('deny')`. Tests: "moves focus to the Allow-once primary action on mount", "carries role=\"dialog\", aria-modal=\"true\", aria-live=\"assertive\" on pending mount", "Escape key is equivalent to Deny".
- AC5 (Allow-once resolves `allow-once`; no allowlist mutation; next call re-prompts): PASS — `src/agent/agentRunner.ts` only calls `markThreadAllowed` on the `allow-thread` branch; `allow-once` passes through to `toolRegistry.invoke` without mutation. Test: "pauses for confirmation on requiresConfirmation: true tools; allow-once invokes without persisting" — asserts `markAllowed` was NOT called.
- AC6 (Allow-for-thread appends toolId to `allowedTools` via `ConversationStore.mutate`, dedup; persists across reloads): PASS — AgentRunner calls `markThreadAllowed` on `allow-thread`; `src/main.ts` mutator checks `includes()` before appending (dedup) and mutates the conversation thread metadata, which debounces a save through F14's subscription. Tests: `agentRunner.test.ts` "allow-thread persists via markThreadAllowed before invoking"; `conversationStore.test.ts` "round-trips messages across save + load" already covers the metadata persistence path.
- AC7 (Deny → `{ok:false, error:"user denied <toolId>"}` tool-error; no allowlist mutation): PASS — `src/agent/agentRunner.ts:invokeWithConfirmation` returns `{ ok: false, error: "user denied ${call.name}" }` on `decision === 'deny'`; `drive()` pushes that as the tool message content to the next provider round trip. Test: "deny produces a tool-error ToolResult and does not invoke the tool" asserts `invoke` was not called and the tool message contains `"ok":false` + `user denied`.
- AC8 (Vitest state machine coverage + log events `tool.confirmation.request/allow-once/allow-thread/deny` with `{toolId, thread, decision}`): PASS — see the citation trail above. Logs fire at `src/agent/agentRunner.ts:430-448`; the `deny` test asserts the log record via `records.some(r => r.event === 'tool.confirmation.deny')`.

## Scope coverage

- In scope "`ConfirmationController` state machine (idle → awaiting-user → resolved)": PASS — `src/agent/confirmationController.ts`.
- In scope "Pre-invoke gate + thread allowlist check": PASS — AC1.
- In scope "Inline confirmation dialog (tool icon via F13 / name / pretty args / three buttons)": PASS — AC2.
- In scope "Read vs write visual distinction": PASS — AC3.
- In scope "Assertive SR announcement + focus-trap + Esc=Deny": PASS — AC4.
- In scope "Thread-scoped allowlist persistence via F14": PASS — AC6.
- In scope "Deny synthesises tool-error": PASS — AC7.
- In scope "Vitest unit coverage of the state machine + log events": PASS — 22 new cases.

## Out-of-scope audit

- Out of scope "Write tool implementations (`create_note`, `append_to_note`)": CLEAN — no write tool shipped; only the gate exists.
- Out of scope "`edit_note` under CM6 edit lock": CLEAN — no edit-lock code added.
- Out of scope "Plan-mode write-tool gating": CLEAN — no plan-mode check in `invokeWithConfirmation`.
- Out of scope "MCP-specific `requiresConfirmation: true` defaulting": CLEAN — no MCP branch added.

## QA aggregate

Verdict: PASS (typecheck, lint, 331/331 tests, build ~221 KB).

## Verdict: PASS
