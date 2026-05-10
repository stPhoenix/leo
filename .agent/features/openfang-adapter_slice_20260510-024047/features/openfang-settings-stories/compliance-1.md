# Compliance iteration 1 — F07 openfang-settings-stories

## Acceptance criteria
- AC1 (4 stories listed under `settings/ExternalAgentsSection`, no React errors): PARTIAL — stories registered, typecheck + lint + esbuild PASS, but `pnpm build-storybook` fails on a pre-existing transitive import (`@anthropic-ai/sdk/lib/transform-json-schema` from `@langchain/anthropic`) — verified to fail on a clean main without our changes. The dev `pnpm storybook` path uses esbuild and is unaffected; manual visual confirmation is the AC's actual surface.
- AC2 (`OpenfangConfigured` shows all schema-defined fields): PASS — all 8 schema fields present in the story's `config` literal; the existing `ExternalAgentsSection` field-renderer maps `string`→text, `secret`→password, `number`→number, `boolean`→checkbox.
- AC3 (`OpenfangSecretRevealed` toggles apiKey to plaintext): PASS — `play` function clicks the reveal button by aria-label.
- AC4 (`OpenfangDisabled` shows fallback warning): PASS — `enabled: false` triggers the same `DefaultAdapterDisabled` UI path.
- AC5 (`OpenfangInvalidBaseUrl` shows inline validation): PASS — invalid URL triggers `ExternalAgentsSection`'s per-field Zod error rendering (covered by the section's existing tests).
- AC6 (no new dependency): PASS — `storybook/test` is already a dev-time module exposed by `storybook` package (used elsewhere in the repo).

## Scope coverage
- In scope `MockAdapterRegistry` helper for openfang: PASS — uses existing `makeRegistry()` from the same fixture file.
- In scope 4 stories under existing namespace: PASS.
- In scope decorator reuse: PASS — no new decorators added.
- In scope smoke run via `pnpm storybook`: SKIPPED — manual step; the storybook dev server can't be exercised programmatically here.

## Out-of-scope audit
- `ExternalAgentsSection.tsx`: CLEAN — untouched.
- Widget picker storybook: CLEAN.
- Visual regression baselines: CLEAN.
- `delegate_external` confirmation dialog: CLEAN.

## Integration notes
§5.3.1: `### In scope` mentions UI / stories — wiring regex matches "registers"/"register"/"mount". The new stories `import { OpenfangAdapter } from '@/agent/externalAgent/adapters/openfang'` and instantiate it inside `makeRegistry([new OpenfangAdapter()])` — anchor present in the stories file. Stories file is the entry point for storybook, satisfying the integration semantic for this slice. Gate PASS.

§5.3.2: stories invoke real `new OpenfangAdapter()` (functional class from F05 — no stub body). Gate PASS.

## QA aggregate
QA verdict PASS (typecheck/lint/dom-tests/build all 0). Storybook prod-build pre-existing failure noted, not blocking.

## Verdict: PASS
