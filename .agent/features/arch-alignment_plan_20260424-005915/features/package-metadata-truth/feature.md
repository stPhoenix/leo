# F08 — package.json dependency truth

## Purpose

Bring `package.json` dependency declarations in line with the runtime after F01/F04 ship — see [context.md § Metadata truth / FR-10](../../context.md#metadata-truth) — and confirm the `keywords: ["langgraph"]` entry now reflects reality.

## Scope

In scope:
- Add `@langchain/langgraph`, `zod`, `zod-to-json-schema` to `dependencies` with pinned versions.
- Verify bundle-size delta and document in PR description.
- Keep the existing `keywords` array; entry `"langgraph"` is now accurate.
- Update lockfile (`package-lock.json` or equivalent) in the same commit.

Out of scope:
- Changing Node engine range.
- Adding dev-dependencies (`@types/*` come bundled).
- Re-enumerating existing deps.

## Acceptance criteria

1. `dependencies` contains `@langchain/langgraph`, `zod`, `zod-to-json-schema`. (FR-10)
2. `npm ci` (or project-standard equivalent) installs cleanly on a fresh checkout. (NFR-01)
3. Full Vitest suite + build (`esbuild`) green with new deps installed. (NFR-01)
4. Bundle-size delta documented (bytes before / after). (NFR-01)

## Dependencies

- [F04 — langgraph-stategraph](../langgraph-stategraph/feature.md) — the only consumer that justifies the langgraph dep.
- [../../context.md § Metadata truth](../../context.md#metadata-truth)
- [../../features-index.md](../../features-index.md) row F08

## Implementation notes

- Constraints — [architecture.md § 6 Constraints](../../../../architecture/architecture.md#6-constraints).
- Dependency policy — [tech-stack.md](../../../../standards/tech-stack.md).
- Release hygiene — [best-practices.md](../../../../standards/best-practices.md).

## Open questions

1. Version pinning style — exact vs caret? Default: caret for runtime libs, exact for tooling; confirm against [tech-stack.md](../../../../standards/tech-stack.md).
2. If `@langchain/langgraph` pulls a heavy transitive graph, should we vendor a minimal subset instead? Default: ship the full dep; revisit only if bundle size breaks a plugin-store limit.
