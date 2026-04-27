# Compliance iteration 1 — F02 config-schema

## Acceptance criteria
- AC1 (defaults parse): PASS — `tests/unit/externalAgent/adapters/inlineAgent/configSchema.test.ts:11-50` parses the SRS §6 default fixture and asserts every field round-trips.
- AC2 (invalid providerId): PASS — `tests/.../startConfigGate.test.ts:39-50` asserts `providerId='frobnicator'` yields `error.code='invalid_provider'` and the iterable terminates.
- AC3 (temperature outside [0,2]): PASS — `configSchema.test.ts:80-83` rejects -0.1 and 2.1; `startConfigGate.test.ts:53-65` confirms the adapter surfaces the rejection as `error.code='invalid_config'`.
- AC4 (system prompt): PASS — `systemPrompt.test.ts:31-44` exercises both branches: null override → built-in prompt; non-null override → custom string. Both prepend host prompt verbatim with `\n\n` separator.
- AC5 (no thread-provider inheritance): PASS — `startConfigGate.test.ts:74-83` injects a `knownProviderIds` whitelist of `['custom']`, verifies `providerId='openai'` is rejected — proving the adapter only consults the configured value.
- AC6 (auto-render with caveat): PASS — `configSchema.test.ts:108-111` asserts the top-level Zod description matches `/sandbox is logical/i`. `tests/dom/externalAgentsSection.test.tsx` (6 tests) continues to pass against the unchanged `ExternalAgentsSection.tsx`. The pre-existing snapshot test asserts `describeConfigSchema` introspection matches expectation.
- AC7 (`apiKeyRef` secret): PASS — `configSchema.test.ts:113-122` confirms `tools.searchWeb.apiKeyRef` introspects with `kind: 'secret'` so the existing `SecretField` renderer in `ExternalAgentsSection.tsx` writes through SafeStorage.

## Scope coverage
- In scope "configSchema.ts mirroring §6 data.json shape": PASS — `src/agent/externalAgent/adapters/inlineAgent/configSchema.ts:106-179`.
- In scope "Each field `.describe()`d ... apiKeyRef secret": PASS — every leaf field has `.describe()`; `apiKeyRef` has `.describe('secret')`.
- In scope "Defaults exactly per data.json excerpt": PASS — verified by AC1 fixture.
- In scope "Top-level schema description carries NFR-IA-01 caveat": PASS — `configSchema.ts:174`.
- In scope "systemPrompt.ts pure function ... composition order": PASS — `getInlineAgentSystemPrompt`, `resolveSystemPrompt` in `systemPrompt.ts` + `index.ts`.
- In scope "Adapter start() lazily resolves providerFactory ... invalid pair → invalid_provider": PASS — implemented in `index.ts:84-98`. Lazy `providerFactory` resolution proper (the registry whitelist check happens before any call to the factory; F16 will invoke the factory itself).
- In scope "Settings smoke: data.json round-trip + describeConfigSchema introspection": PASS — `configSchema.test.ts` round-trips defaults, asserts secret field detection, enum field surfacing.

## Out-of-scope audit
- Out of scope "New React form": CLEAN — `ExternalAgentsSection.tsx` untouched; auto-render remains the rendering path.
- Out of scope "Provider validation deeper than registry has providerId": CLEAN — adapter only checks the whitelist; model name is forwarded as-is.
- Out of scope "Bundle-budget — F17": CLEAN — no budget edit in this iteration.

## QA aggregate
`qa-1.md` verdict PASS — typecheck/lint/test/build all green; 1616/1616.

## Verdict: PASS
