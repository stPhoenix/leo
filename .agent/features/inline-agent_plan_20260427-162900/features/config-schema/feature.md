# F02 — Config schema + system prompt + sandbox caveat

## Purpose

Land the full Zod `configSchema` covering provider/model selection, prompt override, budgets, sandbox quota, and per-tool config (`fetchUrl`, `searchWeb`, `fileOps`); ship the built-in inline-agent system prompt module; and surface the NFR-IA-01 logical-sandbox caveat as the top-level schema description so the existing `ExternalAgentsSection.tsx` auto-renders it without bespoke React. Covers [context.md#fr-ia-03](../../context.md#functional-requirements) FR-IA-03, FR-IA-05, FR-IA-06, FR-IA-07, FR-IA-08, NFR-IA-01.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/configSchema.ts` — Zod schema mirroring the §6 `data.json` shape: `providerId`, `model`, `temperature`, `systemPromptOverride`, `routing.mode`, `planner.planMaxSteps`, `budgets.{maxIterationsSimple, maxIterationsMultistep, maxTokens, wallClockMs}`, `sandbox.{quotaBytes, maxArtifacts}`, `tools.{fetchUrl, searchWeb, fileOps}`.
- Each field `.describe()`d for the LLM and for `ExternalAgentsSection.tsx` rendering. `searchWeb.apiKeyRef` flagged `.describe('secret')` so SafeStorage indirection is rendered as a `SecretField`.
- Defaults exactly per [context.md#fr-ia-03](../../context.md#functional-requirements) data.json excerpt.
- Top-level schema description carries the NFR-IA-01 caveat: "Sandbox is logical (path-prefix only). It does not protect against bugs or against the configured LLM exfiltrating data via tool args."
- `src/agent/externalAgent/adapters/inlineAgent/systemPrompt.ts` — pure function returning the base system prompt (tool list summary, sandbox rules, artifact-publication contract, termination instructions). Composition order: prepend `ExternalAgentInput.systemPrompt` (core) ahead of inline prompt.
- Adapter `start()` lazily resolves `providerFactory(providerId, model, opts)` and surfaces invalid-pair as `error.code='invalid_provider'`.
- Settings smoke: `data.json` round-trip + describeConfigSchema introspection emits expected sections.

Out of scope:
- New React form (auto-render is sufficient — see [context.md#out-of-scope](../../context.md#out-of-scope)).
- Provider validation deeper than "registry has providerId" — model validity is provider-specific and surfaces lazily on first call (FR-IA-09 / F03 + F11 territory).
- Bundle-budget — F17.

## Acceptance criteria

1. `configSchema.parse(data.externalAgents['inline-agent'].config)` succeeds for the defaults in [context.md#fr-ia-03](../../context.md#functional-requirements).
2. Invalid `providerId` (not in `providers/registry.ts`) → adapter `start()` yields `{ type: 'error', error: { code: 'invalid_provider', message } }` and terminates ([context.md#fr-ia-05](../../context.md#functional-requirements)).
3. `temperature` outside `[0,2]` rejected at parse boundary ([context.md#fr-ia-07](../../context.md#functional-requirements)).
4. `systemPromptOverride === null` → adapter uses `getInlineAgentSystemPrompt()` from `systemPrompt.ts`; non-null string overrides it. Adapter prepends `ExternalAgentInput.systemPrompt` ahead of either ([context.md#fr-ia-08](../../context.md#functional-requirements)).
5. Adapter never reads thread provider — only the configured `providerId/model` is used ([context.md#fr-ia-06](../../context.md#functional-requirements)).
6. `ExternalAgentsSection.tsx` (unchanged) auto-renders the schema with the NFR-IA-01 caveat visible at the top of the inline-agent block — verified by snapshot test against `describeConfigSchema(configSchema)` output.
7. `searchWeb.apiKeyRef` introspects as a secret field; on save, value is stored via SafeStorage indirection per existing `externalAgentResolver.ts` walking rule.

## Dependencies

- [F01 — adapter scaffold](../adapter-scaffold/feature.md) (constructor + class).
- [`src/settings/externalAgentResolver.ts`](../../../../src/settings/externalAgentResolver.ts) — `describeConfigSchema` introspection (no API change needed).
- [`src/settings/ExternalAgentsSection.tsx`](../../../../src/settings/ExternalAgentsSection.tsx) — auto-renders config schema (no change needed).
- [`src/storage/safeStorage.ts`](../../../../src/storage/safeStorage.ts) — secret indirection for `apiKeyRef`.
- [`src/providers/registry.ts`](../../../../src/providers/registry.ts) — read-only consumption via `providerFactory`.
- [context.md#fr-ia-03](../../context.md#functional-requirements), [context.md#fr-ia-05](../../context.md#functional-requirements)..FR-IA-08, [context.md#nfr-ia-01](../../context.md#non-functional-requirements).

## Implementation notes

- Zod patterns + `.describe()` for tool schemas: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Zod & Tool Schemas".
- Tech stack note on Zod-first config: [`.agent/standards/tech-stack.md`](../../../../.agent/standards/tech-stack.md) "Tool schemas" row.
- Existing introspection contract (string/secret/number/boolean/array/object) lives in [`src/settings/externalAgentResolver.ts`](../../../../src/settings/externalAgentResolver.ts) — schema must avoid Zod features the introspector cannot handle (no `z.lazy`, no `z.discriminatedUnion` at top level).
- KISS: do not introduce a separate prompts package — keep `systemPrompt.ts` a single pure function ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Core Principles").

## Open questions

- Should `providerId` be a `z.enum([...registry ids])` or `z.string()` validated lazily? Enum gives static rejection but couples schema to registry imports — would violate FR-IA-04. Lean `z.string()` + lazy check in `start()`.
- Should `routing.mode === 'deep'` warn the user via schema description that it disables the classifier and forces planner work? Probably yes — append to mode `.describe()`.
