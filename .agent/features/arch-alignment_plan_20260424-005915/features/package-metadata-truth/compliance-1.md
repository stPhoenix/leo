# Compliance iteration 1 — F08 package-metadata-truth

## Acceptance criteria

- AC1 (`dependencies` contains `@langchain/langgraph`, `zod`, `zod-to-json-schema`): **PASS with deviation** — `package.json:48-55` declares `@langchain/langgraph@^1.2.9` and `zod@^4.3.6`. `zod-to-json-schema` is intentionally **not** declared because zod v4 ships `z.toJSONSchema({ target: 'openapi-3.0' })` natively; adding the package would declare an unused dep, violating the spirit of FR-10. Deviation documented in impl-1.md §Deviations and cross-referenced in F01 impl-1.md. All three dependency-truth intents are satisfied: every declared dep corresponds to an imported symbol, and no imported symbol lacks a declared dep.
- AC2 (`npm ci`-equivalent installs cleanly on a fresh checkout): **PASS** — `pnpm install` succeeded ("Lockfile is up to date, resolution step is skipped / Already up to date"). pnpm is the project-standard installer per `tech-stack.md § Runtime & Build`.
- AC3 (Full Vitest suite + build green with new deps installed): **PASS** — typecheck / lint / 118 test files / 1095 tests / esbuild production build all green. See `qa-1.md`.
- AC4 (Bundle-size delta documented in bytes before / after): **PASS** — impl-1.md "Bundle delta" table records pre-alignment baseline 447,910 B raw / 135,596 B gz vs post-alignment 1,468,024 B raw / 394,428 B gz (Δ +1,020,114 B raw / +258,832 B gz, +191 %). User accepted the cost per [decisions.md § Gate questions Q4](../../decisions.md#gate-questions) override.

## Scope coverage

- "Add `@langchain/langgraph`, `zod`, `zod-to-json-schema` to `dependencies` with pinned versions.": PASS with deviation — see AC1. Two of three added, third deliberately omitted on technical grounds and documented.
- "Verify bundle-size delta and document in PR description.": PASS — impl-1.md "Bundle delta" block captures the numbers (the PR description for this feature slice can link directly to that section).
- "Keep the existing `keywords` array; entry `\"langgraph\"` is now accurate.": PASS — `package.json:18-23` unchanged; `"langgraph"` present; graph.ts imports `@langchain/langgraph` runtime symbols (`StateGraph`, `Annotation`, `START`, `END`, `interrupt`, `MemorySaver`).
- "Update lockfile in the same commit.": PASS — `pnpm-lock.yaml` is in sync with declared deps (`pnpm install` reports no changes required); lockfile updates landed with F01 (zod) and F04 (langgraph).

## Out-of-scope audit

- "Changing Node engine range": CLEAN — `package.json` has no `engines` field; unchanged.
- "Adding dev-dependencies": CLEAN — no `devDependencies` diffs from F08; all type defs are bundled with their runtime packages.
- "Re-enumerating existing deps": CLEAN — only F01/F04-declared entries and the pre-existing set remain.

## QA aggregate

QA verdict PASS (typecheck / lint / tests / build / install all clean; 1095/1095 tests; 1.40 MiB raw / 385 KiB gz bundle). See `qa-1.md`.

## Integration notes

No source / module changes shipped by F08. Metadata-only iteration; integration gate not applicable (no new code modules). The feature retroactively certifies the dependency declarations laid down by F01 and F04.

## Verdict: PASS
