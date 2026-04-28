# Verification — iteration 1

Eight checks per the `/plan-feature` skill spec.

## Check 1 — Coverage forward

Every `FR-EXT-*` and `NFR-EXT-*` in [`context.md`](context.md) appears in at least one feature's `covers` column in [`features-index.md`](features-index.md), with one explicitly-deferred exception.

Coverage table verified at [`features-index.md`](features-index.md) §"Coverage check (forward)". All 33 in-scope FRs (FR-EXT-01..31, FR-EXT-33, FR-EXT-34) and all 8 NFRs are covered. **FR-EXT-32** is documented as `DEFERRED` in both [`context.md`](context.md) (Out of scope + FR-EXT-32 row) and [`features-index.md`](features-index.md) (scope note + DEFERRED row in coverage table) per the user's mid-planning instruction to remove F09 + F10.

**Verdict: PASS** (FR-EXT-32 deferral is intentional documented out-of-scope, not a coverage gap).

## Check 2 — Coverage backward

Every feature row in [`features-index.md`](features-index.md) has at least one entry in `covers`:

| Feature | covers |
|---|---|
| F01 | FR-EXT-28, FR-EXT-29, FR-EXT-31, NFR-EXT-02 |
| F02 | FR-EXT-19, FR-EXT-20, FR-EXT-21, NFR-EXT-03 |
| F03 | FR-EXT-05, FR-EXT-06, NFR-EXT-08 |
| F04 | FR-EXT-07, FR-EXT-08, FR-EXT-09, FR-EXT-10 |
| F05 | FR-EXT-15..18, FR-EXT-22..24, NFR-EXT-01, NFR-EXT-07 |
| F06 | FR-EXT-01..04, FR-EXT-06 |
| F07 | NFR-EXT-04 |
| F08 | FR-EXT-11..14, FR-EXT-25..27 |
| F11 | FR-EXT-30, FR-EXT-33, FR-EXT-34 |
| F12 | FR-EXT-26 (persistence) |
| F13 | NFR-EXT-05, NFR-EXT-06 |

No orphan features. **Verdict: PASS**.

## Check 3 — Dependency graph

Edges (from [`features-index.md`](features-index.md) deps column):

```
F01 → ∅
F02 → F01
F03 → F01
F04 → F03
F05 → F02, F03
F06 → F03
F07 → F03, F04, F05
F08 → F07
F11 → F01
F12 → F08
F13 → F01, F08, F11
```

DAG check — topological linearization F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08 → F11 → F12 → F13 satisfies all edges. No cycles. All referenced IDs exist (F09, F10 not referenced in any deps post-revision).

**Verdict: PASS**.

## Check 4 — UI docs present

UI-needed features:
- **F08 (widget-ui)** — [`features/widget-ui/ui.md`](features/widget-ui/ui.md) — present, non-empty (Layout, State machine, Event flow, Component mapping incl. Storybook story matrix, Back-link).
- **F11 (settings-ui)** — [`features/settings-ui/ui.md`](features/settings-ui/ui.md) — present, non-empty (same sections, includes mandatory `NoAdaptersRegistered` Storybook fixture for v1 empty-registry state).

**Verdict: PASS**.

## Check 5 — Outline integrity

Every markdown link in [`outline.md`](outline.md) was mechanically resolved against the workspace filesystem (Bash check):

```
17 links — all OK
```

Includes the 11 feature.md files, 2 ui.md files, plus context.md and features-index.md. No broken links.

**Verdict: PASS**.

## Check 6 — Section completeness

Every `feature.md` has all six required sections filled with substantive content:

| Feature | Purpose | Scope | Acceptance criteria | Dependencies | Implementation notes | Open questions |
|---|---|---|---|---|---|---|
| F01 | ✓ | ✓ | ✓ (7 items) | ✓ | ✓ | ✓ (2) |
| F02 | ✓ | ✓ | ✓ (7) | ✓ | ✓ | ✓ (2) |
| F03 | ✓ | ✓ | ✓ (6) | ✓ | ✓ | ✓ (2) |
| F04 | ✓ | ✓ | ✓ (6) | ✓ | ✓ | ✓ (3) |
| F05 | ✓ | ✓ | ✓ (10) | ✓ | ✓ | ✓ (3) |
| F06 | ✓ | ✓ | ✓ (8) | ✓ | ✓ | ✓ (3) |
| F07 | ✓ | ✓ | ✓ (6) | ✓ | ✓ | ✓ (2) |
| F08 | ✓ | ✓ | ✓ (10) | ✓ | ✓ | ✓ (3) |
| F11 | ✓ | ✓ | ✓ (10) | ✓ | ✓ | ✓ (3) |
| F12 | ✓ | ✓ | ✓ (7) | ✓ | ✓ | ✓ (3) |
| F13 | ✓ | ✓ | ✓ (6) | ✓ | ✓ | ✓ (3) |

**Verdict: PASS**.

## Check 7 — No duplication / 60-word paragraph guard in Implementation notes

Mechanical scan of `## Implementation notes` bullets across all 11 `feature.md` files. Two bullets exceed the 60-word soft guard:

| File | Bullet (truncated) | Word count |
|---|---|---|
| `features/subgraph-state-machine/feature.md` | "**One-in-flight rule preservation** ([architecture.md](…))…" | 102 |
| `features/refine-sub-agent/feature.md` | "**AgentRunner relationship**: the refine sub-agent calls `ProviderManager` directly…" | 102 |

Both bullets carry architecture-compliance reasoning added in response to the user's explicit "make sure features specs comply with @architecture.md" instruction. The reasoning is non-trivial (explains why this feature does not violate the global one-in-flight rule despite having its own subgraph) and *needs to live in the planning workspace* — but the 60-word guard wants it out of the Implementation-notes section.

A separate borderline note in `features/result-writer/feature.md` ("Layer placement (role vs file location)") is 58 words, just under the threshold; it stays.

**Verdict: FAIL — relocate the two over-budget bullets out of Implementation notes; replace with one-sentence link annotations pointing to a richer "Architecture compliance summary" subsection in [`features-index.md`](features-index.md), where cross-feature compliance reasoning belongs.**

## Check 8 — External link resolution

Every link from any `Implementation notes` section to `.agent/architecture/`, `.agent/standards/`, or `.agent/srs/` was mechanically resolved (Bash check):

```
41 unique external links across 11 feature.md + 2 ui.md — all OK
```

No broken external links.

**Verdict: PASS**.

## Verdict: FAIL

Single check failed: Check 7 (paragraph length in Implementation notes). All other checks pass.

## Gaps

| # | Check | File / feature | Remediation |
|---|---|---|---|
| 1 | 7 | [`features/subgraph-state-machine/feature.md`](features/subgraph-state-machine/feature.md) | The 102-word "One-in-flight rule preservation" bullet under `## Implementation notes` exceeds the 60-word guard. Replace with a one-sentence annotation: "Per-thread slot is additive scope on top of the global one-in-flight rule per [architecture.md §1] (full reasoning in [`features-index.md`](features-index.md) §"Architecture compliance summary")." Move the existing reasoning into the compliance summary section of `features-index.md` (which already exists with a placeholder bullet for the one-in-flight rule). |
| 2 | 7 | [`features/refine-sub-agent/feature.md`](features/refine-sub-agent/feature.md) | The 102-word "AgentRunner relationship" bullet under `## Implementation notes` exceeds the 60-word guard. Replace with a one-sentence annotation: "Refine sub-agent calls `ProviderManager` directly during the suspended `delegate_external` tool, preserving FR-AGENT-07 by suspension semantics — see [`features-index.md`](features-index.md) §"Architecture compliance summary"." Move the existing reasoning into the compliance summary section of `features-index.md`. |
