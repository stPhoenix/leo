# F01 — OpenFang config schema + types

## Purpose

Define the Zod-validated configuration object for the openfang adapter. This is the single source of truth for: (a) what the user can configure in the settings UI (the existing F11 of the prior slice auto-renders it), (b) what the HTTP client receives, and (c) what the secret-storage indirection looks like for `apiKey`.

Implements [`context.md`](../../context.md) FR-OF-23, FR-OF-24, NFR-OF-10.

## Scope

**In scope**

- New file `src/agent/externalAgent/adapters/openfang/configSchema.ts`:
  - `openfangConfigSchema = z.object({...}).strict()` with these fields and constraints (matching FR-OF-23 verbatim):
    - `baseUrl: z.string().url().describe('Base URL of the OpenFang daemon, e.g. https://openfang.example.com:4200')`
    - `apiKey: z.string().min(1).describe('secret\nAPI key shared by the daemon operator. Sent as Authorization: Bearer.')` — first line `secret` is the F11 marker keyword (the existing settings UI splits on `\n` and uses the first line as the metadata tag, second line as the human description).
    - `sessionId: z.string().optional().describe('Optional A2A sessionId — pass to correlate multiple tasks in one logical conversation.')`
    - `pollTimeoutMs: z.number().int().min(60_000).default(1_800_000).describe('Hard ceiling on polling duration. Default 30 min.')`
    - `pollInitialIntervalMs: z.number().int().min(2_000).default(2_000).describe('First poll interval. Daemon caches faster requests; minimum 2000.')` (Constraint **C-OF-04** enforced here.)
    - `pollMaxIntervalMs: z.number().int().min(2_000).max(60_000).default(15_000).describe('Maximum back-off interval between polls.')`
    - `httpTimeoutMs: z.number().int().min(1_000).default(30_000).describe('Per-request HTTP timeout. Applied to every authenticated call.')`
    - `allowInsecureHttp: z.boolean().default(false).describe('Permit http:// base URLs. Off by default — TLS is strongly recommended.')`
  - Cross-field refinement: `pollMaxIntervalMs >= pollInitialIntervalMs` (Zod `.refine`).
- TS type export: `export type OpenfangConfig = z.infer<typeof openfangConfigSchema>`.
- Unit tests at `tests/unit/externalAgent/adapters/openfang/configSchema.test.ts`:
  - parses minimal valid config (only `baseUrl` + `apiKey`) and applies defaults
  - rejects missing `apiKey`
  - rejects `baseUrl` not a URL
  - rejects `pollInitialIntervalMs < 2000`
  - rejects `pollMaxIntervalMs < pollInitialIntervalMs`
  - accepts `allowInsecureHttp: true` + `baseUrl: 'http://localhost:4200'` (parser-level pass; runtime guard lives in F05 per FR-OF-29)
  - confirms `.describe('secret')` marker is present on `apiKey` (string-match on schema definition source — guards against accidental removal)

**Out of scope**

- Runtime enforcement of the insecure-HTTP rule (F05 owns the start-time check per FR-OF-29).
- The settings UI rendering itself (F11 of the prior slice already auto-generates the form; F07 of this slice adds Storybook fixtures).
- `SafeStorage` indirection mechanics (F11 of the prior slice owns `safeStorage:` indirection; this schema only marks fields with `.describe('secret')`).

## Acceptance criteria

1. `openfangConfigSchema` parses `{ baseUrl: 'https://x', apiKey: 'k' }` to a fully-defaulted object matching the FR-OF-23 spec exactly. (FR-OF-23.)
2. Schema rejects every invalid case in §Scope — Vitest table-test enumerates each rejection with the expected Zod error path. (FR-OF-23, NFR-OF-03 prerequisite.)
3. `apiKey` field's description starts with the literal token `secret` followed by a newline, so the existing F11 form generator routes it to a password input + SafeStorage. (FR-OF-24.)
4. `OpenfangConfig` type is exported and is the inferred type of the schema (no dual TS/Zod declaration). Honors [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Zod & Tool Schemas".
5. No top-level dependency added to `package.json` — the schema uses only `zod` (already a project dep). (NFR-OF-10.)
6. The `.strict()` modifier is applied — unknown keys in user config are rejected, surfacing operator typos rather than silently ignoring fields.
7. Cross-field refinement `pollMaxIntervalMs >= pollInitialIntervalMs` is asserted by a dedicated test row.

## Dependencies

- None (foundation feature).
- Cross-doc:
  - [`context.md#functional-requirements`](../../context.md#functional-requirements) FR-OF-23, FR-OF-24
  - [`context.md#constraints`](../../context.md#constraints) **C-OF-04**, **C-OF-07**
  - [`../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md`](../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md) (`configSchema` discipline)
  - [`../../../external-agent_slice_20260427-022536/features/settings-ui/feature.md`](../../../external-agent_slice_20260427-022536/features/settings-ui/feature.md) (consumer of `.describe('secret')`)

## Implementation notes

- Zod conventions — see [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Zod & Tool Schemas".
- TypeScript strictness, no default exports — see [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §TypeScript.
- File naming and path alias — see [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md).
- Existing precedent for an adapter `configSchema.ts` — see `src/agent/externalAgent/adapters/inlineAgent/configSchema.ts`.
- The first-line `secret` marker convention is consumed by [`../../../external-agent_slice_20260427-022536/features/settings-ui/ui.md`](../../../external-agent_slice_20260427-022536/features/settings-ui/ui.md) §"Component mapping".
- Vitest happy-dom config — see `vitest.config.ts`.

## Open questions

- **OQ-01-F01** Should `baseUrl` strip a trailing `/` before storage so downstream code does not have to defensive-strip? **Proposed**: yes — add a Zod `.transform(s => s.replace(/\/$/, ''))` after `.url()`.
- **OQ-02-F01** Should `allowInsecureHttp` carry a UI warning string, or is the field description enough? **Proposed**: description-only for v1; the F07 Storybook story can show what it looks like with a warning hint added later.
