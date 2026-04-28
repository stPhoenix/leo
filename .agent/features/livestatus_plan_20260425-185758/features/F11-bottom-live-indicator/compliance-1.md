# Compliance iteration 1 — F11 bottom-live-indicator

## Acceptance criteria

- AC1: PASS — hidden when idle + no in-progress tool (`tests/dom/bottomLiveIndicator.test.tsx:39`).
- AC2: PASS — `Thinking…` label when streaming + last block is text (`bottomLiveIndicator.test.tsx:48`).
- AC3: PASS — `Reasoning…` label when last block is thinking.
- AC4: PASS — `Running <tool>` with `resolveToolName`; multi-tool fallback ("Running N tools (first +K)").
- AC5: PASS — stalled label after 10 s threshold (`bottomLiveIndicator.test.tsx:97`).
- AC6: PASS — Esc handler dispatches `onCancel` (`bottomLiveIndicator.test.tsx:124`); Stop button mirrors.
- AC7: PASS — `role=status aria-live=polite` on container.
- AC8: PASS — clock + setInterval injectable.
- AC9: PASS — DOM tests cover all states.
- AC10: PASS — Storybook stories ship.

## Scope coverage

All bullets PASS.

## Out-of-scope audit

- Out of scope "Cost / usage banners": CLEAN.
- Out of scope "Compact-boundary divider": CLEAN.
- Out of scope "Provider rate-limit banners": CLEAN.

## QA aggregate

PASS.

## Integration gate

New public modules:
- `src/ui/chat/BottomLiveIndicator.tsx` — anchor referenced from `src/ui/chat/ChatRoot.tsx` (entry point).

Verdict: PASS.

## Verdict: PASS
