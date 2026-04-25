# F14 — UI: storybook surface

## Layout

Storybook left-nav grouping (mirrors source tree):

```
Chat
├─ ChatRoot
├─ ComposerInput
├─ ContextIndicator
├─ HeaderBar
├─ IndexStatusBlock
├─ MessageActionBar
├─ PlanApprovalDialog
├─ SlashPicker
├─ ThreadSwitcher
├─ Blocks
│  ├─ AssistantBlocks
│  ├─ ToolUseBlockView
│  ├─ ToolResultBlockView
│  ├─ InlinePermissionPrompt
│  ├─ ThinkingBlockView
│  ├─ ProgressLines
│  ├─ AgentProgressTree
│  ├─ GroupedToolUses
│  └─ DiffView
└─ BottomLiveIndicator
```

Story canvas wrapping (every story):

```
┌── Storybook canvas ─────────────────────────────────┐
│  .leo-root                                          │  ← withObsidianVars
│    <Component {...args} />                          │
└─────────────────────────────────────────────────────┘
```

## State machine

Decorator stack per story:

```
RawStory ──withMockMarkdown──▶ markdown ready
        ──withObsidianVars──▶ themed (CSS vars)
        ──withClock(opts)───▶ clock injected
        ──Component──────▶ rendered
```

## Event flow

Story-level (typical streaming story):

```
1. Story setup: makes mockMessageStore + mockRunStateStore from fixtures.
2. Hands stores to component via props.
3. play() optional: advances mockClock to step blink/shimmer.
4. Storybook controls panel mutates args → re-render.
5. Optional play(): simulates user click (Esc, toggle, expand).
```

## Component mapping

| Story-level surface | Source |
|---|---|
| `withObsidianVars` decorator | new in [`.storybook/preview.ts`](../../../../../.storybook/preview.ts) |
| `withClock` decorator | new in [`.storybook/preview.ts`](../../../../../.storybook/preview.ts) |
| `withMockMarkdown` decorator | new — uses existing `markdown-it` mock or simple HTML renderer |
| Shared mocks | extend [`src/ui/chat/__stories__/mocks/sources.ts`](../../../../../src/ui/chat/__stories__/mocks/sources.ts) |
| Component stories | colocated next to each component, following the existing pattern in [`src/ui/chat/`](../../../../../src/ui/chat/) |

Stack alignment: React 18 + Storybook react-vite framework; obsidian + langgraph aliased to mocks per existing [`.storybook/main.ts`](../../../../../.storybook/main.ts). See chat UI runtime expectations in [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer).

### Storybook (this feature's own stories)

`src/ui/chat/__stories__/mocks/sources.stories.tsx` — *meta-stories* exhibiting the mocks themselves so contributors can preview fixtures:

- `RunStateScenarios` — three-column matrix: idle / mid-run / fully-resolved.
- `ProgressEventGallery` — every kind side-by-side.
- `ClockControls` — sliding clock affecting blink + shimmer simultaneously.

(Optional but useful — ships with F14.)

## Back-link

[feature.md](./feature.md)
