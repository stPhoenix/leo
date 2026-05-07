# F05 · canvas-logging-namespaces — Canvas logging namespaces

## Purpose

Declare the `canvas.create.*`, `canvas.contentEdit.*`, `canvas.layoutEdit.*`, `canvas.reveal.*` namespace tree and the per-namespace sensitive-field set so every downstream feature emits structured logs against a single, lintable contract. Mirrors `src/agent/wiki/loggingNamespaces.ts` and `src/agent/externalAgent/loggingNamespaces.ts`.

Covers [NFR-CANVAS-03](../../context.md#non-functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/loggingNamespaces.ts` exporting `CANVAS_LOG` namespace tree: per-op (`create` / `contentEdit` / `layoutEdit` / `reveal`) and per-phase events (`refine.start/done`, `plan.start/done`, `fetch.start/done/failed`, `extract.start/done/failed`, `reduce.start/done/failed`, `diff.start/done`, `layout.start/done`, `preview.write`, `write.start/done/failed`, `mutex.acquire/release`, `cancel`, `error`).
- `CANVAS_SENSITIVE_FIELD_KEYS = ['rawSource', 'extractorOutput', 'reducerOutput', 'refineMessages', 'sidecarBody']` — fields the logger must redact at `info+` levels and only emit at `debug`.
- ESLint policy declaration (file is the canonical reference for the lint rule that bars `console.*` and forces use of `Logger` with a registered namespace).

**Out of scope**

- The actual `Logger` implementation — already in `src/platform/Logger.ts`.
- Per-feature log call sites — owned by each consumer.

## Acceptance criteria

1. `CANVAS_LOG` exposes the four roots (`create`, `contentEdit`, `layoutEdit`, `reveal`) and every event name listed in §3 of NFR-CANVAS-03 — traces to NFR-CANVAS-03.
2. Type test asserts `CANVAS_LOG[op]` is a `readonly` record of namespace strings (no accidental mutation site).
3. Sensitive-field array is `readonly` and consumed by the rotating-file sink redactor — traces to NFR-CANVAS-03.
4. Snapshot test of `CANVAS_LOG` keeps the surface stable across refactors.

## Dependencies

- None (foundation).
- Forward consumers: F06–F23.
- Requirements traced: [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-03.

## Implementation notes

- [../../../../architecture/architecture.md#7-error-handling-strategy](../../../../architecture/architecture.md#7-error-handling-strategy) — logging-on-error contract: every catch logs at `error` with namespace + structured context.
- [../../../../standards/code-style.md#logging](../../../../standards/code-style.md#logging) — `Logger` levels, key/value structure, no PII at `info+`.
- [../../../../standards/best-practices.md#operational-excellence](../../../../standards/best-practices.md#operational-excellence) — observability: instrument external calls + retries.

## Open questions

- Should `CANVAS_LOG.reveal` track API-shape probe results separately from invocation results? Yes — separate `reveal.probe.{ok,fail}` from `reveal.invoke.{ok,fail}` so feature-detection telemetry is distinguishable.
