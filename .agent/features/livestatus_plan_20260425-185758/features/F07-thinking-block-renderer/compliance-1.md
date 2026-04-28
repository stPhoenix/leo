# Compliance iteration 1 — F07 thinking-block-renderer

## Acceptance criteria

- AC1: PASS — italic dim region with "Thinking" label and length suffix when finalised.
- AC2: PASS — collapsed-by-default-when-finalised + user toggle (`tests/dom/thinkingBlockView.test.tsx:24`).
- AC3: PASS — `redacted_thinking` renders byte-count only, no toggle (`tests/dom/thinkingBlockView.test.tsx:48`).
- AC4: PASS — `role=region` + `aria-label="thinking"` on container; `aria-expanded` on toggle (`tests/dom/thinkingBlockView.test.tsx:60`).
- AC5: PASS — DOM tests cover collapse-by-default, expand-while-streaming, redacted variant.
- AC6: PASS — Storybook covers expanded-streaming / collapsed-finalised / expanded-user / redacted.

## Scope coverage

All in-scope bullets PASS.

## Out-of-scope audit

- Out of scope "provider mapping (F02)": CLEAN.
- Out of scope "verifying signatures": CLEAN — `signature` field stored on block but not validated.

## QA aggregate

PASS — 1198 tests.

## Integration gate

- Edits-only (renderer was shipped during F01); story file integrated via Storybook glob.
- Gate skips per §5.3.1.

## Verdict: PASS
