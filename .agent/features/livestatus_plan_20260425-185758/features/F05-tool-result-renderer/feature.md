# F05 — Tool-result panel

## Purpose

Render every `tool_result` content block *attached* to its corresponding tool-use block, switching layout per status (success / errored / rejected / canceled) and supporting both string content and rich `RichBlock[]` content. Default monospace box; specialised renderers (diff) plug in at F12. Covers [FR-11](../../context.md#functional-requirements), [NFR-05](../../context.md#non-functional-requirements), [NFR-06](../../context.md#non-functional-requirements).

## Scope

In scope:
- New component `ToolResultBlockView` under `src/ui/chat/blocks/ToolResultBlockView.tsx`.
- Lookup table: assistant message exposes `toolUseById: Map<id, ToolUseBlock>` derived once per render via `useMemo`. Result block renders nothing standalone — it fills the matching `ToolUseBlockView` result slot through the `ResultPanelSlot` portal pattern from F04.
- Per-status layouts:
  - **success** — small monospace box, collapsed at >2000 chars with "show more"; default truncation matches [`livestatus.md` §7.4](../../../../srs/livestatus.md) (~8 KB cap, "expand" toggle).
  - **errored** — red border, full content, "Tool error" label.
  - **rejected** — gray, "Rejected by user" + reason if present.
  - **canceled** — gray strikethrough, "Canceled" + ⎋ hint.
- File-edit results route to F12 via tool-id check (`toolDef.renderResult`).
- Aria roles: panel is `role=group aria-label="tool result"`; status mapped to `data-status` for tests/Storybook.

Out of scope:
- Diff rendering — F12.
- Defining the `RichBlock[]` schema — keep at string-only in v1; reserve enum for future.
- Permission prompt — F06.

## Acceptance criteria

1. Result block discovered via `tool_use_id` lookup; if no matching tool-use exists, render a small system warning (`Duplicate or orphan tool_result <id>`) and emit a `Logger` warning. (FR-11)
2. Per-status layout matches the table above with Obsidian CSS var palette. (FR-11, NFR-06)
3. Truncation toggle keeps full content addressable; collapsed-by-default at >2 KB; "Show more" expands inline; "Show less" returns. (FR-11)
4. `toolDef.renderResult({ block, associatedToolUse })` allows tool-specific renderers (diff via F12). (FR-11)
5. Aria semantics + keyboard: `Show more` button reachable by Tab; `Enter` toggles. (NFR-05)
6. DOM tests under `tests/dom/toolResultBlockView.test.tsx` cover all four status variants + truncation toggle.
7. No re-render when an unrelated tool-use's status flips (`React.memo` on `(blockId, statusOfAssociatedToolUse, isExpanded)`).

## Dependencies

- Upstream: [F01](../F01-message-blocks/feature.md), [F03](../F03-run-state-store/feature.md), [F04](../F04-tool-use-renderer/feature.md).
- Downstream: F10 (grouping reads result panels' rendered output for summary), F12 (specific renderer).
- Touches: new `src/ui/chat/blocks/ToolResultBlockView.tsx`.

## Implementation notes

- Per-status visual contract: see [`livestatus.md` §7.4](../../../../srs/livestatus.md).
- Truncation policy + "expand" affordance: see [`livestatus.md` §14](../../../../srs/livestatus.md) (very-long results case).
- Tool result schema: existing `ToolResult` type in [`src/tools/types.ts`](../../../../../src/tools/types.ts) — string `error` or typed `data`. Keep adapter shim that maps to the SRS `tool_result.content` shape.
- Layered architecture (UI consumes Tool layer indirectly): see [`architecture.md` §2](../../../../architecture/architecture.md#2-layer-diagram).
- React memo / hooks pattern: see [`code-style.md` § React 18](../../../../standards/code-style.md#react-18).

## Open questions

- Anthropic's `tool_result.content` allows `RichBlock[]` (image, etc.). Leo's vault tools currently only emit text. Decide whether to bake in a richblock renderer skeleton now or defer until a tool needs it. Default: defer.
- Whether the assistant-message `toolUseById` index is stored on the record or derived per render. Default: derived (cheap on small N, no schema cost).
