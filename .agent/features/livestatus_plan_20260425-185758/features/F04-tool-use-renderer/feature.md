# F04 — Tool-use block renderer

## Purpose

Render every `tool_use` content block as a header line (`<status-glyph> <tool-name>(<short-args>)`) plus slots for inline permission prompt (F06), progress lines (F08), and result panel (F05). Status glyph color/blink derives from the run-state store (F03). This is the single most visible piece of the live status layer. Covers [FR-06](../../context.md#functional-requirements), [FR-08](../../context.md#functional-requirements), [FR-09](../../context.md#functional-requirements), [NFR-04](../../context.md#non-functional-requirements), [NFR-05](../../context.md#non-functional-requirements), [NFR-06](../../context.md#non-functional-requirements).

## Scope

In scope:
- New component `ToolUseBlockView` under `src/ui/chat/blocks/ToolUseBlockView.tsx`.
- New hook `useBlink(active: boolean): boolean` toggling on a 500 ms interval (clock-injectable).
- Status glyph: `●` colored by `statusOf` (green / red / yellow / gray / dim) and animated via space-swap (no width jitter).
- Args region: parse `block.input` via the registered tool schema (Zod) → if parse succeeds render canonical one-liner JSON (truncated ~120 chars); if not, show `…` placeholder. Tools may opt into a custom renderer via the existing `ToolRegistry` extension (`renderToolUse`).
- Slots: progress lines container (consumed by F08), permission prompt container (consumed by F06), result container (consumed by F05). All optional.
- Subscribe to run state for *this* tool-use id only (`subscribeToolUse`).
- Aria labels: glyph carries `aria-label` matching status (`running`, `succeeded`, `failed`, …).
- Caveat handling: do not nest dim immediately followed by bold spans without an explicit color reset — separate styled segments per [`livestatus.md` §7.3](../../../../srs/livestatus.md).
- Storybook coverage with all six statuses.

Out of scope:
- Tool-result panel — F05.
- Permission prompt — F06.
- Progress lines — F08.
- Sub-agent tree — F09.
- Grouping — F10.
- Diff renderer — F12.

## Acceptance criteria

1. `ToolUseBlockView` renders header line + glyph + name + truncated args, gated by `statusOf` from run-state store. (FR-06, FR-08)
2. `useBlink(true)` toggles return value at 500 ms ± 50 ms; `useBlink(false)` returns `false` and clears its interval. Vitest with `vi.useFakeTimers`. (FR-08)
3. Glyph rendering uses two siblings: a `●` span and a width-equal space span, alternated by blink. No layout jitter under hot streaming. (FR-08, NFR-06)
4. Args region: respect tool's `renderToolUse` if registered; else canonical one-liner. Parse failure shows `…`. (FR-09)
5. Component memoised with `React.memo` keyed by `(blockId, status, parsedInputHash, progressVersion)`. Unrelated message updates do not re-render this view. (NFR-04)
6. Slots are render props / children placeholders so F05/F06/F08 can mount without owning the parent layout.
7. Aria roles: glyph has `role="img" aria-label={status}`; toolname is bold-text without aria override. Status-color tokens read from Obsidian CSS vars (`var(--color-green)`, `var(--color-red)`, `var(--color-yellow)`, `var(--text-faint)`). (NFR-05, NFR-06)
8. Storybook (`ToolUseBlockView.stories.tsx`) covers: queued, running (blink), success, errored, rejected, canceled, custom-renderer (file-edit teaser, full diff is F12), parse-failure args.

## Dependencies

- Upstream: [F01](../F01-message-blocks/feature.md), [F02](../F02-stream-aggregator/feature.md), [F03](../F03-run-state-store/feature.md).
- Downstream: F05, F06, F08, F09, F10, F11, F12.
- Touches: new `src/ui/chat/blocks/ToolUseBlockView.tsx`, new `src/ui/chat/hooks/useBlink.ts`, [`src/tools/toolRegistry.ts`](../../../../../src/tools/toolRegistry.ts) (new optional `renderToolUse` field), [`src/ui/chat/MessageList.tsx`](../../../../../src/ui/chat/MessageList.tsx).

## Implementation notes

- Header layout, args truncation, blink semantics, terminal-vs-web caveat: see [`livestatus.md` §7.3](../../../../srs/livestatus.md).
- Tool registry display contract: `ToolDef.renderToolUse` shape per [`livestatus.md` §6](../../../../srs/livestatus.md).
- Existing tool registry to extend: see [`architecture.md` §3.2](../../../../architecture/architecture.md#32-agent-layer) for `ToolRegistry` ownership.
- React component conventions (hooks order, memo, no inline objects): see [`code-style.md` § React 18](../../../../standards/code-style.md#react-18).
- Theming: Obsidian CSS vars over hex per [`code-style.md` § Styling](../../../../standards/code-style.md#styling-tailwind--obsidian) and [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer).
- Animation budget: blink is the cheap path; spinner frames reserved for live indicator (F11) per [`livestatus.md` §8](../../../../srs/livestatus.md).

## Open questions

- Whether `renderToolUse` should receive a typed `parsedInput` (Zod-parsed) or the raw `block.input`. Default: typed, with a fallback `__raw` carrier for parse-failure cases. Affects tool authors — document in tool registration guide.
- Whether to ship one shared `useBlink` hook in `src/ui/chat/hooks/` or colocate it inside `ToolUseBlockView`. Default: shared — F11 will reuse the same primitive.
