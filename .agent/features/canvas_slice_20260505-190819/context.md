# Context — Canvas SRS

Source: `.agent/srs/canvas.md`. IDs preserved verbatim from the SRS (`FR-CANVAS-*` / `NFR-CANVAS-*`) for traceability with module map (§11) and phasing plan (§13).

## Scope

- `delegate_canvas_create` tool — full pipeline, fresh canvas.
- `delegate_canvas_content_edit` tool — full pipeline against an existing canvas with diff merge.
- `delegate_canvas_layout_edit` tool — relayout-only path (skips extraction, reuses sidecar entity graph).
- `reveal_in_canvas` tool — open + focus + zoom standalone (no subgraph).
- Canvas FSM subgraph: `AWAITING_CONFIG → PREPARING → PLANNING → FETCHING → EXTRACTING → REDUCING → DIFFING → LAYING_OUT → PREVIEWING → WRITING → DONE | CANCELLED | ERROR`.
- Per-run inferred schema (entity types + relation types) — not persisted as a vault-facing artifact.
- Eager source-hint expansion (glob/tag/frontmatter resolved to fixed source list before extraction).
- Hand-rolled deterministic layout presets: `bipartite`, `tree`, `radial`, `force`, `grid`, `timeline`. No external layout libs.
- Sidecar persistence per canvas at `.leo/canvas/runs/<slug>.json` — last entity graph + coord map + tombstones + schema.
- Diff merge: detect user moves (drift > `MOVE_DRIFT_PX`), honor user deletions (tombstones), free-space placement of new entities.
- Live widget with provider/model/preset/path picker, refine clarification, per-phase progress, preview-and-approve gate (Approve / Edit / Cancel).
- Terminal snapshot for thread-reopen rehydration.
- Per-canvas-path mutex (concurrent runs against different canvases allowed).
- Insights (hubs, components, orphans, per-type counts) emitted in tool result and rendered in chat.
- Refine sub-agent with up to 3 clarifying questions.
- Slash commands: `/canvas-create`, `/canvas-edit`, `/canvas-status`.

## Out of scope

- Persisted reusable schemas (canvas analog of `wiki/SCHEMA.md`).
- LangGraph checkpoint persistence — live runs lost on plugin reload.
- Auto-update when source notes change.
- Image and PDF entity extraction (text sources only).
- External layout libraries (`dagre`, `elkjs`, `d3-force`).
- Multi-canvas synthesis (one canvas per run).
- Embedded canvas portals as first-class node types.
- `link` / `group` canvas node types — only `text` and `file` emitted in v1.
- User-configurable layout constants.
- Cross-vault canvas sharing.

## Actors

- **Vault user** — invokes `delegate_canvas_*` via main agent or `/canvas-*` slash command; approves/edits/cancels at PREVIEWING; manually moves nodes on disk between runs.
- **Main agent (Leo)** — selects tool, observes confirmation gate, surfaces insights and busy/denied results to user, renders inline live + terminal blocks.
- **Refine sub-agent** — parses `ask` into `RunPlan`; emits `ask_clarifying_question` or `emit_run_plan`; no vault tools.
- **Extractor sub-agent** — fans out per source; emits `ExtractorOutput` (entities + edges with tempIds).
- **Reducer sub-agent** — single pass deduping entities by canonical id; computes insights.
- **Obsidian platform** — `VaultAdapter`, `MetadataCache`, `WorkspaceLeaf`, internal canvas API (feature-detected at runtime).
- **LM provider** — main-assistant LLM (Qwen3 30B-class target) used by refine, extractor, reducer.

## Functional requirements

- **FR-CANVAS-01** — Register `delegate_canvas_create({ ask, targetPath?, layoutAlgo? })` with `requiresConfirmation: true`.
- **FR-CANVAS-02** — Register `delegate_canvas_content_edit({ path, instruction, layoutAlgo? })`. Loads sidecar, runs full pipeline with diff. Errors `sidecar_missing` if absent.
- **FR-CANVAS-03** — Register `delegate_canvas_layout_edit({ path, layoutAlgo, instruction? })`. Skips PLANNING/FETCHING/EXTRACTING/REDUCING/DIFFING; relayout only with locked-coord preservation.
- **FR-CANVAS-04** — Register `reveal_in_canvas({ path, nodeIds?, bbox? })`. Read-only, `requiresConfirmation: false`. Allowed in plan mode.
- **FR-CANVAS-05** — Delegate tools surface confirmation via `confirmationController` (Prepare canvas <op> / Deny). Deny → `{ ok: false, denied: true }`.
- **FR-CANVAS-06** — PREPARING: refine sub-agent emits `RunPlan = { entityTypes, relationTypes, sourceHints, layoutHint, scope?, outputPath }`. Allowed actions: `ask_clarifying_question` / `emit_run_plan`. No vault tools.
- **FR-CANVAS-07** — Refine emits up to 3 clarifying questions (`refineClarifyMax`). Exhausting → ERROR `refine_unresolved`.
- **FR-CANVAS-08** — `entityTypes[i] = { name, description, fields? }`; `relationTypes[i] = { name, from, to, description }`. Zod-validated; one retry with parser error injected.
- **FR-CANVAS-09** — `layoutHint ∈ { bipartite, tree, radial, force, grid, timeline, auto }`. Freeform names rejected.
- **FR-CANVAS-10** — `outputPath`: `targetPath` authoritative if set; else refine proposes `canvases/<slug>.canvas`. User-editable in AWAITING_CONFIG.
- **FR-CANVAS-11** — PLANNING: source hints expanded eagerly. `vaultGlob` → `VaultAdapter.list` minimatch; `vaultTag` → `metadataCache` lookup; `vaultFrontmatter` → vault scan + frontmatter filter; `url`/`attachment`/`mention`/`conversation` → 1:1.
- **FR-CANVAS-12** — Source list capped at `sourceFanoutMax = 200`. Excess dropped, count surfaced as warning. Deterministic order: by hint kind, then alpha within kind.
- **FR-CANVAS-13** — Source fetching reuses `fetchIngestSource` 1:1. Per-source failures recorded; run continues. Failed list in `partial.failedSources`.
- **FR-CANVAS-14** — All sources failed → ERROR `all_sources_failed`.
- **FR-CANVAS-15** — EXTRACTING: per-source extractors fan out, bounded by `extractorConcurrency = 1` (max 2). Inputs truncated to `extractorInputCap = 8000`. Zod-validated `ExtractorOutput`. Parse-fail: 1 retry with parser-error injection; 2nd fail marks source `extract_invalid`, run continues.
- **FR-CANVAS-16** — `ExtractorOutput` per source: `entities: EntityFragment[]`, `edges: EdgeFragment[]`. TempIds scoped to single call; mapped to canonical ids during REDUCING.
- **FR-CANVAS-17** — REDUCING: single pass dedupes by canonical id resolution: (a) wikilink-target, (b) URL, (c) normalized name (lowercased, whitespace-collapsed), (d) reducer-LLM alias for ambiguous overlaps. Output: Zod-validated `EntityGraph` with stable ids.
- **FR-CANVAS-18** — Reducer also computes `Insights`: `hubs` (top-5 by degree), `components` (count + sizes), `orphans` (degree 0, capped at 50), `perTypeCount`.
- **FR-CANVAS-19** — Reducer parse-fail: 1 retry with parser error; 2nd fail → ERROR `reduce_invalid`.
- **FR-CANVAS-20** — `delegate_canvas_content_edit` runs DIFFING between REDUCING and LAYING_OUT. Loads sidecar + current `.canvas` JSON.
- **FR-CANVAS-21** — Diff produces `kept` / `added` / `removed`. Removed → tombstones; new graph drops them before layout.
- **FR-CANVAS-22** — For each kept entity, compare current canvas coord vs sidecar last-rendered coord. Drift > `MOVE_DRIFT_PX = 16` → `locked: true`; coord preserved in LAYING_OUT.
- **FR-CANVAS-23** — Tombstones persisted into next sidecar's `tombstones`; excluded from future re-runs unless next instruction explicitly re-asks (refine handles).
- **FR-CANVAS-24** — Edges diffed by `(fromId, toId, type)` triple. Sidecar edges absent from current canvas → edge tombstones. New edges always re-emit.
- **FR-CANVAS-25** — Current canvas JSON unparseable → fail fast `canvas_parse_failed`.
- **FR-CANVAS-26** — Refine for content-edit receives tombstone summary. If refined plan re-asks for tombstoned entity (name match), tombstone cleared.
- **FR-CANVAS-27** — LAYING_OUT: pure `layout(graph, preset, lockedCoords) → CanvasJson`. No LLM. Deterministic. Locked nodes retain coord.
- **FR-CANVAS-28** — `bipartite`: two columns; two largest entity-type cardinalities anchor; remaining types fall to whichever side they connect to most. Vertical order: median heuristic for crossing minimization.
- **FR-CANVAS-29** — `tree`: top-down DAG via Reingold-Tilford. Hand-rolled. Cycle → fall back to `force`.
- **FR-CANVAS-30** — `radial`: top-degree centered; neighbors on concentric rings by hop distance. Polar angles uniform per ring.
- **FR-CANVAS-31** — `force`: Fruchterman-Reingold, fixed 200 iterations, no animation, no external dep.
- **FR-CANVAS-32** — `grid`: row-major, sorted by entity type then alpha name. `cols = ceil(sqrt(n))`.
- **FR-CANVAS-33** — `timeline`: left-to-right by `entity.fields.date | start | timestamp` (first non-null). Falls back to `grid` if no temporal field.
- **FR-CANVAS-34** — `auto` selection: `bipartite` if exactly 2 dominant entity types and 1 dominant relation type; `tree` if relation graph acyclic + connected; `radial` if a single entity has degree > 2× median; `timeline` if any entity has temporal field; `force` otherwise.
- **FR-CANVAS-35** — Node sizing: `width = clamp(round(text.length × 6), 160, 480)`; `height = clamp(round(lineCount × 24 + 48), 80, 320)`. Per-type override constants in `budgets.ts`.
- **FR-CANVAS-36** — Edge labels: emit relation `type` when graph has more than one distinct relation type; omit when monotype.
- **FR-CANVAS-37** — Free-space placement for `added` entities: bbox of locked nodes + row-major grid abutting right edge, growing downward. `freeSpacePadPx = 80`.
- **FR-CANVAS-38** — PREVIEWING: writer emits to temp `<targetPath>.preview.canvas` (atomic tmp + rename). Widget displays counts, preset, failed-source list, **Open preview** button calling `reveal_in_canvas`.
- **FR-CANVAS-39** — Widget actions during PREVIEWING: **Approve** / **Edit** (freeform → re-runs from PREPARING with instruction appended; `editIterationsMax = 3`) / **Cancel**.
- **FR-CANVAS-40** — Approve → WRITING. Edit → PREPARING with refine history + new instruction. Cancel → CANCELLED + preview deleted.
- **FR-CANVAS-41** — WRITING: rename `<targetPath>.preview.canvas` → `<targetPath>` (atomic). Then write sidecar `{ schemaVersion: 1, runId, schema, entityGraph, coordMap, tombstones, lastRunAt }`.
- **FR-CANVAS-42** — Sidecar slug: kebab leaf + 6-hex SHA-256 suffix. One sidecar per canvas. Re-runs overwrite.
- **FR-CANVAS-43** — `delegate_canvas_create` first WRITING — if `<targetPath>` already exists → ERROR `target_path_exists`. User told to use `delegate_canvas_content_edit`.
- **FR-CANVAS-44** — Tool result includes `insights: { hubs, components, orphans, perTypeCount }` (Zod). Main agent renders insights in chat-side summary with `reveal_in_canvas` links to hubs.
- **FR-CANVAS-45** — `CanvasTerminalBlock` widget renders insights inline beneath the canvas link.
- **FR-CANVAS-46** — At most one canvas run per canvas vault path. `CanvasMutex = Map<vaultPath, { runId, op }>` in process memory; released on terminal state. Different paths run in parallel.
- **FR-CANVAS-47** — Second `delegate_canvas_*` against active path → `{ ok: false, error: 'busy', activeRunId, activeOp }`. Widget not mounted. Main agent surfaces user-visible busy message.
- **FR-CANVAS-48** — Mutex release in outermost `try/finally` of subgraph driver — aborts/exceptions/timeouts all release.
- **FR-CANVAS-49** — `AbortSignal` threaded through `LLM.stream({ signal })` and tool calls. Cancel during PREPARING/PLANNING/FETCHING/EXTRACTING/REDUCING/DIFFING/LAYING_OUT/PREVIEWING → CANCELLED ≤ 2s wall-clock; in-flight outputs discarded.
- **FR-CANVAS-50** — Cancel during WRITING completes the in-flight rename + sidecar write before transitioning, so canvas isn't half-renamed. Preview deleted in cleanup if still present.
- **FR-CANVAS-51** — Cancel result: `{ ok: false, cancelled: true, phase, partial: { fetchedSources, extractedSources, previewPath? } }`.
- **FR-CANVAS-52** — Unhandled throws / extractor parse-retry exhaustion across all sources / reducer parse-retry exhaustion / layout errors → ERROR.
- **FR-CANVAS-53** — On ERROR: preview deleted in cleanup. Sidecar **not** written (last-success sidecar remains). Tool returns `{ ok: false, error: { code, message }, partial? }`.
- **FR-CANVAS-54** — Per-source extraction failures → partial-success (run not errored). Insights computed over successful extractions; failed list in tool result + terminal block.
- **FR-CANVAS-55** — `reveal_in_canvas` opens via `WorkspaceLeaf.openFile`. After leaf renders, casts view to internal canvas API and pan/zoom-to-bbox.
- **FR-CANVAS-56** — `nodeIds` → compute union bbox + `bboxPadding = 80` margin. `bbox` → use directly (still padded). Neither → default zoom centered.
- **FR-CANVAS-57** — Internal API surface wrapped in `src/editor/canvasNavigator.ts`. Feature-detected; on shape mismatch → fall back to plain `openFile` + `warning: 'reveal_unsupported_in_this_obsidian_version'`.
- **FR-CANVAS-58** — `reveal_in_canvas` allowed in plan mode. Result: `{ ok: true, path, viewportApplied, warning? }`.
- **FR-CANVAS-59** — Each canvas run mounts inline assistant block. `CanvasLiveBlock` looks up controller via `canvasLiveControllerRegistry` keyed by `runId`. Mirrors `WikiLiveBlock`.
- **FR-CANVAS-60** — Live widget surfaces per phase: provider/model/preset/path picker (AWAITING_CONFIG); refining transcript + clarification (PREPARING); per-source fetch progress (PLANNING/FETCHING); per-source extractor progress (EXTRACTING); reducer progress + insights peek (REDUCING); diff `kept/added/removed/locked` counts (DIFFING); layout name + progress (LAYING_OUT); preview link + Approve/Edit/Cancel (PREVIEWING); write progress (WRITING).
- **FR-CANVAS-61** — Terminal state → live block replaced by `CanvasTerminalBlock`: collapsed one-line summary, expand → insights + path + **Open canvas** button + error + failed-source list.
- **FR-CANVAS-62** — Plugin reload during non-terminal run: persisted terminal snapshot re-renders terminal block. Live runs at reload rehydrate to `error.code = 'reload'`.
- **FR-CANVAS-63** — Composer registers `/canvas-create`, `/canvas-edit`, `/canvas-status`. `/canvas-status` read-only, prints active runs (path + phase + runId), recent canvases with sidecars, last-run timestamps. `/canvas-create` and `/canvas-edit` invoke their tools with default args.

## Non-functional requirements

- **NFR-CANVAS-01** — Cancel ≤ 2s wall-clock from button press to terminal state. Adapters + tools respect `AbortSignal`.
- **NFR-CANVAS-02** — Subgraph state in-memory only. Plugin reload during non-terminal phase discards run; live block rehydrates to `error.code = 'reload'`. Last-success sidecar remains valid.
- **NFR-CANVAS-03** — Logging at `debug` for state transitions + per-source/per-entity events under `canvas.create.*`, `canvas.contentEdit.*`, `canvas.layoutEdit.*`, `canvas.reveal.*`. Errors at `error`. Source content + extractor outputs **not** logged above `debug`.
- **NFR-CANVAS-04** — Bundle: ≤ 60 KB minified added to `main.js`. No new top-level dep. SHA-256 via existing Web Crypto path.
- **NFR-CANVAS-05** — Subgraph IO nodes wrapped in `try/finally`. Mutex released in outermost `finally`. Preview deleted in CANCELLED + pre-WRITING ERROR cleanup.
- **NFR-CANVAS-06** — Subgraph unit-testable end-to-end with mock LLM (canned `AsyncIterable`) and fake `VaultAdapter` — no msw / real provider for FSM, layout, diff, writer tests.
- **NFR-CANVAS-07** — Extractor + reducer outputs Zod-validated. Schema violations → 1 retry with parser-error tool message; 2nd fail marks source/run errored without crashing runtime.
- **NFR-CANVAS-08** — `extractorConcurrency` enforced via shared `semaphore.ts` from wiki ingest; never ad-hoc `Promise.all`.
- **NFR-CANVAS-09** — Layout algorithms deterministic + pure (no IO, no clock). Verified by golden-file fixtures per preset.
- **NFR-CANVAS-10** — Token budgets in `src/agent/canvas/budgets.ts`: `extractorInputCap = 8000`, `extractorOutputCap = 1500`, `reducerInputCap = 6000`, `reducerOutputCap = 2500`, `refineInputCap = 4000`, `refineOutputCap = 1500`. Layout: `MOVE_DRIFT_PX = 16`, `freeSpacePadPx = 80`, `bboxPadding = 80`, `sourceFanoutMax = 200`. Tunable in code only.
- **NFR-CANVAS-11** — Sidecar JSON internal — no user contract. `schemaVersion` bump on changes. Mismatch → treat as missing (force `delegate_canvas_create` rerun on edit). Logged at `warn`.
- **NFR-CANVAS-12** — Any vault path allowed for canvas target. Writer validates via `VaultAdapter.normalizePath` + traversal guard; rejects `..` / absolute. Sidecar paths confined to `.leo/canvas/runs/`.

## Constraints

- **C-RUNTIME** — Obsidian Electron renderer (desktop-only). `minAppVersion` 1.5.0. Internal canvas API is undocumented + version-fragile (FR-CANVAS-57).
- **C-LLM-LOCAL** — Target Qwen3 30B-class local provider. Token caps must fit small-context regimes (NFR-CANVAS-10).
- **C-FRAMEWORK-FIRST** — Reuse `fetchIngestSource`, `semaphore.ts`, `confirmationController`, sidecar/mutex/widget patterns from wiki + external-agent (per CLAUDE.md best-practices).
- **C-NO-NEW-DEPS** — Bundle budget bars new top-level deps (NFR-CANVAS-04).
- **C-DESERIALIZE-SAFE** — Live runs lost on plugin reload by design (NFR-CANVAS-02). Terminal snapshots persist for rehydration.
- **C-MUTEX-PER-PATH** — Concurrency model is per-canvas-path, not per-thread (FR-CANVAS-46).

## Glossary

- **Canvas** — Obsidian `.canvas` JSON file at any vault path.
- **Entity graph** — Schema-agnostic typed-graph IR `{ entities, edges }` with stable canonical ids.
- **Schema** — Per-run `{ entityTypes, relationTypes }` produced by refine. Not persisted as user-facing artifact.
- **Source hint** — Discriminated union: `vaultGlob` / `vaultTag` / `vaultFrontmatter` / `mention` / `url` / `attachment` / `conversation`.
- **Sidecar** — Internal run memo at `.leo/canvas/runs/<slug>.json`. Stores last graph + coord map + tombstones + schema. Drives diff on re-run. Not user-facing.
- **Layout preset** — Pure deterministic algorithm: `bipartite` / `tree` / `radial` / `force` / `grid` / `timeline`.
- **Tombstone** — Entity present in sidecar but absent from current canvas JSON. Excluded from future re-runs unless re-asked.
- **User move** — Kept entity whose current coord differs from sidecar last-rendered coord by > `MOVE_DRIFT_PX`. Marks entity locked.
- **Diff merge** — DIFFING-phase logic: classify entities `kept` / `added` / `removed`, edges similarly, forward lock flags.
- **Canonical id** — Stable entity identifier: wikilink target, URL, or normalized name resolved via reducer aliases.
- **Run handle** — Runtime object: `runId`, abort signal, terminal promise. Mirrors wiki `RunHandle`.
- **Live widget** — Inline assistant block rendering current subgraph state, registered under canvas live-kind.
- **Terminal snapshot** — Persisted post-terminal payload for live block. Re-renders to collapsed summary on thread reopen.
- **Insights** — Computed analytics: top-N hubs, connected components, orphans, per-type counts.
- **Canvas mutex** — `Map<vaultPath, { runId, op }>` guarding concurrent runs against same canvas. Different canvases run in parallel.

## Open questions

1. Should `reveal_in_canvas` apply Obsidian canvas selection state (`selectNodeIds`) so users see the highlighted set framed, not just zoomed? Defer until users ask. (SRS §15.1)
2. Should the auto-preset selector (FR-CANVAS-34) call a small disambiguation LLM prompt for borderline graph shapes? Bench at Phase 6. (SRS §15.2)
3. Is `MOVE_DRIFT_PX = 16` too sensitive on touchpad scrolls / mid-resize layout shifts? Tune empirically. (SRS §15.3)
4. Should reducer canonical-id resolution skip the LLM-alias step for graphs under N entities for latency? Measure on Qwen 30B. (SRS §15.4)
5. Should `layout_edit` support "lock all current positions and only relayout new entities" sub-mode? Defer until requested. (SRS §15.5)
6. Should `canvas-create` accept a `seedFromCanvas` option to clone an existing canvas's schema and entity graph as starting point? Possibly Phase 5. (SRS §15.6)
