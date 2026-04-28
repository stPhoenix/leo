# Impl iteration 1 — F05 event-bridge

## Summary

Landed `eventBridge.ts` with the elision rules and ExternalEvent translators required for FR-IA-45..48 and NFR-IA-05: `elideArgs` (per-tool overrides plus 256-char generic threshold), `mapToolStart` / `mapToolEnd` / `mapNodeComplete` / `mapAdapterError` / `mapTextDelta`, and a `bridgeStream` async generator that swallows thrown exceptions to emit a single `{type:'error',...}` event without re-throwing. Logging namespace `externalAgent.adapter.inlineAgent.*` registered in `loggingNamespaces.ts`.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/eventBridge.ts` — new: helpers + `bridgeStream` + `BridgeChunk` discriminated union.
- `src/agent/externalAgent/loggingNamespaces.ts` — extend `EXTERNAL_AGENT_LOG.adapter` with the inline-agent namespace tree.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/eventBridge.test.ts` — 19 cases:
  - `elideArgs`: 256-char threshold, `fetch_url.body`/`search_web.query`/`extract_note.summary` length-only elision, includeDomains/excludeDomains count-only, sensitive-header redaction.
  - `mapToolStart`: info-level log + body length not in payload (AC2).
  - `mapToolEnd`: debug-level log with no payload (AC3).
  - `mapNodeComplete`: classifier/planner emit info log only (AC4).
  - `mapAdapterError`: preserves `{code,message}`, classifies AbortError/timeout/unknown (AC5).
  - `mapTextDelta`: AC1.
  - `bridgeStream`: happy-path; error chunk terminates iterable; thrown exception caught and surfaced as error event (FR-IA-48); full args appear at debug logger only.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Open-question resolution: nested `headers` for `fetch_url` redacts `Authorization`/`Cookie`/`x-api-key`/`api-key` keys (case-insensitive) at every level above debug. Other keys still subject to per-string elision.
- The bridge accepts a synthetic `BridgeChunk` discriminated union rather than the raw LangGraph `messages`-mode output. F12/F14 will adapt the LangGraph stream into `BridgeChunk`s; isolating the discriminator here keeps the bridge unit-testable without a live LangGraph runtime.

## Assumptions

- The host's `ExternalEvent` log shape is `{type:'log', level, msg}` only — structured fields are serialized into `msg` as JSON. Anything richer (machine-readable structured logs server-side) goes through the injected `InlineAgentLoggerLite.debug`.
- Provider `usage` ticking lives in F11+ node code — the bridge only reports `durationMs`.

## Open questions

- LangGraph `streamMode: 'messages'` chunk shape under prebuilt `createReactAgent` is verified as part of F12/F14 implementation. Bridge-side mapping is a thin function wrap.
