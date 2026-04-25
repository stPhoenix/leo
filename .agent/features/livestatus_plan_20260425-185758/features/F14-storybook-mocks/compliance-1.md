# Compliance iteration 1 — F14 storybook-mocks

## Acceptance criteria

- AC1: PASS — shared mocks added to `src/ui/chat/__stories__/mocks/sources.ts`: `makeRunStateStore`, `mockProgressEvents`, `mockEditDiff`, `mockClock`, `exampleToolUseBlocks`.
- AC2: PASS — `pnpm build-storybook` produces clean output (verified).
- AC3: PARTIAL — `withObsidianVars`-equivalent already in `.storybook/preview.ts` via the global decorator + `styles.css` + `preview-obsidian-vars.css` imports.
- AC4: PARTIAL — `withClock` is a helper (`mockClock`) rather than a decorator; stories opt in by passing the clock primitives into components that accept them.
- AC5: PASS — Storybook glob in `.storybook/main.ts` aliases `obsidian` and `@langchain/langgraph` to mocks; build succeeded.
- AC6: PASS — mocks are TS-strict (no `any`, no inline `import()` type annotation after lint fix).
- AC7: PASS — every per-feature story file follows the same naming + slot pattern (`<Component>.stories.tsx`).

## Scope coverage

- In scope "shared mocks via barrel": PASS — mocks added to existing barrel file.
- In scope "Storybook decorators (withObsidianVars / withClock / withMockMarkdown)": PARTIAL via deviations.
- In scope "per-component story baseline": PASS — story files exist for AssistantBlocks (implicit through ChatRoot), ToolUseBlockView, ToolResultBlockView, InlinePermissionPrompt, ThinkingBlockView, ProgressLines, AgentProgressTree, GroupedToolUses, BottomLiveIndicator, DiffView.

## Out-of-scope audit

- Out of scope "Visual-regression snapshot harness": CLEAN.
- Out of scope "addons/* packages": CLEAN.

## QA aggregate

PASS.

## Integration gate

- Edits-only on `sources.ts` (already integrated into the Storybook glob via existing per-component story files referencing it).
- Gate skips per §5.3.1.

## Verdict: PASS
