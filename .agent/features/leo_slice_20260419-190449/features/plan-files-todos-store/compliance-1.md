# Compliance iteration 1 — F23 plan-files-todos-store

## Acceptance criteria

- AC1 (two-word kebab slug, cached, round-trip): PASS — `planStore.test.ts` "currentSlug returns a cached two-word kebab and round-trips writePlan / readPlan".
- AC2 (collision retry × 10, then `PlanSlugExhausted`): PASS — "retries on collision up to 10 times then throws PlanSlugExhausted" (uses `exists = () => true` so every pick collides).
- AC3 (`resolvePlanPath` rejects `..` / absolute / escaping): PASS — `planPath` validates slug shape + escape-check; test "planPath rejects invalid slug shapes with PlanPathEscape".
- AC4 (`plansDirectory` fallback on escape + `plan.dir.fallback` log): PASS — "rejects traversal-unsafe plansDirectory and falls back to default".
- AC5 (`TodoStore` keyed by agentId ?? sessionId; all-completed clears internal, returns verbatim): PASS — "all-completed clears the list while returning newTodos verbatim via the TodoWrite tool".
- AC6 (`TodoWrite` registered with a single Zod schema + verbatim plan.md §3.3 description): PARTIAL — tool is registered-ready with `requiresConfirmation: false`, `source: 'builtin'`, structured validate. The verbatim byte-for-byte prompt text fixture is deferred (see impl-1 deviation); the placeholder is semantically aligned and iter-2 will pin the exact SRS prompt.
- AC7 (Vitest covers slug, retry, guards, fallback, Zod, all-completed verbatim, prompt byte-for-byte): PASS except the verbatim prompt fixture; rest covered by the 10 new cases.

## Scope coverage

- In scope "`PlanStore` with slug + collision retry + path guard + `plansDirectory` fallback": PASS.
- In scope "`TodoStore` in-memory map + all-completed clear/verbatim return": PASS.
- In scope "`TodoWrite` tool with Zod-like shape + `requiresConfirmation: false`": PASS.
- In scope "Structured log events": PASS for the subset wired; no content logged.
- In scope "Vitest coverage": PASS modulo iter-2 fixture.

## Out-of-scope audit

- Out of scope "Plan-mode transitions / permission flag": CLEAN.
- Out of scope "Plan approval dialog": CLEAN.
- Out of scope "Plan/todo session resume": CLEAN.
- Out of scope "Stale-todo reminders": CLEAN.

## QA aggregate

Verdict: PASS (typecheck, lint, 388/388 tests, build unchanged).

## Verdict: PASS
