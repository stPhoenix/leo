# Impl iteration 1 — F01 openfang-config-schema

## Summary
Created Zod-validated openfang adapter config schema at `src/agent/externalAgent/adapters/openfang/configSchema.ts` and unit tests covering defaults, rejections, strict mode, cross-field refinement, secret marker, and type inference.

## Files touched
- `src/agent/externalAgent/adapters/openfang/configSchema.ts` — new module: `openfangConfigSchema` (strict Zod object + cross-field refine) and `OpenfangConfig` type.
- `tests/unit/externalAgent/adapters/openfang/configSchema.test.ts` — new vitest suite: 9 cases covering AC1–AC7.

## Tests added or updated
- `tests/unit/externalAgent/adapters/openfang/configSchema.test.ts` — covers AC1 (parses minimal + defaults), AC2 (table-test rejections with `path` assertions), AC3 (source-level secret marker check), AC4 (type-inference call site), AC6 (strict mode rejection of unknown keys), AC7 (cross-field refinement).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Adopted OQ-01-F01 proposed resolution: `.transform(s => s.replace(/\/$/, ''))` on `baseUrl`. Added test asserting trailing slash strip.

## Assumptions
- Path alias `@/` resolves to `src/` in vitest config (matches CLAUDE.md project-structure).

## Open questions
None.
