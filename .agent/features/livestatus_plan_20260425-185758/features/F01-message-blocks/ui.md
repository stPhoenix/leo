# F01 — UI: typed-block message surface

## Layout

`AssistantBubble` shifts from a single markdown host to a vertical stack of typed-block slots. ASCII wireframe of one assistant message:

```
┌─────────────────────────────────────── leo-bubble-assistant ──┐
│ Leo · 12:34                                                   │
│                                                               │
│ [block 0 · thinking]    Thinking… (italic, dim, collapsible)  │
│ [block 1 · text]        Markdown body, streamed               │
│ [block 2 · tool_use]    ● Read(README.md)                     │
│                          └─ result panel                      │
│ [block 3 · text]        More markdown after the tool call ▍   │
│                                                               │
│ <action bar>                                                  │
└───────────────────────────────────────────────────────────────┘
```

The streaming cursor (`▍`) appears only on the *last* block of a streaming message and only when that block is a text block.

## State machine

Per assistant message:

```
empty ──first block_start──▶ streaming
                                │
                  block deltas  │  (block array grows in place)
                                ▼
                            streaming ──message_stop──▶ done
                                │
                                ├──provider error──────▶ error
                                └──user cancel─────────▶ cancelled
```

Per content-block index `i`:

```
absent ──content_block_start──▶ open ──content_block_stop──▶ closed
```

## Event flow

```
1. Aggregator emits content_block_start{index:i, type:'text'}
   → ChatMessageStore.updateBlock(messageId, i, { type:'text', text:'' })
2. Aggregator emits text_delta on i
   → ChatMessageStore.updateBlock(messageId, i, prev => ({ ...prev, text: prev.text + delta }))
3. AssistantBubble re-renders; renderer for block.type === 'text' streams markdown
4. Cursor mounted iff blocks[last].type === 'text' && message.status === 'streaming'
```

(F02 owns the aggregator; F01 owns the store API and rendering registry only.)

## Component mapping

| UI block | Component | Source |
|---|---|---|
| Per-block dispatcher | `AssistantBlocks` (new in `src/ui/chat/blocks/AssistantBlocks.tsx`) | this feature |
| Text block | `TextBlockView` (new) — wraps existing markdown + code-block enhancer | this feature |
| Thinking block | `ThinkingBlockView` — placeholder shell now, populated in F07 | F07 |
| Tool-use block | `ToolUseBlockView` — placeholder shell now, populated in F04 | F04 |
| Tool-result block | `ToolResultBlockView` — placeholder shell now, populated in F05 | F05 |
| Cursor | existing `leo-streaming-cursor` span, gated by new predicate | this feature |
| Action bar | existing `MessageActionBar`, copy switched to `toLegacyContent` | this feature |

Stack/runtime alignment: React 18 + Assistant UI primitives still drive the chat shell. See chat UI runtime in [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer). Markdown render path uses Obsidian's `MarkdownRenderer.render` per the same section (chat code blocks already enhanced via `codeBlockEnhancer`).

### Storybook

- New story: `AssistantBlocks.stories.tsx` — variants: text-only · text+toolUse+text · text+thinking+text · streaming-cursor-on-last-text · empty-array-error.
- Updates: `ChatRoot.stories.tsx` — extend mocks to feed typed-block records (uses shared mocks from F14).

## Back-link

[feature.md](./feature.md)
