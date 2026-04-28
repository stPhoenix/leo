# Leo release gate

Two-step release gate. Both must pass before publishing a build.

## Step 1 — `pnpm smoke` (automated, NFR-TEST-04)

Run from the repo root:

```bash
pnpm smoke
```

The smoke harness asserts the canonical `load → index tiny vault → RAG question → agent edit → accept` ladder against a committed 10-note fixture under `tests/smoke/fixtures/tinyVault.ts`. A single assertion breach fails the run.

## Step 2 — CM6 manual integration (manual, NFR-TEST-03)

Open `tests/smoke/CM6-CHECKLIST.md`, tick every box against a freshly-built plugin loaded into a dev Obsidian vault. A `git commit -s` that includes the ticked checklist is the human sign-off.

## Release ritual

1. `pnpm smoke` — green.
2. Manually run through `CM6-CHECKLIST.md` — every box ticked.
3. `git commit -s -m "release: <version>"` with the ticked checklist.
4. Tag + publish.
