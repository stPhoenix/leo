# Outline — canvas slice 20260505-190819

## Phase 1 — Analyze
- [context.md](context.md) — scope/out-of-scope/actors/FR/NFR/constraints/glossary/open-questions for the Canvas SRS

## Phase 2 — Slice
- [features-index.md](features-index.md) — 23 features (F01–F23), topologically ordered, every FR/NFR mapped to ≥ 1 feature

## Phase 3 — Detail

### Feature docs (23)
- [features/canvas-json/feature.md](features/canvas-json/feature.md) — F01 Canvas JSON schema + path safety
- [features/canvas-navigator/feature.md](features/canvas-navigator/feature.md) — F02 Canvas-view navigator adapter
- [features/reveal-in-canvas-tool/feature.md](features/reveal-in-canvas-tool/feature.md) — F03 reveal_in_canvas tool
- [features/canvas-budgets-runid-slug/feature.md](features/canvas-budgets-runid-slug/feature.md) — F04 Budgets / runId / slug
- [features/canvas-logging-namespaces/feature.md](features/canvas-logging-namespaces/feature.md) — F05 Logging namespaces
- [features/canvas-mutex/feature.md](features/canvas-mutex/feature.md) — F06 Per-canvas-path mutex
- [features/canvas-sidecar/feature.md](features/canvas-sidecar/feature.md) — F07 Sidecar read/write store
- [features/canvas-refine/feature.md](features/canvas-refine/feature.md) — F08 Refine sub-agent + RunPlan
- [features/canvas-source-planner/feature.md](features/canvas-source-planner/feature.md) — F09 Eager source-hint expansion
- [features/canvas-source-fetcher/feature.md](features/canvas-source-fetcher/feature.md) — F10 Source fetcher adapter
- [features/canvas-extractor/feature.md](features/canvas-extractor/feature.md) — F11 Extractor sub-agent + concurrency
- [features/canvas-reducer/feature.md](features/canvas-reducer/feature.md) — F12 Reducer + insights
- [features/canvas-layouts/feature.md](features/canvas-layouts/feature.md) — F13 Layout presets + auto-select + node-size + free-space
- [features/canvas-diff/feature.md](features/canvas-diff/feature.md) — F14 Diff merge + lock detection
- [features/canvas-writer/feature.md](features/canvas-writer/feature.md) — F15 Preview write + atomic + sidecar persist
- [features/canvas-subgraph/feature.md](features/canvas-subgraph/feature.md) — F16 Subgraph FSM driver + orchestrator
- [features/canvas-widget-live/feature.md](features/canvas-widget-live/feature.md) — F17 Live widget + view models + controller
- [features/canvas-widget-terminal/feature.md](features/canvas-widget-terminal/feature.md) — F18 Terminal snapshot + terminal block
- [features/delegate-canvas-create/feature.md](features/delegate-canvas-create/feature.md) — F19 delegate_canvas_create tool
- [features/delegate-canvas-content-edit/feature.md](features/delegate-canvas-content-edit/feature.md) — F20 delegate_canvas_content_edit tool
- [features/delegate-canvas-layout-edit/feature.md](features/delegate-canvas-layout-edit/feature.md) — F21 delegate_canvas_layout_edit tool
- [features/canvas-slash-commands/feature.md](features/canvas-slash-commands/feature.md) — F22 /canvas-create, /canvas-edit, /canvas-status
- [features/canvas-bundle-perf-harden/feature.md](features/canvas-bundle-perf-harden/feature.md) — F23 Bundle + perf hardening

### UI docs (3 — ui-needed=yes features)
- [features/canvas-widget-live/ui.md](features/canvas-widget-live/ui.md) — F17 layout / state machine / Storybook
- [features/canvas-widget-terminal/ui.md](features/canvas-widget-terminal/ui.md) — F18 layout / state machine / Storybook
- [features/canvas-slash-commands/ui.md](features/canvas-slash-commands/ui.md) — F22 layout / state machine / Storybook

## Phase 4 — Verify
- [verification-1.md](verification-1.md) — checks 1–8; FAIL on check 4a (F17 state machine had Done/Cancelled/Error without F17-side variants)
- [verification-2.md](verification-2.md) — re-run after remediation-1; PASS

## Phase 5 — Remediate
- [remediation-1.md](remediation-1.md) — trimmed F17 ui.md state machine to in-component states; terminal states delegated to F18
