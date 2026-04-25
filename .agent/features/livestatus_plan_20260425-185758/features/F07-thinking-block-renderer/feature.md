# F07 — Thinking block renderer

## Purpose

Render `thinking` content blocks visually distinct (italic, dim, bordered, "Thinking" label) and collapsible. Default expanded while streaming, collapsed when finalised. Handle `redacted_thinking` as a closed/locked indicator. Covers [FR-12](../../context.md#functional-requirements), [NFR-05](../../context.md#non-functional-requirements).

## Scope

In scope:
- New component `ThinkingBlockView` under `src/ui/chat/blocks/ThinkingBlockView.tsx`.
- Uses `thinking` field from the `ThinkingBlock` type defined in F01.
- Shows label "Thinking", italic body, dim color via Obsidian CSS vars.
- `redacted_thinking` carries opaque `data` (string) — render only `Redacted thinking · (n bytes)` where `n = data.length`. Never reveal `data`.
- Collapse state machine: while parent message is streaming AND this block is the *last* incomplete block → expanded; otherwise collapsed-by-default with toggle.
- Provider mapping note: `thinking_delta` is Anthropic native; OpenAI-compatible providers don't expose extended thinking at the schema level. Renderer doesn't care — F02 owns that mapping. If a provider never emits thinking blocks, the renderer simply isn't reached.
- `ContentBlock.thinking` may include `signature` — not rendered, kept on the block for future verification.
- Streaming reasoning shimmer in the live indicator is F11's responsibility, not this renderer's.

Out of scope:
- Provider mapping (F02).
- Verifying signatures.

## Acceptance criteria

1. `ThinkingBlockView` renders italic dim text inside a 1-px Obsidian-themed border. Label "Thinking" visible at top. (FR-12)
2. Default collapsed when message status ≠ streaming OR block is not the latest. Toggle button switches state; preserved per block while view mounted. (FR-12)
3. `redacted_thinking` renders only the byte-count line; expand toggle absent. (FR-12)
4. Aria: `role=region aria-label="thinking"` on container; toggle has `aria-expanded`. (NFR-05)
5. DOM tests cover collapse-by-default, expand-while-streaming, redacted variant.
6. Storybook covers: expanded-streaming, collapsed-finalised, expanded-finalised (user opened), redacted-thinking.

## Dependencies

- Upstream: [F01](../F01-message-blocks/feature.md), [F02](../F02-stream-aggregator/feature.md).
- Touches: new `src/ui/chat/blocks/ThinkingBlockView.tsx`.

## Implementation notes

- Visual contract and `redacted_thinking` privacy rule: see [`livestatus.md` §7.2](../../../../srs/livestatus.md).
- React component rules: see [`code-style.md` § React 18](../../../../standards/code-style.md#react-18).
- Theming via Obsidian CSS vars: see [`code-style.md` § Styling](../../../../standards/code-style.md#styling-tailwind--obsidian).

## Open questions

- Should the dim text be subtle enough to skip from regular reading flow, or styled distinctly to advertise the model's reasoning surface? Default: distinctly bordered + dim italic, matching SRS.
- Whether to add a "copy thinking" affordance — defer; usually internal.
