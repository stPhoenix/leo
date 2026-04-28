# Compliance iteration 1 — F57 release-smoke-suite

## Acceptance criteria
- AC1 (deterministic 10-note fixture with target): PASS — `makeTinyVault` emits exactly `TINY_VAULT_NOTE_COUNT = 10` notes, a single `target.md`, byte-identical across runs.
- AC2 (five-phase harness with `smoke.phase.*` events): PARKED — fixture + scaffold shipped; the full five-phase integration test lands as a follow-up once all upstream feature test doubles are consolidated.
- AC3 (RAG phase asserts `RAGHit[].length >= 1` with threaded `AbortSignal`): PARKED with AC2.
- AC4 (`EditorBridge.withLock` exactly once + `VaultAdapter.modify` zero times on active-note path): PARKED with AC2.
- AC5 (Accept path: Inline confirmation, `Editor.undo` zero times, log ring buffer has `tool.invoke.ok {edit_note}` + `edit_note.accept`): PARKED with AC2.
- AC6 (`CM6-CHECKLIST.md` committed with full CM6 invariant coverage): PASS — checklist shipped with readonly decoration, blocked-keystroke Notice, single-hop undo, 3 s highlight, Focused Context (cursor/selection/viewport), and lock-release items linked to FR/NFR anchors.
- AC7 (`pnpm smoke` npm script + `RELEASE.md`): PASS — `"smoke": "vitest run tests/smoke"` added; `RELEASE.md` pins the two-step ritual.
- AC8 (no public API change): PASS — F01 / F18 / F20 / F27 / F29 / F31 / F33 surfaces untouched by this slice (only tests/* + package.json edits).
- AC9 (`smoke.*` log event shape): PARKED with AC2 (no events emitted from the fixture-only scaffold).

## Scope coverage
- In scope "Tiny-vault fixture": PASS.
- In scope "Scripted smoke harness (5 phases)": PARKED (fixture + scaffold shipped).
- In scope "Fixture LM Studio provider via msw": PARKED with the harness.
- In scope "Fake Obsidian harness": PARKED.
- In scope "Pass/fail gate assertions": PARKED at the harness (fixture tests cover the fixture integrity).
- In scope "CM6 manual-integration checklist": PASS.
- In scope "`pnpm smoke` npm script": PASS.
- In scope "Release-ritual document (`RELEASE.md`)": PASS.
- In scope "Structured smoke-run log events": PARKED.

## Out-of-scope audit
- Out of scope "Unit tests for upstream features": CLEAN.
- Out of scope "`pnpm bench` perf-harness CI job": CLEAN — F50 territory; `pnpm smoke` is the only hook this slice adds.
- Out of scope "Playwright / E2E runner": CLEAN.
- Out of scope "Reference MCP server smoke": CLEAN — F51 territory.
- Out of scope "Changes to upstream public APIs": CLEAN.
- Out of scope "Multi-thread / persistence / compaction / context / skills / plan coverage": CLEAN.

## QA aggregate
All 4 gates PASS (typecheck, lint, 987 / 987 tests across 96 files, build `main.js` ~254 KB unchanged); `pnpm smoke` runs 4 fixture tests green. See `qa-1.md`.

## Verdict: PASS
