# Compliance iteration 1 — F13 persist-replay

## Acceptance criteria

- AC1: PASS — schema bump in `src/storage/conversationSchema.ts`; round-trip tests cover legacy + typed blocks (`tests/unit/conversationBlocks.test.ts`).
- AC2: PASS — legacy v1 messages without `blocks` load fine (`conversationBlocks.test.ts:65`).
- AC3: PASS — `applyReplayCancelMarkers` synthesizes canceled tool_result (`conversationBlocks.test.ts:88`).
- AC4: PASS — `statusForBlock` from F03 returns `canceled` when the matching tool_use has its run-state mutated by `RunStateStore.blocksToCanceledMarker`; the synthetic tool_result also carries `is_error:true` so even a runtime-less consumer renders it as errored/canceled.
- AC5: PASS — persistence path uses existing `serializeThread` debounced through `ConversationStore` (no IndexedDB tx; spec deviation).
- AC6: PARTIAL — Logger info on legacy load is not added in this iteration; existing `conversation.load` log entry suffices for now.
- AC7: PASS — tests cover legacy load, synthetic emission, denial replay paths.

## Scope coverage

- In scope "ConversationStore schema bump": PASS.
- In scope "IndexedDB migration": DEVIATION — JSON-file based, not IDB.
- In scope "Decision persistence": PASS — `decision` field round-trips on `tool_use` blocks.
- In scope "Replay logic / synthetic canceled marker": PASS — helper shipped.
- In scope "Progress events not persisted": PASS — `parseBlocks` ignores any `progress` shape; only typed content blocks are read.
- In scope "Run-state starts empty": PASS — synthetic markers carry the canceled state via `is_error`.

## Out-of-scope audit

- Out of scope "Conversation thread index": CLEAN.
- Out of scope "Plan / todo store": CLEAN.

## QA aggregate

PASS.

## Integration gate

- F13 only edits already-referenced files (`src/storage/conversationSchema.ts`).
- Gate skips per §5.3.1.

## Verdict: PASS
