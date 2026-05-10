# Features index

Concrete `OpenfangAdapter` against the contract shipped by the [prior external-agent slice](../external-agent_slice_20260427-022536/). `covers` references map back to [`context.md`](context.md) IDs.

| # | id | slug | name | purpose | deps | ui-needed | priority | covers |
|---|----|------|------|---------|------|-----------|----------|--------|
| 1 | F01 | openfang-config-schema | Config schema + types | Zod `openfangConfigSchema` (baseUrl URL, apiKey secret, sessionId, polling intervals, http timeout, allowInsecureHttp). Type-export `OpenfangConfig`. Invalid + insecure-http parser tests. | — | no | high | FR-OF-23, FR-OF-24, NFR-OF-10 |
| 2 | F02 | openfang-http-client | A2A HTTP transport | `submitTask`, `pollTask`, `cancelTask`, `downloadArtifact`. Bearer header injection, per-request `httpTimeoutMs` + abort plumbing, lenient JSON parse, sessionId pass-through, redact-key logger helper. msw fixtures per endpoint. | F01 | no | high | FR-OF-01, FR-OF-02, FR-OF-03, FR-OF-13 (cancel call), FR-OF-21, FR-OF-30, NFR-OF-04, NFR-OF-05, NFR-OF-08, NFR-OF-09, NFR-OF-10 |
| 3 | F03 | openfang-polling | Polling driver | `pollUntilTerminal(http, taskId, opts)` — exponential backoff (initial→max), terminal-state detection via lenient `status` parser, abort short-circuits within ≤ 2 s, `pollTimeoutMs` enforcement, `5xx` retry budget for transient poll failures. Pure timing module (clock-injected). | F02 | no | high | FR-OF-04, FR-OF-05, FR-OF-06, FR-OF-07, FR-OF-19 (poll-side), FR-OF-20, NFR-OF-01 (poll-loop side), NFR-OF-08 |
| 4 | F04 | openfang-artifacts | Artifact downloader | `downloadArtifacts(http, task, signal)` — enumerate `artifacts[].parts[type=fileRef]`, fetch sequentially, emit `ExternalEvent.file` per success, log+skip on `404`, dedupe colliding `relPath` values, drop unknown part types at debug. | F02 | no | high | FR-OF-09, FR-OF-10, FR-OF-11, FR-OF-12, FR-OF-27, FR-OF-28 |
| 5 | F05 | openfang-adapter | OpenfangAdapter shell + error mapping | `OpenfangAdapter extends ExternalAgentAdapter`. `start()` validates config, rejects insecure transport, submits, drives polling, decodes failure prefixes (`INFRA_ERROR` / `PARTIAL` / `CIRCUIT_BREAKER` / `Error:`), maps HTTP status codes to typed `error.code`, wires `AbortSignal` to local cancel, downloads artifacts via F04, emits `done`. Surfaces text reply (and any `data` part) before files. | F01, F02, F03, F04 | no | high | FR-OF-08, FR-OF-13 (signal wiring), FR-OF-14, FR-OF-15, FR-OF-16, FR-OF-17, FR-OF-18, FR-OF-19 (mapping side), FR-OF-22, FR-OF-27, FR-OF-29, FR-OF-30 (start-side redaction), NFR-OF-01 (overall), NFR-OF-02, NFR-OF-03, NFR-OF-05, NFR-OF-09 |
| 6 | F06 | openfang-registration | Plugin wiring + adapter registration | Construct `OpenfangAdapter` in `main.ts` adapter-wiring section, register with `AdapterRegistry` before `freeze()`. Validate it appears under `effectiveDefaultAdapterId()` when enabled. Bundle-size assertion via `pnpm check:bundle`. | F05 | no | high | FR-OF-25, FR-OF-26, NFR-OF-06 |
| 7 | F07 | openfang-settings-stories | Storybook fixtures for openfang config block | Add `OpenfangConfigured` and `OpenfangSecretRevealed` stories to existing `ExternalAgentsSection.stories.tsx`. Mount a registry containing only `OpenfangAdapter`; verify auto-generated form renders all schema fields, secret toggle works on `apiKey`. | F05 | yes | medium | FR-OF-23 (visual confirmation), FR-OF-24 (visual confirmation) |
| 8 | F08 | openfang-integration-test | End-to-end MSW lifecycle test | Full submit → poll → completed → artifact-download → done iterable; failed-with-`INFRA_ERROR` path; cancel mid-poll. Exercises the registered adapter through `AdapterRegistry.get('openfang').start(...)`. | F06 | no | high | NFR-OF-07 (integration scope) |

## Coverage check (forward)

Every requirement in [`context.md`](context.md) appears under at least one feature's `covers`.

| Requirement | Covered by |
|---|---|
| FR-OF-01 | F02 |
| FR-OF-02 | F02 |
| FR-OF-03 | F02, F05 |
| FR-OF-04 | F03 |
| FR-OF-05 | F03 |
| FR-OF-06 | F03 |
| FR-OF-07 | F03 |
| FR-OF-08 | F05 |
| FR-OF-09 | F04 |
| FR-OF-10 | F04 |
| FR-OF-11 | F04 |
| FR-OF-12 | F04 |
| FR-OF-13 | F02 (call), F05 (signal wiring) |
| FR-OF-14 | F05 |
| FR-OF-15 | F05 |
| FR-OF-16 | F05 |
| FR-OF-17 | F05 |
| FR-OF-18 | F05 |
| FR-OF-19 | F03 (poll retries), F05 (mapping) |
| FR-OF-20 | F03, F05 |
| FR-OF-21 | F02 |
| FR-OF-22 | F05 |
| FR-OF-23 | F01, F07 |
| FR-OF-24 | F01, F07 |
| FR-OF-25 | F06 |
| FR-OF-26 | F06 |
| FR-OF-27 | F04, F05 |
| FR-OF-28 | F04 |
| FR-OF-29 | F05 |
| FR-OF-30 | F02, F05 |
| NFR-OF-01 | F03, F05 |
| NFR-OF-02 | F05 |
| NFR-OF-03 | F05 |
| NFR-OF-04 | F02 |
| NFR-OF-05 | F02, F05 |
| NFR-OF-06 | F06 |
| NFR-OF-07 | F02, F03, F04, F05, F08 |
| NFR-OF-08 | F02, F03 |
| NFR-OF-09 | F02, F05 |
| NFR-OF-10 | F01, F02 |

## Coverage check (backward)

Every feature row above carries at least one `FR-OF-*` or `NFR-OF-*` ID — no orphan features.

## Dependency graph

```
F01 ─► F02 ─┬─► F03 ─┐
            ├─► F04 ─┤
            │        │
            └────────┴─► F05 ─► F06 ─► F08
                              │
                              └─► F07
```

DAG, no cycles. Topological linearization (matches `#` ordering): F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08.

## Architecture compliance summary

Per [`.agent/architecture/architecture.md`](../../architecture/architecture.md) §1–§2 (layered, unidirectional deps; pure core / IO at edges; registry pattern) and the prior slice's vault-isolation invariant ([`../external-agent_slice_20260427-022536/features/adapter-contract/feature.md`](../external-agent_slice_20260427-022536/features/adapter-contract/feature.md)):

### Layering

All openfang code lives under `src/agent/externalAgent/adapters/openfang/`. The ESLint `no-restricted-imports` rule installed by F01 of the prior slice already denies imports from `src/agent/`, `src/chat/`, `src/ui/`, `src/storage/`, `src/editor/` for files under `src/agent/externalAgent/adapters/**`. The only allowed cross-module imports are the contract types (`../base.ts`) and `zod`.

### Pure core

F01 (schema), F03 (polling backoff math), F04 (artifact enumeration logic, modulo the IO call) and F05's failure-prefix decoder are pure and unit-testable without msw. IO (HTTP) is isolated to F02 and the artifact-download call inside F04.

### Registry pattern

F06 registers via the existing `AdapterRegistry` (no new registry). Default-selection logic in [`src/settings/externalAgentResolver.ts`](../../../src/settings/externalAgentResolver.ts) and `effectiveDefaultAdapterId()` from F11 of the prior slice are reused unchanged.

### Interrupt-driven tool flow

Out of scope for this slice — `delegate_external` (F06 of the prior slice) already owns the interrupt + Prepare/Deny semantics. The openfang adapter is invoked downstream of the confirmation, exactly like any other adapter implementation.

### Vault-isolation invariant (NFR-EXT-02 mirror)

The openfang adapter never receives a `Vault`, `EditorBridge`, `Logger`, `SettingsStore`, or `SafeStorage` handle. It receives only `ExternalAgentInput`. Settings resolution (including `SafeStorage` decrypt of `apiKey`) happens in `resolveAdapterConfig(id)` of the prior slice's F11 *before* `adapter.start()` is called; the adapter sees a plain `OpenfangConfig` object.

### Bundle discipline

F06 carries the bundle-budget acceptance criterion (NFR-OF-06 ≤ 15 KB). Per-feature implementations are kept minimal: hand-rolled HTTP client (no axios / undici / a2a-sdk), no top-level deps added.
