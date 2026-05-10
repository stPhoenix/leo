# F08 — End-to-end MSW lifecycle test

## Purpose

Prove that the registered openfang adapter, exercised through the contract surface (`AdapterRegistry.get('openfang').start(...)`), drives a real-shaped A2A lifecycle from submit through artifact download to `done` event — with `msw` standing in for the daemon. Cover three scenarios: happy path with one artifact, `failed` task with `INFRA_ERROR:` prefix, and cancel mid-poll. This feature carries the integration scope of NFR-OF-07 (per-feature unit coverage lives inside F02–F05).

Implements [`context.md`](../../context.md) NFR-OF-07 (integration scope).

## Scope

**In scope**

- New file `tests/integration/externalAgent/adapters/openfang/lifecycle.test.ts`:
  - `msw` setup mirroring `tests/integration/` patterns; handlers per A2A endpoint:
    - `POST /a2a/tasks/send` — returns `{ id: 'task-1', status: 'working', sessionId: <echo>, messages: [...], artifacts: [] }` on first call
    - `GET /a2a/tasks/task-1` — first invocation returns `working`, second returns `completed` with one fileRef artifact (`url: '/api/a2a/tasks/task-1/artifacts/art-1'`, `name: 'report.md'`, `mimeType: 'text/markdown'`, `size: 12`)
    - `GET /api/a2a/tasks/task-1/artifacts/art-1` — returns 12 bytes (`'hello world!'`) with `Content-Type: text/markdown`, `Content-Length: 12`
    - `POST /a2a/tasks/task-1/cancel` — returns 200 `{}`
  - Test 1 — **happy path**:
    1. Build a fresh `AdapterRegistry`; register `new OpenfangAdapter()`; freeze.
    2. Call `registry.get('openfang')!.start({refinedAsk:'hello demiurg', systemPrompt:'', signal:new AbortController().signal, timeoutMs:30_000, config:{baseUrl:'http://localhost:0', apiKey:'test-key', allowInsecureHttp:true}})`.
    3. Drive the async iterable to completion under `vi.useFakeTimers()`, manually advancing fake time to bridge the polling sleep between the two poll calls.
    4. Collect emitted events; assert the sequence: `log×N → text(chunk='Tokio leads p99 latency …') → file(relPath='report.md', content=Uint8Array(12), mime='text/markdown') → done`.
    5. Assert exactly one `submitTask`, two `pollTask`, one `downloadArtifact`, zero `cancelTask` calls landed at the msw layer.
  - Test 2 — **failed with INFRA_ERROR**:
    1. Override the second `GET /a2a/tasks/task-1` handler to return `failed` + `messages:[{role:'agent', parts:[{type:'text', text:'INFRA_ERROR: anthropic provider unreachable'}]}]`, `artifacts:[]`.
    2. Run the same `start()` flow.
    3. Assert events end with one `text` (full `INFRA_ERROR: …` text per F05 step 8) and one `error{code:'infra_error', message:'anthropic provider unreachable'}` (per F05 §"Failure-prefix decoding"). No `file` events. No `done` event.
  - Test 3 — **cancel mid-poll**:
    1. msw `GET /a2a/tasks/task-1` always returns `working`.
    2. Caller's `AbortController.abort()` after the first successful poll.
    3. Assert: (a) `cancelTask` invoked exactly once, (b) iterable yields `error{code:'cancelled'}`, (c) iterable terminates within 50 ms of fake time after abort.
- Vitest config: ensure the new test file is picked up by the default `pnpm test` config (matches `tests/integration/**/*.test.ts`).

**Out of scope**

- Per-module unit tests — already covered in F01–F05.
- Storybook visual regression — F07.
- The `delegate_external` tool wiring upstream — F06 of the prior slice.
- The widget rendering of openfang events — F08 of the prior slice handles non-streaming adapters generically.
- Live-LLM tests against a real OpenFang daemon — out of v1; would belong in `tests/llm/` if added later.

## Acceptance criteria

1. Three integration tests pass deterministically under `pnpm test` (no real network, no real timers, no flake under 100× repeat).
2. Test 1 (happy path) asserts the full event sequence and the exact set of HTTP calls observed by `msw`. (NFR-OF-07.)
3. Test 2 (failed-with-INFRA_ERROR) confirms `failureDecoder` is wired through `start()` correctly, including the `text`-then-`error` ordering specified in F05 step 9. (FR-OF-15 integration check.)
4. Test 3 (cancel mid-poll) confirms abort latency ≤ 50 ms in fake time and exactly-one cancel call. (NFR-OF-01 integration check.)
5. Tests use `msw` per [`.agent/standards/tech-stack.md`](../../../../standards/tech-stack.md) §"Testing" — no `nock`, no manual `fetch` monkey-patching.
6. Tests use `vi.useFakeTimers()` per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Testing".
7. The fixture `baseUrl` uses `http://localhost:0` (so msw can intercept) with `allowInsecureHttp:true` set on the config — the test file documents in a one-line comment that the `allowInsecureHttp` flag is required for msw + http mock.
8. No real apiKey leaks into test output — assert no captured log contains the literal `'test-key'` string. (FR-OF-30 integration check.)

## Dependencies

- **F05** — `OpenfangAdapter` class, with all behaviors covered by F01–F04.
- **F06** — registration path; the test mirrors plugin-time registration to keep production wiring honest.
- Cross-doc:
  - [`context.md#nfr-of-07`](../../context.md#non-functional-requirements)
  - [`../../../../srs/openfang.md`](../../../../srs/openfang.md) §3, §4, §5, §6, §8 (lifecycle being exercised)
  - [`../openfang-adapter/feature.md`](../openfang-adapter/feature.md)
  - [`../openfang-registration/feature.md`](../openfang-registration/feature.md)

## Implementation notes

- Integration test layout — see [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md) §"Test suites" (`tests/integration/`).
- msw setup pattern — see [`.agent/standards/tech-stack.md`](../../../../standards/tech-stack.md) §"Testing" and existing usage under `tests/integration/`.
- Async/await + abort discipline — see [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Async & Concurrency".
- `ExternalEvent` shape and contract — see `src/agent/externalAgent/adapters/base.ts` (in-tree) and [`../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md`](../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md).

## Open questions

- **OQ-01-F08** Should we add a fourth integration test exercising 401 → `invalid_auth` end-to-end? **Proposed**: yes if test budget permits — F05's unit test already covers it, but the integration loop catches any wiring drift between the HTTP error class and the mapping table. Treat as a stretch goal.
- **OQ-02-F08** Should the artifact download test cover the F04 `404 → skip + warn` branch? **Proposed**: defer to F04's own unit test — adding it here doubles up coverage for marginal end-to-end signal.
- **OQ-03-F08** Should the integration test assert any vault-side effect (e.g. that `ResultWriter` would write the file)? **Proposed**: no — `ResultWriter` lives one layer up (F02 of the prior slice); coupling those concerns here would make the test brittle to upstream refactors. Verifying the `file` event shape is sufficient.
