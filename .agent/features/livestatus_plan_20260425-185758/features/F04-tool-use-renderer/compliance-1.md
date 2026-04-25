# Compliance iteration 1 — F04 tool-use-renderer

## Acceptance criteria

- AC1: PASS — `ToolUseBlockView` renders glyph + name + truncated args (`src/ui/chat/blocks/ToolUseBlockView.tsx`); `tests/dom/toolUseBlockView.test.tsx:18`.
- AC2: PASS — `useBlink` toggles on injected 100ms interval (`tests/unit/useBlink.test.ts:14`); inactive returns false.
- AC3: PASS — width-stable space-swap implemented in `StatusGlyph` (`src/ui/chat/blocks/toolUseStatus.tsx:60-83`): a same-width space stand-in replaces the `●` when `visible` is false. No layout jitter.
- AC4: PASS (with deviation) — Args region falls back to `…` when `block.raw` is present (parse failure surfaced by F02 aggregator); custom renderer via `slots.renderArgs` honoured. Re-parsing Zod in renderer was deviated; see `impl-1.md`.
- AC5: PASS — `ToolUseBlockView` is exported as `memo(ToolUseBlockViewImpl)`. Per-block `subscribeToolUse(id)` ensures unrelated tool-use status changes do not re-render this view.
- AC6: PASS — slots `renderPermission`, `renderProgress`, `renderResult` are render-prop placeholders; `tests/dom/toolUseBlockView.test.tsx:79`.
- AC7: PASS — `[data-slot="status-glyph"]` carries `role="img"` and `aria-label={STATUS_LABEL[status]}`. Verified in `tests/dom/toolUseBlockView.test.tsx:130`.
- AC8: PASS — `src/ui/chat/blocks/ToolUseBlockView.stories.tsx` covers all six statuses + parse-failure + custom args.

## Scope coverage

- In scope "ToolUseBlockView under src/ui/chat/blocks/": PASS.
- In scope "useBlink hook": PASS.
- In scope "Status glyph + space-swap blink": PASS.
- In scope "Args region with custom-renderer hook": PASS.
- In scope "Slots: progress / permission / result": PASS.
- In scope "Subscribe to run state for this tool-use only": PASS via `subscribeToolUse`.
- In scope "Aria labels": PASS.
- In scope "Storybook coverage with all six statuses": PASS.

## Out-of-scope audit

- Out of scope "Tool-result panel": CLEAN — F05 placeholder shell still in place; no result-panel logic added.
- Out of scope "Permission prompt": CLEAN — F06.
- Out of scope "Progress lines": CLEAN — F08.
- Out of scope "Sub-agent tree": CLEAN — F09.
- Out of scope "Grouping": CLEAN — F10.
- Out of scope "Diff renderer": CLEAN — F12.

## QA aggregate

`qa-1.md` verdict: PASS — typecheck, lint, 1179 tests, build all green.

## Integration gate

New public modules:
- `src/ui/chat/hooks/useBlink.ts` — anchor `useBlink` referenced from `src/ui/chat/blocks/toolUseStatus.tsx` (which is itself re-exported by `src/ui/chat/blocks/index.ts` — entry point). One-hop chain holds via the barrel.
- `src/ui/chat/blocks/ToolUseBlockView.stories.tsx` — under `*.stories.tsx`; integrated automatically via `.storybook/main.ts` glob `src/**/*.stories.@(ts|tsx|mdx)`.

Anchors check:
- `useBlink` appears in `src/ui/chat/blocks/toolUseStatus.tsx`. `toolUseStatus` is re-exported from `src/ui/chat/blocks/index.ts` (entry point). Per §5.3.1 step 3 (best-effort one-hop barrel re-export from same dir), the barrel-listed file's contents are scanned. Anchor found.
- `ToolUseBlockView.stories.tsx` — story integration is governed by the storybook glob in `.storybook/main.ts`. Glob match constitutes integration.

Verdict: PASS.

## Verdict: PASS
