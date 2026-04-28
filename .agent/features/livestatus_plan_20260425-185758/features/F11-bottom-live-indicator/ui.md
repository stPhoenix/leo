# F11 — UI: bottom live indicator

## Layout

Idle:

```
(hidden)
```

Thinking:

```
─────────────────────────────────────────
  ✦ Thinking…   (shimmer over chars)
```

Reasoning:

```
─────────────────────────────────────────
  ✦ Reasoning…
```

Running tool:

```
─────────────────────────────────────────
  ⠋ Running Bash · 4.2s        [ Esc to cancel ]
```

Stalled:

```
─────────────────────────────────────────
  ⚠ Working… (no output for 14s)   [ Esc to cancel ]
```

Multiple tools (sub-agent):

```
─────────────────────────────────────────
  ⠋ Running 3 tools (Read +2)   [ Esc to cancel ]
```

## State machine

```
idle ──phase=streaming, lastBlock=text────▶ thinking
idle ──phase=streaming, lastBlock=thinking▶ reasoning
idle ──inProgressToolUseIds.size>0────────▶ running
running ──tool resolves, no others, still streaming──▶ thinking
running ──no event >10s───────────────────▶ stalled
thinking ──no event >10s──────────────────▶ stalled
stalled ──new event─────────────────────▶ <previous label>
* ──phase=idle && inProgress=0──────────▶ idle
* ──Esc────────────────────────────────▶ cancelling → cancelled → idle
```

## Event flow

```
1. streamingController emits phase change → onPhaseChange.
2. messageStore latest message blocks read → derive last-block kind.
3. runStateStore inProgressToolUseIds size + first id → tool name lookup.
4. Component picks label per state machine.
5. RAF tick re-evaluates elapsed time + stalled check.
6. Esc handler: streamingController.stop(); for id in inProgressToolUseIds → markCanceled.
```

## Component mapping

| UI region | Component | Source |
|---|---|---|
| Indicator container | `BottomLiveIndicator` | this feature |
| Shimmer | `<ShimmerText text>` (internal) | this feature |
| Spinner | `<SpinnerGlyph frame>` reusing braille frames per [`livestatus.md` §16](../../../../srs/livestatus.md) | this feature |
| Cancel button | `<StopButton>` | this feature |
| Color tokens | Obsidian CSS vars per [`tech-stack.md` § UI Layer](../../../../standards/tech-stack.md#ui-layer) | — |

### Storybook

`src/ui/chat/BottomLiveIndicator.stories.tsx`. Stories:

- `Idle` — hidden.
- `Thinking` — shimmer.
- `Reasoning`.
- `Running` — single tool, elapsed counter.
- `RunningMultiple` — count + first tool.
- `Stalled` — 14 s no output.
- `EscCancellation` — story exercises Esc via play function.

Mocks: `mockStreamingController` + `mockRunStateStore` from F14.

## Back-link

[feature.md](./feature.md)
