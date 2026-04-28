# F05 — Event bridge + log elision

## Purpose

Translate LangGraph stream chunks (token deltas, tool-call starts, tool-call results, run errors) into the host's `ExternalEvent` discriminated-union type with the elision rules required by [context.md#nfr-ia-05](../../context.md#non-functional-requirements). Owns single-source-of-truth helpers for argument elision (>256 chars, plus per-tool elision targets) and node-level metadata logging (`classify_task`, `planner` emit one `log info` on completion, never `text`). Covers FR-IA-45, FR-IA-46, FR-IA-47, FR-IA-48, NFR-IA-05.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/eventBridge.ts` exporting:
  - `bridgeStream(asyncIterableFromLangGraph, { logger, runState, nodeContext }): AsyncIterable<ExternalEvent>` — translates `messages` mode chunks per FR-IA-45.
  - `elideArgs(toolName, args)` — generic >256-char string elision plus per-tool overrides: `fetch_url.body` (length only), `search_web.query` (length only), `search_web.includeDomains|excludeDomains` (count only), `extract_note.summary` (length only). Full values appear only at `debug` level via separate `logger.debug` call.
  - `mapToolStart(toolName, args, durationMs?) → ExternalEvent { type: 'log', level: 'info', ... }`.
  - `mapToolEnd(toolName, ok, error?, durationMs) → ExternalEvent { type: 'log', level: 'debug', ... }`.
  - `mapNodeComplete(node, meta) → ExternalEvent { type: 'log', level: 'info', ... }` for classifier + planner.
  - `mapAdapterError(err) → ExternalEvent { type: 'error', error: { code, message } }`.
- Logging namespace `externalAgent.adapter.inlineAgent.*` registered in [`src/agent/externalAgent/loggingNamespaces.ts`](../../../../src/agent/externalAgent/loggingNamespaces.ts).
- Unit tests: each elision target preserved at `debug`, redacted at `info`; classifier/planner emit only `log` events (no `text`); `mapAdapterError` packages provider errors with `error.code` derived; `start()` never re-throws synchronously.

Out of scope:
- The actual stream production (each node owns its `ChatModel.stream` call).
- Error code taxonomy for adapter-level failures (defined as the run progresses; F11/F12/F13/F14/F15/F16 contribute codes via §9 SRS table).

## Acceptance criteria

1. Token deltas from any `ChatModel.stream` chunk in `messages` mode emit `{ type: 'text', chunk }` events ([context.md#fr-ia-45](../../context.md#functional-requirements)).
2. Tool-call start emits one `{ type: 'log', level: 'info', ... }` with elided args; full args appear only via `logger.debug` channel ([context.md#fr-ia-46](../../context.md#functional-requirements)).
3. Tool-call result emits one `{ type: 'log', level: 'debug', tool, ok, error?, durationMs }`. Result payloads are never logged ([context.md#fr-ia-47](../../context.md#functional-requirements)).
4. Classifier and planner nodes emit no `text` events; instead one `{ type: 'log', level: 'info', node, route?, planLength?, durationMs }` per node completion ([context.md#fr-ia-45](../../context.md#functional-requirements)).
5. Any adapter-level error (provider failure, schema validation thrown out of LangChain) → one `{ type: 'error', error: { code, message } }` and the iterable terminates; the adapter never throws synchronously out of `start()` ([context.md#fr-ia-48](../../context.md#functional-requirements)).
6. Argument elision applies whenever the value is a string > 256 chars OR matches the per-tool override list (counts for `includeDomains` / `excludeDomains`) ([context.md#nfr-ia-05](../../context.md#non-functional-requirements)).
7. Logger namespace `externalAgent.adapter.inlineAgent.*` is registered and the elision rule applies at all levels above `debug`.

## Dependencies

- [F01 — adapter scaffold](../adapter-scaffold/feature.md) (logger injected via constructor).
- [F04 — run state + budgets](../run-state-budgets/feature.md) (`nodeContext` carries `route`, `currentStep` for richer log meta).
- [`src/agent/externalAgent/adapters/base.ts`](../../../../src/agent/externalAgent/adapters/base.ts) — `ExternalEvent` union (`text` / `log` / `file` / `done` / `error`).
- [`src/agent/externalAgent/loggingNamespaces.ts`](../../../../src/agent/externalAgent/loggingNamespaces.ts) — extend tree.
- [`src/platform/Logger.ts`](../../../../src/platform/Logger.ts) — log levels.

## Implementation notes

- Logging conventions (structured key/value, no PII above debug): [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Logging".
- Streaming + adapter contract preview: [`.agent/standards/tech-stack.md`](../../../../.agent/standards/tech-stack.md) "Streaming" row.
- Existing host event consumer wiring (so we don't accidentally invent events the widget can't render): [`src/agent/externalAgent/state.ts`](../../../../src/agent/externalAgent/state.ts) `applyExternalEvent`.
- Best-practices observability: structured logs at every checkpoint per [`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Operational Excellence".

## Open questions

- LangGraph `streamMode: 'messages'` chunk shape with `createReactAgent` prebuilt — verify the chunk discriminant before pinning the bridge logic. SRS assumes token deltas; prebuilt may also surface intermediate structured outputs.
- Should classifier/planner `usage` (cumulative tokens) be ticked here in the bridge or by their nodes? Lean: nodes tick `runState`, bridge logs `durationMs` only.
- Argument elision for nested object values — current rule is per-string-field. Decide whether to recurse into `headers` for `fetch_url` (could leak auth tokens at debug). Lean: redact `Authorization` / `Cookie` headers at every level above `trace`.
