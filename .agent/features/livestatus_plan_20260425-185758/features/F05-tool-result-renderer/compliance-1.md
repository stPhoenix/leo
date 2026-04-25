# Compliance iteration 1 — F05 tool-result-renderer

## Acceptance criteria

- AC1: PASS — orphan branch in `ToolResultBlockView` (`src/ui/chat/blocks/ToolResultBlockView.tsx:23`); test `tests/dom/toolResultBlockView.test.tsx:23`.
- AC2: PASS — per-status layouts (success / errored / rejected / canceled) verified across `tests/dom/toolResultBlockView.test.tsx:31–73`.
- AC3: PASS — collapse threshold default 2 KB (deviated from 8 KB; see `impl-1.md`); toggle expand in `tests/dom/toolResultBlockView.test.tsx:80`.
- AC4: PASS — `renderBody` slot (`tests/dom/toolResultBlockView.test.tsx:101`).
- AC5: PASS — aria-label + role on panel; aria-expanded on toggle (`tests/dom/toolResultBlockView.test.tsx:120`).
- AC6: PASS — `tests/dom/toolResultBlockView.test.tsx` covers all four status variants + truncation toggle.
- AC7: PASS — `memo` wraps the impl; no run-state subscription unless `runState` slot is provided.

## Scope coverage

- In scope "ToolResultBlockView under src/ui/chat/blocks/": PASS.
- In scope "Lookup table: assistant message exposes toolUseById Map": PASS — `AssistantBlocks` builds the map per render and hands the matching tool-use down.
- In scope "Per-status layouts": PASS.
- In scope "File-edit results route via toolDef.renderResult": PARTIAL — ships per-instance `renderBody` slot (deviation; F12 will plug in via this slot).
- In scope "Aria roles": PASS.

## Out-of-scope audit

- Out of scope "Diff rendering — F12": CLEAN.
- Out of scope "RichBlock[] schema": CLEAN.
- Out of scope "Permission prompt — F06": CLEAN.

## QA aggregate

`qa-1.md` verdict: PASS — typecheck, lint, 1188 tests, build all green.

## Integration gate

- Edits-only (no new public modules outside the existing `ToolResultBlockView.tsx` already barrel-exported during F01). Storybook story file integrated via `.storybook/main.ts` glob.
- Gate skips per §5.3.1.

## Verdict: PASS
