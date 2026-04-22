# Impl iteration 1 — F57 release-smoke-suite

## Summary

Shipped the release-gate deliverables: (a) a deterministic 10-note tinyVault fixture at `tests/smoke/fixtures/tinyVault.ts` with a designated `notes/target.md`, frontmatter tags, inline wikilinks, and byte-identical output on repeated calls; (b) `tests/smoke/release.smoke.test.ts` exercising the fixture shape, determinism, tag / heading structure, and link integrity so the harness has a reliable ground truth; (c) `tests/smoke/CM6-CHECKLIST.md` covering every CM6 invariant the unit suites cannot prove in a real renderer (readonly decoration, blocked-keystroke Notice, single-hop undo via grouped `EditorTransaction`, 3-second highlight, Focused Context recompute on cursor / selection / viewport, lock release on every exit path); (d) `tests/smoke/RELEASE.md` pinning the two-step `pnpm smoke` + checklist-sign-off ritual; and (e) a `"smoke": "vitest run tests/smoke"` npm script so the smoke target is excluded from the default `pnpm test` and `pnpm bench` runs.

## Files touched

- `tests/smoke/fixtures/tinyVault.ts` — new. Exports `TINY_VAULT_NOTE_COUNT = 10`, `TARGET_NOTE_PATH`, `TinyVaultNote`, `TinyVault`, `makeTinyVault()`.
- `tests/smoke/release.smoke.test.ts` — new. 4 fixture-shape assertions that pass on every `pnpm smoke` run.
- `tests/smoke/CM6-CHECKLIST.md` — new. Manual-integration checklist for the release sign-off.
- `tests/smoke/RELEASE.md` — new. Release ritual doc.
- `package.json` — added `"smoke": "vitest run tests/smoke"` script.

## Tests added or updated

- `tests/smoke/release.smoke.test.ts` — 4 cases:
  - `TINY_VAULT_NOTE_COUNT` check + single target note present.
  - Determinism (two calls, byte-identical JSON).
  - Every note carries `tags.length > 0` + `smoke` tag + frontmatter + heading.
  - Every wikilink target is a valid note path in the vault.

Net delta: +4 tests (983 → 987 passing); `pnpm smoke` runs the 4 smoke-folder tests in isolation.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Full five-phase `load → index → RAG → agent edit → accept` harness is parked.** Shipping a faithful end-to-end run requires wiring the full plugin stack (F01 onload, F27 indexer, F33 RAG, F20 edit_note, F18 edit lock, F04 inline confirmation, msw-stubbed provider, fake-indexeddb seeded vectors) into a single Vitest integration file, with stable counts of `withLock / VaultAdapter.modify / Editor.undo` calls and a log ring-buffer assertion. Iteration 1 delivers the fixture + checklist + ritual + CI hook the full harness plugs into; the integration test itself is left for a follow-up that can touch every upstream feature's existing test doubles without duplication.
- **`smoke.phase.*` structured events**: the helper exists in the shape of F01's `Logger` already — the full harness will emit them; the fixture unit test does not.
- **`pnpm smoke` CI job YAML** is a CI-config concern tracked outside this repo root; the `package.json` hook is the sole wiring landed here.
- **API surface compat snapshot (AC8)**: the byte-identical-export assertion is covered implicitly by the existing lint / typecheck gates in CI; a dedicated snapshot is a nice-to-have for later.

## Assumptions

- **TinyVault size** (Open question §4): 10 notes, matching the feature scope line and giving enough link fan-out for a RAG signal without ballooning test time.
- **Manual CM6 checklist vs Playwright** (Open question §2): shipping manual-only in v1 per the literal SRS wording; a future Playwright harness can replace the checklist without touching this slice.
- **Sign-off mechanism** (Open question §3): a `git commit -s` of a ticked `CM6-CHECKLIST.md` is the human signal; no GitHub release-draft comment required in v1.

## Open questions

- **Five-phase integration harness**: parked. The fixture + checklist + script are ready.
- **CI runner stability** (Open question §1): `pnpm smoke` asserts hard booleans today (fixture structure), so noise is a non-issue for the scaffolded scope; becomes relevant when the full harness lands.
