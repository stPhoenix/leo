# Remediation — iteration 1

Single failed check from [`verification-1.md`](verification-1.md) — Check 7 (60-word paragraph guard in Implementation notes).

## Actions

| Gap | Action | Files changed |
|---|---|---|
| 1 (F03 over-budget bullet) | Replaced 102-word "One-in-flight rule preservation" bullet with a one-sentence link annotation. Moved the full reasoning into [`features-index.md`](features-index.md) §"Architecture compliance summary" → "One in-flight rule (FR-AGENT-07)" subsection. | `features/subgraph-state-machine/feature.md`, `features-index.md` |
| 2 (F04 over-budget bullet) | Replaced 102-word "AgentRunner relationship" bullet with a one-sentence link annotation. Reasoning consolidated into the same compliance-summary subsection (the AgentRunner reasoning naturally lives alongside the per-thread-slot reasoning). | `features/refine-sub-agent/feature.md`, `features-index.md` |

## Side effects

- [`features-index.md`](features-index.md) §"Architecture compliance summary" expanded: each rule now has its own H3 subsection with the substantive cross-feature reasoning, instead of one-line bullets. The "One in-flight rule (FR-AGENT-07)" subsection now carries the full reasoning that was duplicated across F03 and F04.
- The Layering subsection also absorbs the F02 "role vs file location" clarification (was 58 words in F02 — kept in F02 too since it's just under threshold and locally useful, but the cross-feature framing now lives in features-index.md).
- No feature.md sections changed shape (still six required sections each).
- No state.md row regression (existing `detail:` rows remain `done`; no re-running needed since the changes are pure tightening of one bullet per file).

## Re-check expectation

Iteration 2 verification should:
- pass Check 7 (the two over-budget bullets are gone — replaced with ≤ 25-word link bullets);
- pass all other checks (no other modifications touched coverage, deps, sections, or links).
