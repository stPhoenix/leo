# Verification — iteration 1

## Check 1 · Coverage forward

Every `FR-*` and `NFR-*` in `context.md` appears in at least one feature's `covers` column.

| Requirement | Covered by |
|-------------|-----------|
| FR-01 | F03 |
| FR-02 | F02 |
| FR-03 | F01 |
| FR-04 | F01 |
| FR-05 | F02 |
| FR-06 | F01 |
| FR-07 | F01 |
| FR-08 | F03 |
| FR-09 | F02 |
| FR-10 | F03 |
| NFR-01 | F01 |
| NFR-02 | F01 |
| NFR-03 | F01 |
| NFR-04 | F02 |
| NFR-05 | F02 |
| NFR-06 | F02 |
| NFR-07 | F03 |
| NFR-08 | F01, F03 |

PASS.

## Check 2 · Coverage backward

Every feature row has at least one `covers` entry: F01 → 8 entries, F02 → 6 entries, F03 → 5 entries. PASS.

## Check 3 · Dependency graph

Edges: F02 → F01; F03 → F01; F03 → F02. No cycles, all referenced IDs exist, topologically ordered (F01 before F02 before F03). PASS.

## Check 4 · UI docs present

| Feature | ui-needed | ui.md |
|---------|-----------|-------|
| F01 rag-snapshot | no | n/a |
| F02 rag-widget | yes | features/rag-widget/ui.md ✓ |
| F03 rag-slash-command | yes | features/rag-slash-command/ui.md ✓ |

PASS.

## Check 5 · Outline integrity

`outline.md` links resolved:

- `./context.md` ✓
- `./features-index.md` ✓
- `./features/rag-snapshot/feature.md` ✓
- `./features/rag-widget/feature.md` ✓
- `./features/rag-widget/ui.md` ✓
- `./features/rag-slash-command/feature.md` ✓
- `./features/rag-slash-command/ui.md` ✓

PASS.

## Check 6 · Section completeness

Each `feature.md` has all six required sections filled (Purpose, Scope, Acceptance criteria, Dependencies, Implementation notes, Open questions):

- F01 ✓ all six populated.
- F02 ✓ all six populated.
- F03 ✓ all six populated.

PASS.

## Check 7 · No duplication

Each `Implementation notes` section is bullet-only with markdown links plus one-sentence annotations. Longest single bullet across F01/F02/F03 ≤ ~35 words; no paragraphs > 60 words. No restated content from `.agent/architecture/` or `.agent/standards/`. PASS.

## Check 8 · External link resolution

All external `.agent/...` links resolve to existing files and anchors:

- `.agent/architecture/architecture.md#2-layer-diagram` ✓
- `.agent/architecture/architecture.md#3-modules` ✓
- `.agent/architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views` ✓
- `.agent/architecture/architecture.md#33-domain--core-pure` ✓
- `.agent/architecture/architecture.md#4-key-contracts` ✓
- `.agent/architecture/architecture.md#51-plugin-startup` ✓
- `.agent/architecture/architecture.md#54-lazy-indexing` ✓
- `.agent/architecture/architecture.md#7-error-handling-strategy` ✓
- `.agent/standards/code-style.md#typescript` ✓
- `.agent/standards/code-style.md#react-18` ✓
- `.agent/standards/code-style.md#styling-tailwind--obsidian` ✓
- `.agent/standards/code-style.md#testing-vitest--msw` ✓
- `.agent/standards/code-style.md#logging` ✓
- `.agent/standards/code-style.md#error-handling` ✓
- `.agent/standards/code-style.md#comments--docs` ✓
- `.agent/standards/tech-stack.md#ui-layer` ✓
- `.agent/standards/tech-stack.md#tooling--quality` ✓
- `.agent/standards/tech-stack.md#storage-layout` ✓
- `.agent/standards/tech-stack.md#platform-apis` ✓

PASS.

## Verdict: PASS
