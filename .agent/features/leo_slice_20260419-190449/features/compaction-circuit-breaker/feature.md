# F45 — Autocompact circuit breaker

## Purpose

Per-session circuit breaker that increments a `consecutiveFailures` counter on every autocompact failure emitted by [F43 compaction-autocompact](../compaction-autocompact/feature.md), skips further autocompact attempts once the counter reaches `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`, resets the counter on the next successful autocompact, and surfaces the tripped state through the status-bar channel wired in [F13 ui-visual-states-notifications](../ui-visual-states-notifications/feature.md). Satisfies the reliability NFR at [NFR-REL-06](../../context.md#nfr-rel-06), the constants binding at [FR-COMPACT-03](../../context.md#fr-compact-03), and the test coverage mandate at [NFR-TEST-06](../../context.md#nfr-test-06).

## Scope

### In scope

- `AutoCompactTrackingState` instance owned at session scope (one per plugin load) with fields `{ compacted, turnCounter, turnId, consecutiveFailures }` per [compact.md §6 "Tracking State"](../../../../srs/compact.md#6-layer-2-autocompaction).
- Pre-call skip: `autoCompactIfNeeded` consults the session state and returns `null` immediately when `tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` per [compact.md §6 "Auto-Compact Execution" step 2](../../../../srs/compact.md#6-layer-2-autocompaction); no `ProviderManager.stream` call is issued.
- Counter wiring: increment on any F43 failure path that emits `tengu_compact_failed` (summarization error, `no_summary`, `no_streaming_response`) per [compact.md §20 "Error Behavior"](../../../../srs/compact.md#20-error-handling); reset to `0` on a successful autocompact per [compact.md §6 "Auto-Compact Execution" step 6](../../../../srs/compact.md#6-layer-2-autocompaction).
- User-visible status: when the breaker trips (counter transitions from `< 3` to `>= 3`), the feature writes a single persistent status-bar entry via [F13](../ui-visual-states-notifications/feature.md)'s `Notifications.status` channel (e.g. `"Leo: autocompact disabled for this session"`) and emits one `tengu_compact_breaker_tripped` structured log event via [F01 plugin-bootstrap-logging](../plugin-bootstrap-logging/feature.md); no `Notice` toast (auto-path stays silent per [compact.md §20 "Error Behavior"](../../../../srs/compact.md#20-error-handling)).
- Lifecycle: the session state is bound to the plugin instance and reset on `onunload` / `onload`; no persistence across restarts per [compact.md §20 "Error Behavior"](../../../../srs/compact.md#20-error-handling) ("rest of the session").
- Vitest coverage per [NFR-TEST-06](../../context.md#nfr-test-06): counter increment on each `tengu_compact_failed` branch, skip at threshold with zero `stream` invocations, reset on success, status-bar write once at the trip edge, teardown clears the status-bar entry.

### Out of scope

- Autocompact engine, retry loop, prompt assembly, post-compact budgets — all in [F43](../compaction-autocompact/feature.md).
- PTL retry loop that feeds this counter on exhaustion — in [F44 compaction-ptl-retry](../compaction-ptl-retry/feature.md).
- Manual `/compact` error surfacing (re-throw + user Notice) per [compact.md §20 "Error Behavior"](../../../../srs/compact.md#20-error-handling) — manual path lives outside this feature; the breaker only gates auto.
- Cross-session persistence of the counter, or a "re-enable" user control — not required by [NFR-REL-06](../../context.md#nfr-rel-06).
- Token-warning UI, `/context`, status-line budget grid — deferred to [F46+](../../features-index.md).
- Status-bar item visual design / copy — owned by [F13](../ui-visual-states-notifications/feature.md)'s `Notifications.status` contract.

## Acceptance criteria

1. A single session-scoped `AutoCompactTrackingState` object carrying `consecutiveFailures: number` (initial `0`) is owned by the autocompact module and reset on plugin `onload`; Vitest asserts identity + initial value. ([NFR-REL-06](../../context.md#nfr-rel-06), [compact.md §6 "Tracking State"](../../../../srs/compact.md#6-layer-2-autocompaction))
2. On every failure path in [F43](../compaction-autocompact/feature.md) that emits `tengu_compact_failed` (`no_summary`, `no_streaming_response`, generic summarization error), the counter increments by exactly one; Vitest drives all three branches and asserts the final count. ([NFR-REL-06](../../context.md#nfr-rel-06), [compact.md §6 "Auto-Compact Execution" step 7](../../../../srs/compact.md#6-layer-2-autocompaction), [compact.md §20 "Error Behavior"](../../../../srs/compact.md#20-error-handling))
3. On a successful autocompact (non-null `CompactionResult`), the counter resets to `0` before returning; Vitest with a 2-failure-then-success fixture asserts the counter ends at `0`. ([NFR-REL-06](../../context.md#nfr-rel-06), [compact.md §6 "Auto-Compact Execution" step 6](../../../../srs/compact.md#6-layer-2-autocompaction))
4. When `tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`, `autoCompactIfNeeded` short-circuits before `shouldAutoCompact` is called and before any `ProviderManager.stream` invocation; Vitest + `msw` asserts zero outbound stream calls across 10 attempted turns past the threshold. ([NFR-REL-06](../../context.md#nfr-rel-06), [FR-COMPACT-03](../../context.md#fr-compact-03), [compact.md §3 "Compaction Thresholds"](../../../../srs/compact.md#3-constants-and-thresholds), [compact.md §6 "Auto-Compact Execution" step 2](../../../../srs/compact.md#6-layer-2-autocompaction))
5. The `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` constant is exported as `3` and is the single source of truth for the threshold check; a Vitest constant-binding test pins its value. ([FR-COMPACT-03](../../context.md#fr-compact-03), [compact.md §3 "Compaction Thresholds"](../../../../srs/compact.md#3-constants-and-thresholds))
6. On the exact transition `consecutiveFailures` `2 → 3`, the feature calls [F13](../ui-visual-states-notifications/feature.md)'s `Notifications.status` exactly once with a persistent entry and emits one `tengu_compact_breaker_tripped` log event via [F01](../plugin-bootstrap-logging/feature.md); subsequent increments past 3 do not re-emit. Vitest asserts call-count `=== 1` across five consecutive failures. ([NFR-REL-06](../../context.md#nfr-rel-06))
7. The breaker does not surface a user `Notice` toast on the auto path; the status-bar entry is the only user-visible surface, matching [compact.md §20 "Error Behavior"](../../../../srs/compact.md#20-error-handling) ("No user notification [on auto]"). Vitest asserts `Notice` is never constructed on any auto-path failure. ([NFR-REL-06](../../context.md#nfr-rel-06), [compact.md §20 "Error Behavior"](../../../../srs/compact.md#20-error-handling))
8. Plugin `onunload` clears the status-bar entry added by the breaker (if any) via the [F13](../ui-visual-states-notifications/feature.md) `Notifications.status` teardown contract, leaving no dangling DOM or listeners; Vitest asserts a DOM-detached entry after unload. ([NFR-REL-06](../../context.md#nfr-rel-06))

## Dependencies

- [F43 compaction-autocompact](../compaction-autocompact/feature.md) — hosts `autoCompactIfNeeded` and emits `tengu_compact_failed`; this feature plugs the counter check into step 2 of [compact.md §6 "Auto-Compact Execution"](../../../../srs/compact.md#6-layer-2-autocompaction) and the increment into step 7.
- [F13 ui-visual-states-notifications](../ui-visual-states-notifications/feature.md) — provides the `Notifications.status` channel used to surface the tripped state with a persistent status-bar entry per [FR-UI-08](../../context.md#fr-ui-08).
- [F01 plugin-bootstrap-logging](../plugin-bootstrap-logging/feature.md) — Logger emits `tengu_compact_breaker_tripped`.
- [context.md#nfr-rel-06](../../context.md#nfr-rel-06) — reliability NFR requiring the circuit breaker and 3-failure disable.
- [context.md#fr-compact-03](../../context.md#fr-compact-03) — binds the `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` constant to compact.md §3.
- [context.md#nfr-test-06](../../context.md#nfr-test-06) — mandates Vitest coverage for the circuit breaker.
- [compact.md §3 "Compaction Thresholds"](../../../../srs/compact.md#3-constants-and-thresholds), [§6 "Auto-Compact Execution" / "Tracking State"](../../../../srs/compact.md#6-layer-2-autocompaction), [§20 "Error Behavior"](../../../../srs/compact.md#20-error-handling) — authoritative external spec; no content restated here.

## Implementation notes

- [Architecture §3.2 Agent Layer](../../../../architecture/architecture.md#32-agent-layer) — the session-scoped tracking state lives alongside [F43](../compaction-autocompact/feature.md) in the agent layer.
- [Architecture §3.3 Domain / Core (pure)](../../../../architecture/architecture.md#33-domain--core-pure) — the `shouldSkipForCircuitBreaker(tracking)` predicate is pure; IO is confined to the status-bar write and log emit.
- [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership) — tracking state is session-scoped and owned by the autocompact module.
- [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy) — auto-path swallow-and-telemeter matches the "no Notice on auto" rule this feature enforces.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — the status-bar entry added by the breaker must be torn down on plugin unload.
- [Tech stack — Agent Layer](../../../../standards/tech-stack.md#agent-layer), [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — pin LangGraph and `addStatusBarItem` via the [F13](../ui-visual-states-notifications/feature.md) `Notifications.status` seam.
- [Tech stack — Testing](../../../../standards/tech-stack.md#testing) — Vitest + `msw` stream-mock drives the failure-branch matrix.
- [Code style — TypeScript](../../../../standards/code-style.md#typescript), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency) — govern the tracking-state surface and `AbortSignal` threading inherited from [F43](../compaction-autocompact/feature.md).
- [Code style — LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer) — typed state, no thrown errors escaping.
- [Code style — Logging](../../../../standards/code-style.md#logging) — fixes the `tengu_compact_breaker_tripped` event shape.
- [Code style — Error Handling](../../../../standards/code-style.md#error-handling) — auto-path swallow-and-telemeter.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — governs the counter-matrix test layout.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — purity, single responsibility, observability.

## Open questions

- **Tracking-state scope granularity**: [compact.md §6 "Tracking State"](../../../../srs/compact.md#6-layer-2-autocompaction) shows a single per-session object. Leo supports multiple threads ([F37](../../features-index.md)) — does the breaker trip per-session (plugin load) or per-thread? Proposing per-session to match the SRS "rest of the session" wording in [compact.md §20 "Error Behavior"](../../../../srs/compact.md#20-error-handling); revisit if users report that one bad thread disables autocompact for healthy threads.
- **User re-enable control**: [NFR-REL-06](../../context.md#nfr-rel-06) does not require a user-facing "reset breaker" action. Should v1 expose a Settings-tab button (via [F03](../settings-tab-scaffold/feature.md)) to zero the counter mid-session, or rely on plugin reload? Proposing reload-only for v1.
- **Status-bar copy and tooltip**: [context.md Open questions](../../context.md#open-questions) "Circuit-breaker surface (NFR-REL-06)" flags that user visibility is not explicitly required. This feature ships the status-bar entry to satisfy the features-index "user-visible status" commitment; exact copy and tooltip belong to the [F13](../ui-visual-states-notifications/feature.md) wireframe pass.
- **Counter under concurrent turns**: If two turns race into [F43](../compaction-autocompact/feature.md) and both fail, does the counter double-increment or collide? [F10 agent-controller-core](../agent-controller-core/feature.md) serialises turns via the message queue, so concurrent autocompact should not occur — confirm the serialisation invariant holds across [F11 chat-message-queue](../../features-index.md) re-entries.
- **Reset on manual compact success**: [compact.md §20 "Error Behavior"](../../../../srs/compact.md#20-error-handling) resets on successful autocompact but is silent on manual `/compact`. Does a successful manual compact also reset the counter? Proposing yes — a working summarization call proves the pipeline is healthy — but defer binding until the manual-compact feature lands.
