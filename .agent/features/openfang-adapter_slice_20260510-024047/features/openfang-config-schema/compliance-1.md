# Compliance iteration 1 — F01 openfang-config-schema

## Acceptance criteria
- AC1 (parses minimal config + defaults): PASS — `tests/unit/externalAgent/adapters/openfang/configSchema.test.ts` "parses minimal valid config and applies defaults".
- AC2 (rejects every invalid case with path assertion): PASS — table-test cases (`rejects missing apiKey`, `rejects empty apiKey`, `rejects baseUrl not a URL`, `rejects pollInitialIntervalMs below 2000`, `rejects pollMaxIntervalMs below 2000`).
- AC3 (apiKey description starts with `secret\n`): PASS — `src/agent/externalAgent/adapters/openfang/configSchema.ts:12` + source-marker test "schema source carries .describe('secret') marker on apiKey".
- AC4 (`OpenfangConfig` exported, inferred): PASS — `configSchema.ts:53` `export type OpenfangConfig = z.infer<typeof openfangConfigSchema>` + assignment test.
- AC5 (no new top-level dependency): PASS — only `zod` (already a project dep) imported.
- AC6 (`.strict()` rejects unknown keys): PASS — `configSchema.ts:48` + test "rejects unknown keys (strict)" asserting `unrecognized_keys` issue code.
- AC7 (cross-field refinement asserted): PASS — `configSchema.ts:49` `.refine` + test "rejects pollMaxIntervalMs < pollInitialIntervalMs".

## Scope coverage
- In scope "New file `configSchema.ts` with all listed fields": PASS — all 8 fields present with documented constraints + `.describe(...)`.
- In scope "Cross-field refinement": PASS — `.refine` block.
- In scope "TS type export `OpenfangConfig`": PASS.
- In scope "Unit tests at `tests/unit/.../configSchema.test.ts`": PASS — all 7 listed cases + 2 extras (trailing-slash strip, type assignment).

## Out-of-scope audit
- Out of scope "Runtime enforcement of insecure-HTTP rule": CLEAN — no runtime guard added; F05 owns it.
- Out of scope "Settings UI rendering": CLEAN.
- Out of scope "SafeStorage indirection mechanics": CLEAN — only `.describe('secret')` marker.

## Integration notes
F01 ships pure schema + types; integration gate skips per §5.3.1 (no `### In scope` bullet matches the wiring regex; downstream registration belongs to F06). Stub-body gate skips per §5.3.2 (no wiring bullet). Both consistent with the slice DAG.

## QA aggregate
QA verdict PASS (typecheck/lint/tests/build all 0).

## Verdict: PASS
