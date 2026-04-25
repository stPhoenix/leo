# F14 — Storybook coverage + shared mocks

## Purpose

Establish the cross-cutting Storybook surface for live-status renderers: shared mock factories (stream events, run-state store, tool defs, progress events, permission requests, edit-diff fixtures) under `src/ui/chat/__stories__/mocks/`, and a Storybook configuration delta that themes preview with Obsidian CSS vars and clock injection. Per-feature stories ship with their respective features; this feature owns the *shared infrastructure* they depend on. Covers [FR-20](../../context.md#functional-requirements), [NFR-13](../../context.md#non-functional-requirements).

## Scope

In scope:
- Extend [`src/ui/chat/__stories__/mocks/sources.ts`](../../../../../src/ui/chat/__stories__/mocks/sources.ts) with:
  - `mockMessageStore({ blocks })` — `ChatMessageStore` populated with typed-block fixtures.
  - `mockRunStateStore({ inProgress?, resolved?, errored?, rejected?, canceled?, progress?, permissions? })` — pre-filled `RunStateStore` with subscribe/getSnapshot.
  - `mockToolRegistry({ defs })` — registers test tool defs with optional `renderToolUse` / `renderResult`.
  - `mockStreamingController({ phase, lastEventAt? })` — minimal controller for indicator stories.
  - `mockProgressEvents({ kind, count })` — generators per kind (bash/web_search/mcp/agent/skill/task_output).
  - `mockEditDiff({ before, after })` — stable strings used by F12 stories.
  - `mockClock(t0, opts?)` — frozen / advancing fake clock used by blink, shimmer, stalled detector.
- New Storybook decorators in [`.storybook/preview.ts`](../../../../../.storybook/preview.ts):
  - `withObsidianVars` — wraps stories with `.leo-root` class so existing CSS vars apply.
  - `withClock` — Storybook-controls-driven clock for animation stories (drop-in for `useBlink` / shimmer).
  - `withMockMarkdown` — drop-in `renderMarkdown` using `markdown-it` (already in mocks tree) so chat-bubble stories don't need Obsidian.
- Document conventions in `docs/storybook-conventions.md`? — No, tracked via inline JSDoc on the mocks; CLAUDE.md operating rule §5 forbids ad-hoc doc files.
- Per-component story baseline exists for: `AssistantBlocks`, `ToolUseBlockView`, `ToolResultBlockView`, `InlinePermissionPrompt`, `ThinkingBlockView`, `ProgressLines`, `AgentProgressTree`, `GroupedToolUses`, `BottomLiveIndicator`, `DiffView`. Each story file lives next to its component (existing convention).

Out of scope:
- Visual-regression snapshot harness — defer.
- Per-component stories beyond what each feature delivers (those stories belong to the owning feature, not here).
- New `addons/*` packages.

## Acceptance criteria

1. Shared mocks added to `src/ui/chat/__stories__/mocks/` and exported via barrel for consumption by component stories. (FR-20)
2. Storybook builds (`pnpm build-storybook`) without errors after each feature lands its stories. (FR-20)
3. `withObsidianVars` decorator applied globally; stories inherit Obsidian CSS-var palette (verified by visual sanity check on `ChatRoot.stories.tsx`). (NFR-13)
4. `withClock` decorator allows pausing / scrubbing time for blink + shimmer + stalled-detector stories. (NFR-07 transitive)
5. No story imports `@langchain/langgraph` or `obsidian` — alias path in [`.storybook/main.ts`](../../../../../.storybook/main.ts) already routes to mocks; verify with a build assertion script.
6. Mocks are TypeScript-strict and avoid `any` per [`code-style.md` § TypeScript](../../../../standards/code-style.md#typescript).
7. Each per-feature story file follows the same naming + slot pattern; shared fixtures referenced via barrel imports.

## Dependencies

- Upstream: F01 (typed blocks), F02 (event union), F03 (run state), F04–F12 (renderers under test).
- Touches: [`src/ui/chat/__stories__/mocks/sources.ts`](../../../../../src/ui/chat/__stories__/mocks/sources.ts), [`.storybook/preview.ts`](../../../../../.storybook/preview.ts), [`.storybook/main.ts`](../../../../../.storybook/main.ts) (new alias if needed).

## Implementation notes

- Existing Storybook config (alias, externals): see [`tech-stack.md` § Tooling & Quality](../../../../standards/tech-stack.md#tooling--quality) (Storybook listed under build/dev) and the existing `pnpm storybook` / `pnpm build-storybook` scripts in [`project-structure.md`](../../../../standards/project-structure.md).
- Existing mock layout & convention: see [`project-structure.md`](../../../../standards/project-structure.md) (`src/ui/chat/__stories__/mocks/` already documented).
- Test isolation rule (no real network / DB / clock): see [`code-style.md` § Testing](../../../../standards/code-style.md#testing-vitest--msw).
- Layered architecture compliance (mocks live in UI layer, no platform imports): see [`architecture.md` §2](../../../../architecture/architecture.md#2-layer-diagram).

## Open questions

- Clock injection design: per-component prop vs Storybook decorator. Default: decorator with optional per-story override prop. Tracked as [OQ-06](../../context.md#open-questions).
- Whether to ship a "story playbook" page using addon-docs for newcomers. Default: defer until at least 5 features have landed; revisit during F14 implementation.
