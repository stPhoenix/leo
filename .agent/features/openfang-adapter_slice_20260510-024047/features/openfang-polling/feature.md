# F03 — Polling driver

## Purpose

Drive the A2A poll loop until the task reaches a terminal state, with deterministic exponential back-off, abort responsiveness, a hard timeout, and bounded retries on transient `5xx` failures. The driver is a pure timing/state module: it takes the HTTP transport from F02 as a dependency and is fully testable with `vi.useFakeTimers()` — no real network, no real clock.

Implements [`context.md`](../../context.md) FR-OF-04, FR-OF-05, FR-OF-06, FR-OF-07, FR-OF-19 (poll-side retries), FR-OF-20, NFR-OF-01 (poll-loop side), NFR-OF-08.

## Scope

**In scope**

- New file `src/agent/externalAgent/adapters/openfang/polling.ts` exporting:
  - `extractStatusKind(status: A2aStatus): A2aStatusKind` — pure helper. If `status` is an object with `.state`, returns `state`. Else returns `status` cast as `A2aStatusKind`. Defensive: unknown strings return verbatim and the loop treats them as non-terminal until timeout.
  - `isTerminalState(s: A2aStatusKind): boolean` — `true` for `completed | failed | cancelled`, false otherwise (including `inputRequired`, per OQ-06 of context.md). (FR-OF-07.)
  - `pollUntilTerminal(deps: PollDeps, opts: PollOpts): Promise<PollResult>`:
    - `PollDeps`: `{ http: Pick<OpenfangHttp, 'pollTask'>; sleep: (ms: number, signal: AbortSignal) => Promise<void>; now: () => number }` — `sleep` and `now` injected so tests use fake timers.
    - `PollOpts`: `{ taskId: string; signal: AbortSignal; initialIntervalMs: number; maxIntervalMs: number; timeoutMs: number; transientRetryBudget?: number; transientRetryBaseMs?: number }`. Defaults: budget = 3, base = 1_000.
    - `PollResult`: discriminated union — `{ kind: 'terminal'; task: A2aTask } | { kind: 'timeout' } | { kind: 'aborted' } | { kind: 'transient_exhausted'; lastStatus: number }`.
  - Loop algorithm:
    1. `deadline = now() + timeoutMs`; `interval = initialIntervalMs`; `transientRemaining = transientRetryBudget`.
    2. Top of loop: if `signal.aborted` return `aborted`. If `now() >= deadline` return `timeout`.
    3. Try `http.pollTask(taskId, signal)`. On success: read `extractStatusKind(task.status)`; if terminal → `{kind:'terminal', task}`. Reset `transientRemaining = transientRetryBudget` on any 2xx response.
    4. On `OpenfangHttpError` with `status >= 500`: decrement `transientRemaining`. If `0`: return `{kind:'transient_exhausted', lastStatus}`. Else `await sleep(transientRetryBaseMs * 2 ** (budget - remaining), signal)`; continue without advancing `interval`.
    5. On `OpenfangHttpError` with `status` in {401, 403, 404}: re-throw — caller (F05) maps these. (Polling does not retry auth/lookup errors.)
    6. On `AbortError`: return `aborted`.
    7. After a successful non-terminal poll: `await sleep(interval, signal)`; `interval = Math.min(Math.ceil(interval * 1.5), maxIntervalMs)`.
  - Cancellation responsiveness: `sleep` must wake on `signal.aborted` ≤ 50 ms in tests; hard ceiling ≤ 2 s in real time per NFR-OF-01. Implementation uses a small helper that registers `signal.addEventListener('abort', resolveEarly, { once: true })` and clears on completion.
- `sleep` reference implementation `abortableSleep(ms, signal)` co-located in `polling.ts`; injectable for tests.
- Unit tests at `tests/unit/externalAgent/adapters/openfang/polling.test.ts`:
  - status parser: `'working'`, `{state:'working'}`, `{state:'completed', message:null}` all parse correctly; unknown string `'frobnicate'` returns verbatim and is non-terminal
  - terminal-state matrix: 6 states × terminal-yes/no asserted in a table
  - happy path with fake timers: 1st poll `working`, 2nd poll `completed` — interval grew from 2000 → 3000 (math: ceil(2000 * 1.5))
  - back-off cap: starting interval 10_000, cap 15_000 — observed series `10_000, 15_000, 15_000, …`
  - abort during sleep: `signal.abort()` mid-sleep returns `aborted` within 50 ms (fake-timer assertion)
  - abort during in-flight poll: `signal.abort()` while `pollTask` pending → `aborted`
  - timeout: `timeoutMs = 5_000`; all polls return `working`; loop ends with `timeout` after 5s of fake-time
  - 5xx retry: 3 successive 500s → `transient_exhausted` with `lastStatus: 500`
  - 5xx + recovery: 1 × 500, 2 × `working`, 1 × `completed` — returns terminal; budget reset on the recovered 2xx
  - 401 short-circuit: poll returns 401 → `pollUntilTerminal` re-throws `OpenfangHttpError(401)`
  - `inputRequired` state is non-terminal — loop continues until timeout (matches context.md OQ-06)

**Out of scope**

- HTTP transport itself (F02).
- Failure-prefix decoding on the terminal task's text (F05).
- Artifact download (F04).
- Cancel call to the daemon (F02 + F05; polling driver only stops the local loop, FR-OF-14).
- Configuration validation (F01).

## Acceptance criteria

1. `pollUntilTerminal` returns one of the four `PollResult` variants — never throws on any documented HTTP failure mode except 401/403/404 which it re-throws unchanged for caller mapping. (FR-OF-04, FR-OF-19.)
2. Back-off math: `interval(n+1) = min(ceil(interval(n) * 1.5), maxIntervalMs)`. Starting at 2000 with cap 15000 produces the series `2000, 3000, 4500, 6750, 10125, 15000, 15000, …`. Asserted by table-test. (FR-OF-05.)
3. Status parsing accepts both bare-string and `{state, message}` shapes. Unknown strings parse to themselves and are treated non-terminal. (FR-OF-06, NFR-OF-08.)
4. Terminal predicate matches FR-OF-07 exactly: `completed | failed | cancelled` ⇒ true; `submitted | working | inputRequired` ⇒ false.
5. Abort responsiveness: from `signal.aborted` to function-return ≤ 2 s under real timers; ≤ 50 ms under fake timers. (NFR-OF-01.)
6. Hard timeout: function returns `{kind:'timeout'}` once `now() >= deadline`, regardless of poll cadence. (FR-OF-20.)
7. 5xx retry budget: default 3, exponential `base * 2 ** (attempt - 1)`. Budget resets on any successful 2xx. Exhausted budget yields `transient_exhausted` with the last observed status code. (FR-OF-19 poll side.)
8. 401/403/404 re-thrown unmodified; the driver does **not** swallow these so F05 can apply the auth/eviction-mapping table. (FR-OF-16, FR-OF-17, FR-OF-18 path through.)
9. Pure module — no `import` of `fetch`, `Logger`, plugin internals, or any module outside `./httpClient` (types only) and `node:` built-ins. Vault-isolation maintained via type-only import. (NFR-OF-02 via the adapter shell.)
10. Vitest test file uses `vi.useFakeTimers()` per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Testing".

## Dependencies

- **F02** — `OpenfangHttp.pollTask`, `OpenfangHttpError`, `A2aTask`, `A2aStatus` types.
- Cross-doc:
  - [`context.md#fr-of-04`](../../context.md#functional-requirements)
  - [`../../../../srs/openfang.md`](../../../../srs/openfang.md) §3 (status forms), §4 (polling), §9 (cadence).
  - [`../openfang-http-client/feature.md`](../openfang-http-client/feature.md)

## Implementation notes

- Pure-core / IO-edge separation — see [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §1 ("Pure core, IO at edges") and the prior slice's analogous separation in [`../../../external-agent_slice_20260427-022536/features/run-phase/feature.md`](../../../external-agent_slice_20260427-022536/features/run-phase/feature.md).
- Async cancellation — see [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Async & Concurrency" (every fetch carries a signal; explicit timeouts; never bare).
- Fake-timer testing pattern — see [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Testing" ("no real clock, use `vi.useFakeTimers`").
- `1.5×` growth factor matches SRS §4 example progression and §9 best-practice text — codified here as the only place using the constant.

## Open questions

- **OQ-01-F03** Should the back-off factor (`1.5`) be configurable? **Proposed**: no — SRS calls out `2 s → 15 s` exponential without specifying a factor; `1.5` produces the series in §4 verbatim. Adding a setting widens the surface for marginal gain.
- **OQ-02-F03** Should `inputRequired` ever become terminal in this slice? Demiurg currently does not emit it for top-level tasks. **Proposed**: keep non-terminal (matches context.md OQ-06). If real demiurg behavior changes, update the predicate alongside.
- **OQ-03-F03** Should `transient_exhausted` collapse to `timeout` if the user has set a very tight `pollTimeoutMs`? **Proposed**: no — the codes carry distinct semantics (transient = retry-eligible; timeout = work too slow). F05's mapping preserves both.
