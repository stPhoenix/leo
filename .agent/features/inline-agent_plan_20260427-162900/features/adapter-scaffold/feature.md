# F01 — Adapter scaffold + DI registration

## Purpose

Stand up the `InlineAgentAdapter` class skeleton — exported from `src/agent/externalAgent/adapters/inlineAgent/index.ts`, extending `ExternalAgentAdapter`, and registered in `main.ts` with a `providerFactory` closure injected at the DI root. This feature delivers no runtime behaviour yet — it carves the import-isolation boundary, wires the constructor signature mandated by [context.md#fr-ia-05a](../../context.md#functional-requirements), and lands the ESLint `no-restricted-imports` rule extension that prevents the adapter subtree from importing main-agent / chat / UI / storage / editor / sibling-provider modules. Covers [context.md#fr-ia-01](../../context.md#functional-requirements) FR-IA-01, FR-IA-02, FR-IA-04, FR-IA-05a.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/index.ts` — class export, `id`, `label`, `defaultTimeoutMs`, `capabilities`, constructor accepting `{ providerFactory, logger }`, placeholder `start()` returning a synchronous-rejecting iterable until F16 lands.
- Registration in `main.ts` after `AdapterRegistry` construction; `providerFactory` closure built over `providers/registry.ts`.
- Extend `.eslintrc.cjs` `no-restricted-imports` adapter-isolation rule to the `inlineAgent/**` subtree (paths `src/agent/(?!externalAgent)`, `src/chat/**`, `src/ui/**`, `src/storage/**` except `safeStorage.ts`, `src/editor/**`, `src/providers/**` except via DI).
- Smoke test that the adapter class instantiates, registers, surfaces correct id/label/defaults, and the ESLint rule fails on a forbidden import fixture.

Out of scope:
- Config schema (F02), system prompt (F02), sandbox creation (F03), tool wiring (F06–F10), graph (F16). `start()` is a stub.
- Any `ExternalEvent` emission logic — owned by F05.

## Acceptance criteria

1. `InlineAgentAdapter` instance exposes `id === 'inline-agent'`, `label === 'Inline Agent'`, `defaultTimeoutMs === 300_000`, `capabilities === { files: true, stream: true }` ([context.md#fr-ia-02](../../context.md#functional-requirements)).
2. The adapter class file imports nothing from `src/agent/` (other than its own folder + `adapters/base.ts`), `src/chat/`, `src/ui/`, `src/storage/` (other than `safeStorage.ts` once F07 lands), `src/editor/`, or `src/providers/registry.ts`. Verified by ESLint rule + a CI grep ([context.md#fr-ia-04](../../context.md#functional-requirements)).
3. Constructor accepts and stores `{ providerFactory, logger }`; `providerFactory(providerId, model, opts) → ChatModel` closure constructed in `main.ts` and passed in. The adapter holds no module-level reference to `providers/registry.ts` ([context.md#fr-ia-05a](../../context.md#functional-requirements)).
4. `main.ts` calls `adapterRegistry.register(new InlineAgentAdapter({ providerFactory, logger }))` after `AdapterRegistry` is built and before `freeze()` ([context.md#fr-ia-01](../../context.md#functional-requirements)).
5. Stub `start()` returns an `AsyncIterable<ExternalEvent>` that immediately yields `{ type: 'error', error: { code: 'not_implemented', message: 'F16 pending' } }` followed by termination — adapter never throws synchronously out of `start()` ([context.md#fr-ia-48](../../context.md#functional-requirements) preview).
6. Unit tests: instantiation snapshot, ESLint rule fails on a fixture importing `src/chat/messageStore.ts`, ESLint rule fails on a fixture importing `src/providers/registry.ts` directly, registration smoke test against a fake registry.

## Dependencies

- [`src/agent/externalAgent/adapters/base.ts`](../../../../src/agent/externalAgent/adapters/base.ts) — defines `ExternalAgentAdapter` abstract class, `AdapterCapabilities`, `ExternalEvent`.
- [`src/agent/externalAgent/adapterRegistry.ts`](../../../../src/agent/externalAgent/adapterRegistry.ts) — `register/freeze/list` API.
- [`src/main.ts`](../../../../src/main.ts) — DI root; new `providerFactory` closure constructed here.
- [`.eslintrc.cjs`](../../../../.eslintrc.cjs) — `no-restricted-imports` rule extension.
- [context.md#fr-ia-01](../../context.md#functional-requirements), [context.md#fr-ia-02](../../context.md#functional-requirements), [context.md#fr-ia-04](../../context.md#functional-requirements), [context.md#fr-ia-05a](../../context.md#functional-requirements).

## Implementation notes

- Adapter contract + isolation guidance: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) — strict TypeScript, named exports, `import type`, no default exports.
- Layer rule (UI → Agent → Domain/Adapters → Platform; no back-edges): [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Imports & Module Boundaries".
- DI root pattern (LeoContext): see [`.agent/standards/tech-stack.md`](../../../../.agent/standards/tech-stack.md) "Agent / Tool / Skill / MCP Wiring" + the existing `AdapterRegistry` wiring referenced in [context.md#scope](../../context.md#scope).
- Existing `ExternalAgentAdapter` shape: [`src/agent/externalAgent/adapters/base.ts`](../../../../src/agent/externalAgent/adapters/base.ts).
- Best-practices: fail-fast DI validation per [`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md).

## Open questions

- Should the ESLint `no-restricted-imports` rule live as a fresh `overrides` block targeting `src/agent/externalAgent/adapters/inlineAgent/**`, or extend the existing adapter-only rule that already applies to `adapters/base.ts`? Confirm by reading current `.eslintrc.cjs` adapter-isolation block before patching.
- `providerFactory` signature — does it need to expose token-usage hooks for FR-IA-43 (cumulative token counting) or can F04 layer that on top? Decide alongside F04 design review.
