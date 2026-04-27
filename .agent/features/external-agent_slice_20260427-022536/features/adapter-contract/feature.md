# F01 — Adapter contract & registry

## Purpose

Establish the foundation every other feature builds on: the abstract `ExternalAgentAdapter` class, its event/input types, and an `AdapterRegistry` mirroring the existing `ToolRegistry` pattern. Defines the vault-isolation invariant — adapters never receive a vault handle — and surfaces it as both a type signature and an enforced lint rule.

Implements [`context.md#functional-requirements`](../../context.md) FR-EXT-28, FR-EXT-29, FR-EXT-31 and [`context.md#non-functional-requirements`](../../context.md) NFR-EXT-02.

## Scope

**In scope**
- `src/agent/externalAgent/adapters/base.ts`: abstract class + types (`ExternalEvent` discriminated union, `ExternalAgentInput`).
- `src/agent/externalAgent/adapterRegistry.ts`: `register / list / get / defaultId` with `defaultId` derived from settings (read-only at this layer; settings owns the value).
- ESLint `no-restricted-imports` config addition for `src/agent/externalAgent/adapters/**` (allows `zod`, `node:child_process`, `node:fs/promises`, adapter-local helpers; denies `src/agent/`, `src/chat/`, `src/ui/`, `src/storage/`, `src/editor/`).
- Unit tests for registry: register two stubs, lookup, default-fallback semantics (when settings default missing).

**Out of scope**
- Any concrete adapter implementation (deferred to F09, F10).
- Settings UI for default selection (F11).
- Subgraph integration (F03, F05).

## Acceptance criteria

1. `ExternalAgentAdapter` is `abstract`, declares `id`, `label`, `defaultTimeoutMs`, `capabilities: { files, stream }`, `configSchema: z.ZodType`, and abstract `start(input: ExternalAgentInput): AsyncIterable<ExternalEvent>` — matching FR-EXT-28 and the contract in [`.agent/srs/external-agent.md`](../../../../srs/external-agent.md) §7.
2. `ExternalAgentInput` exposes only `refinedAsk`, `systemPrompt`, `signal`, `timeoutMs`, `config` — no vault, editor, logger, or other plugin handles. Verifies FR-EXT-31 / NFR-EXT-02.
3. `ExternalEvent` is a discriminated union with `type` ∈ `{log, text, file, done, error}` and the field shapes specified in [`.agent/srs/external-agent.md`](../../../../srs/external-agent.md) §7.
4. `AdapterRegistry.register(adapter)` rejects duplicate ids and freezes the adapter list once registered (no runtime mutation expected after plugin load).
5. `AdapterRegistry.defaultId()` returns the configured default if registered + enabled, else the alphabetically-first enabled adapter id, else `null`. Honors FR-EXT-29 + FR-EXT-34.
6. ESLint config rejects an adapter file importing from any forbidden path; CI fails on violation. Honors NFR-EXT-02 + Constraint **C-05**.
7. Vitest unit suite under `tests/unit/externalAgent/adapterRegistry.test.ts` covers register, duplicate rejection, default fallback ordering, disabled-default fallback.

## Dependencies

- None on prior features.
- Cross-doc:
  - [`context.md#scope`](../../context.md#scope)
  - [`context.md#fr-ext-28`](../../context.md#functional-requirements) (anchor in FR list)

## Implementation notes

- Layering — adapters sit at the Adapter layer in [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §2; no upward imports.
- Tool registry shape to mirror — see existing `ToolRegistry` in [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3.2 / §4 (`ToolSpec` interface) and the file `src/tools/toolRegistry.ts`.
- Zod schemas: one schema per config; describe fields per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Zod & Tool Schemas".
- TypeScript: no `any`, no default exports, `readonly` on public fields per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §TypeScript.
- Imports & module boundaries lint rule pattern — see existing usage referenced in [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Imports & Module Boundaries".
- Bundle discipline — adapter base/types add ≤ 5 KB minified per [`.agent/standards/tech-stack.md`](../../../../standards/tech-stack.md) §"Bundle Budget" and NFR-EXT-06.

## Open questions

- **OQ-01-F01** Should `configSchema` carry secret-field metadata via Zod `.describe('secret')` or via a sibling `secretFields: string[]` declaration on the adapter? Affects how F11 renders password inputs. **Proposed**: Zod `.describe('secret')` — single source of truth.
- **OQ-02-F01** Should `AdapterRegistry` accept a `LoggerNamespace` at construction so adapters can request a scoped logger without importing `Logger`? Tension with NFR-EXT-02. **Proposed**: no — adapters emit `log` events; `widgetController` is the sole sink.
