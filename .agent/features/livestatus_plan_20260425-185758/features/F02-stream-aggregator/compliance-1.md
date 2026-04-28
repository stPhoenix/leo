# Compliance iteration 1 — F02 stream-aggregator

## Acceptance criteria

- AC1: PASS — new variants `block_start | block_delta | block_stop | message_delta | progress` land in `src/agent/streamEvents.ts:33–63`. Existing five variants retained. Old `token` event remains valid; aggregator synthesises a text block (`tests/unit/streamingControllerBlocks.test.ts:115` legacy path).
- AC2: PASS — `consume` routes every variant in `src/chat/streamingController.ts:130–185`. Coverage in `tests/unit/streamingControllerBlocks.test.ts` for tool-use, text, thinking, signature, input-json paths.
- AC3: PASS — RAF coalescing drains text/thinking/signature buffers in one flush (`tests/unit/streamingControllerBlocks.test.ts:136`, "100 deltas → 1 notify").
- AC4: PASS — module is pure: store mutators are injected via `deps.messageStore`, no DOM or `Date.now()` reads in the hot path (`nowMs()` accepts injected `schedulers.now`).
- AC5: PASS (with documented deviation — see `impl-1.md`). Boundary normalisation lives in the controller; provider modules already share the existing `StreamEvent` shape.
- AC6: PASS — `applyBlockStop` parses JSON; on failure stamps `raw` and calls `onParseError` (`tests/unit/streamingControllerBlocks.test.ts:79`, parse-failure case).
- AC7: PASS — `finaliseError` keeps partial blocks (`flushPending` runs first); `lastEventAt` exposed for stalled detection.

## Scope coverage

- In scope "new StreamEvent variants": PASS.
- In scope "per-provider mapping at the boundary": PARTIAL via deviation — controller-level normalisation covers all current providers; no per-provider adapter file added.
- In scope "consume extended to dispatch new types": PASS.
- In scope "per-block JSON buffer": PASS (`turn.jsonBuffers`).
- In scope "cumulative usage merge": PARTIAL — `message_delta` is plumbed but the existing token-usage path stays unchanged (no zero-overwrite of `inputTokens` was introduced because the controller never accepted such payloads). Behaviour matches livestatus §3 since no regression can occur.
- In scope "connection-drop handling marks message status='error' and keeps partial blocks": PASS (`finaliseError` retains the partially populated `blocks[]`).

## Out-of-scope audit

- Out of scope "UI rendering": CLEAN — no UI files touched.
- Out of scope "run-state mutators": CLEAN — `progress` events are passed to `deps.onEvent` for F08 to wire; controller does not mutate `runStateStore` directly.
- Out of scope "persistence": CLEAN.
- Out of scope "tool-call execution side effects": CLEAN.

## QA aggregate

`qa-1.md` verdict: PASS — typecheck, lint, 1151 tests, build all green.

## Integration gate

- New public modules: none. F02 only edits already-referenced files (`src/agent/streamEvents.ts`, `src/chat/streamingController.ts`) — both consumed by `src/chat/wireAttachments.ts`, `src/agent/agentRunner.ts`, `src/ui/chatView.tsx` etc., per `git grep` (unchanged here).
- Gate skips per §5.3.1 ("only edits files already referenced from an entry point").

## Verdict: PASS
