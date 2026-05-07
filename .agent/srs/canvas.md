# Leo — Canvas (SRS)

Companion to `srs.md`, `architecture.md`, `external-agent.md`, and `leo-wiki.md`. Specifies the Canvas feature: a generic visualizer that extracts entities + relations from any user-specified sources (vault notes, URLs, attachments, conversation, glob/tag/frontmatter filters), lays them out via deterministic preset algorithms, and writes Obsidian `.canvas` JSON files. Re-runs diff against the last run to preserve user-authored layout changes.

This SRS is the contract. Every requirement (`FR-CANVAS-*` / `NFR-CANVAS-*`) maps to at least one module in §11.

---

## 1. Purpose & Scope

### 1.1 Purpose

Give Leo a structured-visualization output channel orthogonal to wiki and chat. The user describes what they want to see ("show events and people who attended, highlight cross-attendees"); Leo extracts the entity graph from sources they point at, lays it out deterministically, writes a `.canvas` file, and emits insights. Re-runs preserve manual layout edits and respect manual deletions.

The feature targets local small LLMs (Qwen3 30B-class). The pipeline reuses the wiki extractor/reducer pattern parameterized over a per-request inferred schema.

### 1.2 In Scope (v1)

- `delegate_canvas_create` tool — full pipeline, fresh canvas.
- `delegate_canvas_content_edit` tool — full pipeline against an existing canvas with diff merge.
- `delegate_canvas_layout_edit` tool — relayout-only path (skips extraction, reuses sidecar entity graph).
- `reveal_in_canvas` tool — open + focus + zoom standalone (no subgraph).
- Canvas subgraph: `AWAITING_CONFIG → PREPARING → PLANNING → FETCHING → EXTRACTING → REDUCING → DIFFING → LAYING_OUT → PREVIEWING → WRITING → DONE | CANCELLED | ERROR`.
- Per-run inferred schema (entity types + relation types). Not persisted as a vault-facing artifact.
- Eager source-hint expansion (glob/tag/frontmatter resolved to a fixed source list before extraction).
- Hand-rolled deterministic layout presets: `bipartite`, `tree`, `radial`, `force`, `grid`, `timeline`. No external layout libs.
- Sidecar persistence per canvas at `.leo/canvas/runs/<slug>.json` — last entity graph + coord map + tombstones + schema. Internal only.
- Diff merge: detect user moves (coord drift > threshold ⇒ lock), honor user deletions (missing-from-canvas ⇒ tombstone), free-space placement for new entities.
- Live widget with provider/model/preset/path picker, refine clarification, per-phase progress, preview-and-approve gate (Approve / Edit / Cancel).
- Terminal snapshot for thread-reopen rehydration.
- Per-canvas-path mutex (concurrent runs against different canvases allowed).
- Insights (hubs, components, orphans, per-type counts) emitted in tool result and rendered in chat.
- Refine sub-agent with up to 3 clarifying questions.

### 1.3 Out of Scope (v1)

- Persisted reusable schemas (canvas analog of `wiki/SCHEMA.md`).
- LangGraph checkpoint persistence — live runs lost on plugin reload.
- Auto-update when source notes change (snapshot-only; manual re-trigger).
- Image and PDF entity extraction (text sources only).
- External layout libraries (`dagre`, `elkjs`, `d3-force`).
- Multi-canvas synthesis (one canvas per run).
- Embedded canvas portals as first-class node types.
- `link` / `group` canvas node types — only `text` and `file` emitted in v1.
- User-configurable layout constants (gaps, padding, drift threshold).
- Cross-vault canvas sharing.

---

## 2. Glossary

| Term                  | Meaning                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canvas**            | An Obsidian `.canvas` JSON file at any vault path.                                                                                                                               |
| **Entity graph**      | Schema-agnostic typed-graph IR `{ entities, edges }` with stable canonical ids.                                                                                                  |
| **Schema**            | Per-run object `{ entityTypes, relationTypes }` produced by refine. Not persisted as a user-facing artifact.                                                                     |
| **Source hint**       | Discriminated union — `vaultGlob`, `vaultTag`, `vaultFrontmatter`, `mention`, `url`, `attachment`, `conversation`.                                                               |
| **Sidecar**           | Internal run memo at `.leo/canvas/runs/<slug>.json`. Stores last entity graph, coord map, tombstones, schema. Drives diff on re-run. Not user-facing.                            |
| **Layout preset**     | Pure deterministic algorithm — `bipartite`, `tree`, `radial`, `force`, `grid`, `timeline`.                                                                                       |
| **Tombstone**         | An entity present in the last run's sidecar but absent from the current canvas JSON. Excluded from future re-runs unless the next instruction explicitly re-asks for it.         |
| **User move**         | A `kept` entity whose current canvas coord differs from its sidecar last-rendered coord by more than `MOVE_DRIFT_PX`. Marks the entity locked.                                   |
| **Diff merge**        | DIFFING-phase logic that classifies entities as `kept` / `added` / `removed` and edges similarly, then forwards lock flags to layout.                                            |
| **Canonical id**      | Stable entity identifier: wikilink target path, URL, or normalized name resolved via reducer aliases.                                                                            |
| **Run handle**        | Runtime object with `runId`, abort signal, terminal promise. Mirrors wiki `RunHandle`.                                                                                           |
| **Live widget**       | Inline assistant block rendering current subgraph state, registered under the canvas live-kind.                                                                                  |
| **Terminal snapshot** | Persisted post-terminal payload for the live block. Re-renders into a collapsed summary on thread reopen.                                                                        |
| **Insights**          | Computed analytics — top-N hubs, connected components, orphans, per-type counts. Returned in tool result body.                                                                   |
| **Canvas mutex**      | `Map<vaultPath, { runId, op }>` guarding concurrent runs against the same canvas file. Different canvases run in parallel.                                                       |

---

## 3. Functional Requirements

### 3.1 Tool Registration & Confirmation

| ID                | Requirement                                                                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-CANVAS-01**  | `delegate_canvas_create(input)` is registered in `ToolRegistry` at plugin load. `input = { ask: string, targetPath?: string, layoutAlgo?: PresetId }`. `requiresConfirmation: true`.                                                                                                                                       |
| **FR-CANVAS-02**  | `delegate_canvas_content_edit(input)` is registered. `input = { path: string, instruction: string, layoutAlgo?: PresetId }`. `requiresConfirmation: true`. Loads the sidecar at `.leo/canvas/runs/<slug>.json` and runs the full pipeline with diff merge. Errors with `error.code = 'sidecar_missing'` if no sidecar.    |
| **FR-CANVAS-03**  | `delegate_canvas_layout_edit(input)` is registered. `input = { path: string, layoutAlgo: PresetId, instruction?: string }`. `requiresConfirmation: true`. Loads sidecar entity graph; skips PLANNING/FETCHING/EXTRACTING/REDUCING/DIFFING; re-runs layout only with locked-coord preservation. Errors if sidecar missing. |
| **FR-CANVAS-04**  | `reveal_in_canvas(input)` is registered. `input = { path: string, nodeIds?: string[], bbox?: { x: number; y: number; w: number; h: number } }`. Read-only, `requiresConfirmation: false`. Allowed in plan mode.                                                                                                           |
| **FR-CANVAS-05**  | All three delegate tools surface their confirmation via the existing `confirmationController` with actions **Prepare canvas \<op\>** and **Deny**. Deny → tool returns `{ ok: false, denied: true }`. The main agent receives this as a tool result and continues normally.                                              |

### 3.2 Refine & Schema Inference

| ID               | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-CANVAS-06** | Phase **PREPARING**: a refine sub-agent (mirrors `src/agent/wiki/ingest/refine.ts` / `src/agent/externalAgent/refineSubAgent.ts`) parses `ask` and proposes `RunPlan = { entityTypes, relationTypes, sourceHints, layoutHint, scope?, outputPath }`. Allowed actions: `ask_clarifying_question`, `emit_run_plan`. Refine sub-agent has no vault tools.                                                                                  |
| **FR-CANVAS-07** | Refine emits up to **3** clarifying questions before commit. Cap is `refineClarifyMax` in `budgets.ts`. Each question is surfaced via the live widget; the user's answer appends to refine history and refine re-runs. Exhausting the cap without an `emit_run_plan` transitions to `ERROR` with `error.code = 'refine_unresolved'`.                                                                                                  |
| **FR-CANVAS-08** | `entityTypes[i] = { name, description, fields? }`. Fields are advisory hints for the extractor, not strict schema. `relationTypes[i] = { name, from: <entityType.name>, to: <entityType.name>, description }`. The full `RunPlan` is Zod-validated; refine retries once on validation failure with parser error injected.                                                                                                              |
| **FR-CANVAS-09** | `layoutHint ∈ { bipartite, tree, radial, force, grid, timeline, auto }`. Refine MUST emit one of these literals; freeform layout names are rejected. If `auto`, the layout-selection step (FR-CANVAS-34) chooses deterministically from graph shape.                                                                                                                                                                                  |
| **FR-CANVAS-10** | `outputPath` resolution: if `delegate_canvas_create.input.targetPath` is set, refine treats it as authoritative. Else refine proposes a kebab-case path under `canvases/<slug>.canvas` derived from `ask`. The user can edit `outputPath` in the widget AWAITING_CONFIG phase before approval.                                                                                                                                       |

### 3.3 Source Discovery (Eager Expansion)

| ID               | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-CANVAS-11** | Phase **PLANNING**: source hints are expanded to a concrete source list **before** extraction. `vaultGlob` → minimatch enumeration via `VaultAdapter.list`. `vaultTag` → `metadataCache` tag lookup. `vaultFrontmatter` → vault scan with `metadataCache.getFileCache(file).frontmatter` filter. `url`, `attachment`, `mention`, `conversation` → 1:1 source.                                                                                                       |
| **FR-CANVAS-12** | Source list is capped at `sourceFanoutMax = 200` (constant in `budgets.ts`). Excess sources are dropped; the dropped count is surfaced as `warning` in the widget and tool result. Order is deterministic — sorted by hint kind then alpha-sorted within kind.                                                                                                                                                                                                       |
| **FR-CANVAS-13** | Source fetching reuses `fetchIngestSource` from `src/agent/wiki/ingest/fetchSource.ts` 1:1. Per-source failures (fetch errors) are recorded with error code; the run continues (partial success). Failed source list is included in the tool result `partial.failedSources`.                                                                                                                                                                                       |
| **FR-CANVAS-14** | If all sources fail, the run transitions to `ERROR` with `error.code = 'all_sources_failed'`.                                                                                                                                                                                                                                                                                                                                                                          |

### 3.4 Extraction & Reduction

| ID               | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **FR-CANVAS-15** | Phase **EXTRACTING**: extractor subagents fan out per source, bounded by `extractorConcurrency = 1` (default; max 2). Inputs: source body (truncated to `extractorInputCap = 8000` tokens), the inferred `entityTypes + relationTypes`, and a brief role-of-extractor system prompt. Output: `ExtractorOutput` (Zod-validated, §8.1). On parse failure: one retry with the parser error injected; second failure marks the source `error: extract_invalid` and the run continues (partial).                                                                                                                                                                              |
| **FR-CANVAS-16** | `ExtractorOutput` per source emits `entities: EntityFragment[]` and `edges: EdgeFragment[]`. Tempids are scoped to a single extractor call and are mapped to canonical ids during REDUCING.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **FR-CANVAS-17** | Phase **REDUCING**: a single reducer pass dedupes entities across sources by canonical id resolution: (a) wikilink-target match, (b) URL match, (c) normalized-name match (lowercased, whitespace-collapsed), (d) reducer-LLM-resolved alias match for ambiguous overlaps. Output: `EntityGraph` (Zod-validated, §8.2) with stable `id`s.                                                                                                                                                                                                                                                                                                                                |
| **FR-CANVAS-18** | The reducer also computes the `Insights` block (§8.3): `hubs` (top-5 entities by degree), `components` (count + size distribution), `orphans` (degree 0 entities, capped at 50), `perTypeCount` (entity-type frequency table).                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **FR-CANVAS-19** | On reducer parse failure: one retry with parser error injected. Second failure transitions the run to `ERROR` with `error.code = 'reduce_invalid'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### 3.5 Diff Merge (Edit Path)

| ID               | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-CANVAS-20** | `delegate_canvas_content_edit` runs phase **DIFFING** between REDUCING and LAYING_OUT. Loads the sidecar at `.leo/canvas/runs/<slug>.json` and the **current** `.canvas` JSON from disk.                                                                                                                                                                                                                                                            |
| **FR-CANVAS-21** | Diff produces three sets: `kept` (entities matched by canonical id in both new graph and sidecar), `added` (entities only in new graph), `removed` (entities in sidecar absent from current canvas JSON). `removed` entities become tombstones; the new graph drops them before layout.                                                                                                                                                              |
| **FR-CANVAS-22** | For each `kept` entity, compare its current canvas-JSON coord vs the sidecar's last-rendered coord. If `|Δx|` or `|Δy|` exceeds `MOVE_DRIFT_PX = 16`, mark the entity `locked: true` — its coord is preserved verbatim during LAYING_OUT.                                                                                                                                                                                                          |
| **FR-CANVAS-23** | Tombstones are persisted into the next sidecar's `tombstones` array and excluded from future re-runs unless the user's next instruction explicitly mentions one (refine handles this — see FR-CANVAS-26).                                                                                                                                                                                                                                            |
| **FR-CANVAS-24** | Edges are diffed by the `(fromId, toId, type)` triple. Edges in the sidecar absent from the current canvas JSON become edge tombstones. New edges always re-emit.                                                                                                                                                                                                                                                                                    |
| **FR-CANVAS-25** | If the current canvas JSON cannot be parsed (corrupt/missing), `delegate_canvas_content_edit` fails fast with `error.code = 'canvas_parse_failed'`. The user must rerun via `delegate_canvas_create` (which overwrites if `targetPath` matches and the existing-path guard, FR-CANVAS-43, is bypassed via explicit instruction).                                                                                                                       |
| **FR-CANVAS-26** | Refine for content-edit receives a tombstone summary in its system context: "user previously removed entities X, Y, Z — do not re-emit unless instruction explicitly requests." If the refined `RunPlan` re-asks for a tombstoned entity (heuristic: name match), the tombstone for that entity is cleared.                                                                                                                                       |

### 3.6 Layout (Pure, Deterministic)

| ID               | Requirement                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **FR-CANVAS-27** | Phase **LAYING_OUT**: pure function `layout(graph, preset, lockedCoords) → CanvasJson`. No LLM. Deterministic given inputs. Locked nodes retain their input coord; non-locked nodes are positioned per preset.                                                                                                                                                                                              |
| **FR-CANVAS-28** | Preset `bipartite`: two columns. Two largest entity-type cardinalities anchor the columns; remaining types fall to whichever column they connect to most. Vertical order minimizes edge crossings (median heuristic).                                                                                                                                                                                       |
| **FR-CANVAS-29** | Preset `tree`: top-down DAG layout via Reingold-Tilford. Hand-rolled. Falls back to `force` if the relation graph contains a cycle.                                                                                                                                                                                                                                                                          |
| **FR-CANVAS-30** | Preset `radial`: top-degree entity centered; neighbors placed on concentric rings by hop distance, with node *centers* on the circle (not top-left). Polar slots distributed uniformly per ring (slot order: degree-then-id). Per-ring radius is adaptive — `max(ringDist × baseRadius, (sqrt(w² + h²) + ringGap) / (2·sin(π / n)), prevRadius + prevOuterExtent + ringGap + maxNodeRadius)` where `n` is ring node count and `w/h` are the largest width/height on that ring. The diagonal term is the sufficient bound for AABB non-overlap regardless of angular orientation. Constants `baseRadius`, `ringGap`, `orphanGap` in `budgets.ts:CANVAS_RADIAL`. Hub text nodes (radial centre, no `filePath`) are floored to `hubTextWidthMin × hubTextHeightMin` so they remain a visible anchor when surrounded by larger file embeds. |
| **FR-CANVAS-31** | Preset `force`: simple Fruchterman-Reingold force-directed layout, fixed iteration count = 200, no animation, no external dep.                                                                                                                                                                                                                                                                               |
| **FR-CANVAS-32** | Preset `grid`: row-major. Sort by entity type then alphabetical name. Square-ish aspect ratio (`cols = ceil(sqrt(n))`).                                                                                                                                                                                                                                                                                      |
| **FR-CANVAS-33** | Preset `timeline`: left-to-right by `entity.fields.date | start | timestamp` (first non-null). Falls back to `grid` if no temporal field is present on any entity.                                                                                                                                                                                                                                            |
| **FR-CANVAS-34** | If `layoutHint = auto`: choose preset deterministically — `bipartite` if exactly 2 dominant entity types and 1 dominant relation type; `tree` if relation graph is acyclic and connected; `radial` if a single entity has degree > 2× median; `timeline` if any entity has a temporal field; `force` otherwise.                                                                                              |
| **FR-CANVAS-35** | Node sizing: auto from content length, kind-aware. **`text` nodes**: `width = clamp(round(text.length × 6), 160, 480)`, `height = clamp(round(lineCount × 24 + 48), 80, 320)`. **`file` nodes** (entity has `filePath`): same formula but with floors `width = clamp(_, 320, 560)`, `height = clamp(_, 480, 640)` so embedded markdown renders readably in Obsidian. Per-entity-type override constants permitted in `budgets.ts`, undocumented in v1 settings. |
| **FR-CANVAS-35a** | Node and edge colors: assigned deterministically by **type rank-by-frequency** within a chosen palette preset. Count entity types across `entities`; sort descending by count, ties broken alphabetically; assign the palette entry at `rank % CANVAS_PALETTE_SIZE`. Same algorithm for edges keyed on relation type. Palette presets are hex strings (`#xxxxxx`) — Obsidian Canvas accepts arbitrary hex colors in the `color` field. Registry in `src/agent/canvas/layouts/colorPalette.ts:CANVAS_PALETTE_LIST`; default `coolVivid` (`DEFAULT_CANVAS_PALETTE_ID`). |
| **FR-CANVAS-35b** | Edge sides (`fromSide` / `toSide`) are auto-routed deterministically per edge from final node centres. If `|Δx| ≥ |Δy|`, route horizontally (`right`↔`left`); else vertically (`bottom`↔`top`). Reduces edge-label clumping when many edges fan out from the same node. |
| **FR-CANVAS-35c** | The AWAITING_CONFIG widget exposes a palette picker (drop-down + 6-swatch live preview) alongside provider/model/preset/path. The picked id flows through `CanvasConfigOverride.paletteId` → `StartCanvasInput.paletteId` → `CanvasState.paletteId` → `LayoutInput.paletteId`. Six presets ship: `coolVivid` (default), `forestSteel`, `pastelPlate`, `rainbow`, `monoOcean`, `sunset`. Unknown values fall back to default via `resolvePaletteId`. The chosen id is persisted on the terminal snapshot (`CanvasTerminalSnapshot.paletteId`, optional/back-compat) and rendered in the expanded terminal block. |
| **FR-CANVAS-36** | Edge labels: emitted as the relation `type` string when the graph has more than one distinct relation type; omitted when monotype.                                                                                                                                                                                                                                                                            |
| **FR-CANVAS-37** | Free-space placement for `added` entities (DIFFING-then-LAYING_OUT path): compute the bounding box of locked nodes; place new entities in a row-major grid abutting the right edge of that bbox, growing downward. Padding `freeSpacePadPx = 80`.                                                                                                                                                            |

### 3.7 Preview & Approval

| ID               | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-CANVAS-38** | Phase **PREVIEWING**: writer emits the layout to a temp path `<targetPath>.preview.canvas` via `VaultAdapter` (atomic tmp-and-rename). The widget displays node + edge counts, the chosen preset, the failed-source list (if any), and an **Open preview** button that calls `reveal_in_canvas({ path: <preview> })`.                                                                                                                |
| **FR-CANVAS-39** | Widget actions during PREVIEWING: **Approve**, **Edit** (freeform text input → re-runs from PREPARING with the instruction appended; capped at `editIterationsMax = 3` per run), **Cancel**.                                                                                                                                                                                                                                          |
| **FR-CANVAS-40** | On Approve → phase WRITING. On Edit → phase PREPARING (with refine history + new instruction). On Cancel → phase CANCELLED; preview file is deleted in cleanup.                                                                                                                                                                                                                                                                          |

### 3.8 Writing

| ID               | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **FR-CANVAS-41** | Phase **WRITING**: rename `<targetPath>.preview.canvas` → `<targetPath>` via `VaultAdapter`. Atomic. Then write the sidecar at `.leo/canvas/runs/<slug>.json` with `{ schemaVersion: 1, runId, schema, entityGraph, coordMap, tombstones, lastRunAt }`.                                                                                                                                                                                                                                                                                                              |
| **FR-CANVAS-42** | Sidecar slug derives from the canonical canvas vault path: kebab-cased leaf with a 6-hex SHA-256 suffix to disambiguate paths sharing a leaf name. One sidecar per canvas. Re-runs overwrite.                                                                                                                                                                                                                                                                                                                                                                              |
| **FR-CANVAS-43** | If `<targetPath>` already exists at first WRITING (the `delegate_canvas_create` case where the path collides with an existing canvas), the run errors with `error.code = 'target_path_exists'`. The user is told to use `delegate_canvas_content_edit` instead.                                                                                                                                                                                                                                                                                                            |

### 3.9 Insights Output

| ID               | Requirement                                                                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-CANVAS-44** | The terminal tool result includes `insights: { hubs, components, orphans, perTypeCount }` (Zod-validated, §8.3). The main agent renders the insights as a chat-side summary in its post-tool response (markdown bullet list with `reveal_in_canvas` links to hubs). |
| **FR-CANVAS-45** | The `CanvasTerminalBlock` widget renders the same insights inline beneath the canvas-link.                                                                                                                                                                            |

### 3.10 Mutex (Per-Canvas-Path)

| ID               | Requirement                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **FR-CANVAS-46** | At most one canvas run may be active per canvas vault path. `CanvasMutex` is `Map<vaultPath, { runId, op }>` held in plugin process memory; released on terminal state. Different canvas paths run in parallel.                                                                                                                            |
| **FR-CANVAS-47** | A second `delegate_canvas_*` invocation against an already-active path returns immediately with `{ ok: false, error: 'busy', activeRunId, activeOp: 'create' \| 'content_edit' \| 'layout_edit' }`. The widget is not mounted. The main agent surfaces a user-visible message ("Canvas X is busy with run Y — try again when it finishes."). |
| **FR-CANVAS-48** | Mutex release is in the outermost `try/finally` of the subgraph driver. Aborts, exceptions, and timeouts all release.                                                                                                                                                                                                                       |

### 3.11 Cancellation

| ID               | Requirement                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-CANVAS-49** | The subgraph accepts an `AbortSignal` threaded through `LLM.stream({ signal })` and tool calls. Cancel during PREPARING / PLANNING / FETCHING / EXTRACTING / REDUCING / DIFFING / LAYING_OUT / PREVIEWING transitions to `CANCELLED` within ≤ 2s wall-clock and discards in-flight outputs.                                       |
| **FR-CANVAS-50** | Cancel during WRITING completes the in-flight rename and sidecar write before transitioning to `CANCELLED`, so the canvas isn't left half-renamed. Preview file deleted in cleanup if it still exists.                                                                                                                            |
| **FR-CANVAS-51** | On cancel, tool returns `{ ok: false, cancelled: true, phase: <last-phase>, partial: { fetchedSources, extractedSources, previewPath? } }`.                                                                                                                                                                                       |

### 3.12 Error Handling

| ID               | Requirement                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-CANVAS-52** | Unhandled throws, extractor parse-retry exhaustion across all sources, reducer parse-retry exhaustion, or layout-algorithm errors transition the run to `ERROR`.                                                                          |
| **FR-CANVAS-53** | On `ERROR`, the preview file (if any) is deleted in cleanup. The sidecar is **not** written (last successful run's sidecar remains authoritative). Tool returns `{ ok: false, error: { code, message }, partial }`.                       |
| **FR-CANVAS-54** | Per-source extraction failures do not error the run (partial-success). Insights are computed over successful extractions only; the failed-source list is included in the tool result and the widget terminal block.                       |

### 3.13 Reveal Tool

| ID               | Requirement                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-CANVAS-55** | `reveal_in_canvas` opens the canvas file via `WorkspaceLeaf.openFile`. Once the leaf has rendered the canvas view, the tool casts the view to the Obsidian internal canvas API and calls the pan/zoom-to-bbox equivalent.                                                                                                                                                                            |
| **FR-CANVAS-56** | If `nodeIds` is provided, the tool computes the union bbox of those nodes from the parsed canvas JSON, applies `bboxPadding = 80` margin, and zooms to fit. If `bbox` is provided, that bbox is used (still padded). If neither, the canvas opens at default zoom centered on the graph.                                                                                                              |
| **FR-CANVAS-57** | The Obsidian internal canvas API surface is wrapped in a thin adapter at `src/editor/canvasNavigator.ts`. The adapter is feature-detected at runtime; on API-shape mismatch with the current Obsidian build, the tool falls back to plain `WorkspaceLeaf.openFile` and surfaces `warning: 'reveal_unsupported_in_this_obsidian_version'` in its result.                                                |
| **FR-CANVAS-58** | `reveal_in_canvas` is allowed in plan mode (read-only). Its tool result returns `{ ok: true, path, viewportApplied: boolean, warning?: string }`.                                                                                                                                                                                                                                                     |

### 3.14 Widget Lifecycle

| ID               | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-CANVAS-59** | Each canvas run mounts an inline assistant message block. `CanvasLiveBlock` looks up the live controller via `canvasLiveControllerRegistry` keyed by `runId`. Mirrors `WikiLiveBlock`.                                                                                                                                                                                                                                                                                                                                       |
| **FR-CANVAS-60** | Live widget surfaces, by phase: provider/model/preset/path picker (AWAITING_CONFIG); refining transcript + clarification input (PREPARING); per-source fetch progress (PLANNING/FETCHING); per-source extractor progress (EXTRACTING); reducer progress + insights peek (REDUCING); diff summary `kept/added/removed/locked` counts (DIFFING); layout-algorithm-name + progress (LAYING_OUT); preview link + Approve/Edit/Cancel (PREVIEWING); write progress (WRITING).                                                       |
| **FR-CANVAS-61** | After a terminal state, the live block is replaced by `CanvasTerminalBlock` (mirrors `WikiTerminalBlock`): collapsed one-line summary expandable to show insights, file path, **Open canvas** button (calls `reveal_in_canvas`), error message if any, and the failed-source list if any.                                                                                                                                                                                                                                  |
| **FR-CANVAS-62** | Plugin reload during a non-terminal run: the persisted terminal snapshot, if any, re-renders the terminal block. Live blocks active at reload rehydrate to `error.code = 'reload'` (mirrors NFR-EXT-04).                                                                                                                                                                                                                                                                                                                       |

### 3.15 Slash Commands

| ID               | Requirement                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-CANVAS-63** | The composer registers three slash commands: `/canvas-create`, `/canvas-edit`, `/canvas-status`. `/canvas-status` is read-only and prints active canvas runs (path + phase + runId), recent canvas paths with sidecars, and last-run timestamps. `/canvas-create` and `/canvas-edit` invoke their corresponding tools with default args. |

---

## 4. Non-Functional Requirements

| ID                | Requirement                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NFR-CANVAS-01** | Cancel surfaces within ≤ 2s wall-clock from button press to subgraph terminal state. Adapters and tools must respect the `AbortSignal`.                                                                                                                                                                                                                                    |
| **NFR-CANVAS-02** | Subgraph state is in-memory only. A plugin reload during a non-terminal phase discards the run; the live block rehydrates to `error.code = 'reload'`. Sidecar from the last successful run remains valid.                                                                                                                                                                  |
| **NFR-CANVAS-03** | Logging: every state transition + per-source/per-entity event logged at `debug` under namespaces `canvas.create.*`, `canvas.contentEdit.*`, `canvas.layoutEdit.*`, `canvas.reveal.*`. Errors at `error`. Source content and extractor outputs are **not** logged above `debug`.                                                                                            |
| **NFR-CANVAS-04** | Bundle: canvas feature (subgraph + tools + widgets + layouts + writer + sidecar + mutex + canvasNavigator) adds ≤ 60 KB minified to `main.js`. No new top-level dependency. SHA-256 uses the existing Web Crypto path.                                                                                                                                                     |
| **NFR-CANVAS-05** | All subgraph nodes that touch IO are wrapped in `try/finally`. The canvas mutex is released in the outermost `finally`. Preview file is deleted in `CANCELLED` and pre-WRITING `ERROR` cleanup paths.                                                                                                                                                                       |
| **NFR-CANVAS-06** | The subgraph is unit-testable end-to-end with a mock LLM (canned `AsyncIterable` of responses) and a fake `VaultAdapter` — no msw or real provider required for state-machine, layout, diff, or writer tests.                                                                                                                                                              |
| **NFR-CANVAS-07** | Extractor and reducer LLM outputs are Zod-validated. Schema violations surface as one retry with the parser error injected as a tool message; second failure marks the source/run errored without crashing the runtime.                                                                                                                                                    |
| **NFR-CANVAS-08** | Concurrency caps (`extractorConcurrency`) are enforced via the shared `semaphore.ts` from wiki ingest; never via ad-hoc `Promise.all` chains.                                                                                                                                                                                                                              |
| **NFR-CANVAS-09** | All layout algorithms are deterministic (same input → same output) and pure (no IO, no clock). Verified by golden-file fixtures per preset.                                                                                                                                                                                                                                |
| **NFR-CANVAS-10** | Token budgets per LLM call are explicit constants in `src/agent/canvas/budgets.ts`: `extractorInputCap = 8000`, `extractorOutputCap = 1500`, `reducerInputCap = 6000`, `reducerOutputCap = 2500`, `refineInputCap = 4000`, `refineOutputCap = 1500`. Layout constants: `MOVE_DRIFT_PX = 16`, `freeSpacePadPx = 80`, `bboxPadding = 80`, `sourceFanoutMax = 200`. Tunable in code. |
| **NFR-CANVAS-11** | Sidecar JSON is internal — no contract with users. Schema bumped via `schemaVersion`. Mismatched version on load → treat as missing sidecar (force `delegate_canvas_create` rerun on edit attempts). Logged at `warn`.                                                                                                                                                       |
| **NFR-CANVAS-12** | Any vault path is allowed for the canvas target. The writer validates the path is within the vault (via `VaultAdapter.normalizePath` + traversal guard) and rejects `..`/absolute paths. Sidecar paths are confined to `.leo/canvas/runs/`.                                                                                                                                  |

---

## 5. State Machine

```
delegate_canvas_create        ─┐
delegate_canvas_content_edit  ─┼─►(confirm)──Prepare──► AWAITING_CONFIG
delegate_canvas_layout_edit   ─┘                              │
                                                              ▼
                                                        PREPARING ◄──────────────┐
                                                              │                    │
                                                              │ optional clarify(s)│
                                                              ▼  via interrupt()   │
                                                          PLANNING                  │
                                                              │                    │
                                                              ▼                    │
                                                          FETCHING                  │
                                                              │                    │
                                                              ▼                    │
                                                         EXTRACTING                 │
                                                              │                    │
                                                              ▼                    │
                                                          REDUCING                  │
                                                              │                    │  Edit
                                       (content_edit only)    ▼                    │  (loop ≤ editIterationsMax)
                                       ┌──────────────► DIFFING                    │
                                       │                      │                    │
                                       │ (create | layout_edit)                    │
                                       │                      ▼                    │
                                       └─────────────► LAYING_OUT                  │
                                                              │                    │
                                                              ▼                    │
                                                        PREVIEWING ────────────────┘
                                                              │
                                                              │ Approve
                                                              ▼
                                                          WRITING ◄──── error/throw
                                                              │            │
                                                              ▼            ▼
                                                            DONE        ERROR

                                Cancel from any non-terminal state ─► CANCELLED
```

`delegate_canvas_layout_edit` is a degenerate path: AWAITING_CONFIG → PREPARING (no schema inference; preset chosen in config) → LAYING_OUT (loads sidecar entity graph and coord map) → PREVIEWING → WRITING.

Terminal states: `DONE`, `CANCELLED`, `ERROR`. The originating tool resumes with its result on entry to a terminal state.

---

## 6. Subgraph State Shape

```ts
// src/agent/canvas/state.ts
import type { BaseMessage } from '@langchain/core/messages';

export type CanvasOp = 'create' | 'content_edit' | 'layout_edit';

export type CanvasPhase =
  | 'awaiting_config'
  | 'preparing'
  | 'planning'
  | 'fetching'
  | 'extracting'
  | 'reducing'
  | 'diffing'
  | 'laying_out'
  | 'previewing'
  | 'writing'
  | 'done'
  | 'cancelled'
  | 'error';

export type PresetId =
  | 'bipartite'
  | 'tree'
  | 'radial'
  | 'force'
  | 'grid'
  | 'timeline'
  | 'auto';

export interface CanvasState {
  runId: string;
  threadId: string;
  op: CanvasOp;
  phase: CanvasPhase;

  config: {
    provider: string;
    model: string;
    targetPath: string;
    layoutAlgo: PresetId;
  };

  ask: string;
  refineHistory: readonly BaseMessage[];
  refineIterations: number;
  refineBudget: number;

  plan: RunPlan | null;
  sources: readonly CanvasSourceItem[];

  extractorOutputs: ReadonlyMap<string /* sourceRef */, ExtractorOutput>;
  reducedGraph: EntityGraph | null;
  insights: Insights | null;

  sidecar: SidecarV1 | null;       // loaded for edits, written on success
  diffResult: DiffResult | null;   // populated only for content_edit

  layout: CanvasJson | null;       // post LAYING_OUT
  previewPath: string | null;

  editIterations: number;          // capped by editIterationsMax = 3

  startedAt: number;
  endedAt: number | null;
  error: { code: string; message: string } | null;
}

export interface CanvasSourceItem {
  readonly hint: SourceHint;
  readonly resolvedRef: string;     // url, vault path, attachment id, etc.
  fetchedBody: string | null;
  contentType: string | null;
  status: 'pending' | 'fetched' | 'extracted' | 'error';
  errorCode?: string;
  errorMessage?: string;
}

export interface DiffResult {
  kept: readonly { id: string; locked: boolean }[];
  added: readonly string[];
  removed: readonly string[];
  edgesRemoved: readonly { from: string; to: string; type: string }[];
}

export interface SidecarV1 {
  schemaVersion: 1;
  runId: string;
  schema: { entityTypes: EntityTypeDef[]; relationTypes: RelationTypeDef[] };
  entityGraph: EntityGraph;
  coordMap: Record<string, { x: number; y: number; w: number; h: number }>;
  tombstones: readonly string[];
  edgeTombstones: readonly { from: string; to: string; type: string }[];
  lastRunAt: string;       // iso8601
}
```

State is the single source of truth for the live widget; the controller projects state into UI without a parallel store.

---

## 7. Module Map

```
src/agent/canvas/
├── budgets.ts                       # token caps, layout constants, MOVE_DRIFT_PX, sourceFanoutMax, editIterationsMax
├── runIdRegistry.ts                 # generateCanvasRunId() — YYYYMMDD-HHmmss-<6char>
├── liveControllerRegistry.ts        # Map<runId, CanvasWidgetController>
├── mutex.ts                         # CanvasMutex — per-canvas-path
├── slug.ts                          # canvas vault path → sidecar slug (kebab + sha-suffix)
├── canvasJson.ts                    # Zod schema for Obsidian .canvas JSON; parse/serialize
├── sidecar.ts                       # SidecarV1 read/write (.leo/canvas/runs/)
├── refine.ts                        # refine sub-agent
├── refinePrompt.ts                  # refine system prompt (snapshot)
├── plan.ts                          # source-hint expansion (eager)
├── fetch.ts                         # adapter to fetchIngestSource
├── extract.ts                       # extractor subagent
├── reduce.ts                        # reducer subagent + insights computation
├── diff.ts                          # DIFFING phase logic — kept/added/removed + lock detection
├── layouts/
│   ├── index.ts                     # PresetId dispatch + auto-selection (FR-CANVAS-34)
│   ├── bipartite.ts
│   ├── tree.ts
│   ├── radial.ts
│   ├── force.ts
│   ├── grid.ts
│   ├── timeline.ts
│   └── nodeSize.ts                  # auto-size formula (FR-CANVAS-35)
├── writer.ts                        # preview write + atomic rename + sidecar write
├── subgraph.ts                      # FSM driver, AbortSignal, mutex acquire/release
├── orchestrator.ts                  # CanvasOrchestrator.start({...}) → RunHandle
├── tools/
│   ├── delegateCanvasCreate.ts
│   ├── delegateCanvasContentEdit.ts
│   ├── delegateCanvasLayoutEdit.ts
│   └── revealInCanvas.ts
├── widget/
│   ├── widgetController.ts          # CanvasWidgetController
│   ├── widgetState.ts               # CanvasViewModel
│   ├── terminalSnapshot.ts          # CanvasTerminalSnapshot Zod + builder
│   ├── CanvasLiveBlock.tsx          # registered under CANVAS_LIVE_KIND
│   └── CanvasTerminalBlock.tsx      # registered under CANVAS_TERMINAL_KIND
└── loggingNamespaces.ts             # canvas.create.*, canvas.contentEdit.*, canvas.layoutEdit.*, canvas.reveal.*

src/editor/canvasNavigator.ts        # Obsidian canvas-view adapter — open/reveal/zoom/pan
```

---

## 8. Tool & Subagent Contracts

### 8.1 Extractor Output (Zod)

```ts
export const EntityFragment = z.object({
  tempId: z.string(),
  type: z.string(),
  name: z.string(),
  fields: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  sourcePath: z.string(),
  citation: z.string().optional(),
});

export const EdgeFragment = z.object({
  fromTempId: z.string(),
  toTempId: z.string(),
  type: z.string(),
  label: z.string().optional(),
});

export const ExtractorOutput = z.object({
  schemaVersion: z.literal(1),
  sourceRef: z.string(),
  entities: z.array(EntityFragment).max(100),
  edges: z.array(EdgeFragment).max(200),
});
export type ExtractorOutput = z.infer<typeof ExtractorOutput>;
```

### 8.2 Entity Graph (Reduced, Stable IDs)

```ts
export const Entity = z.object({
  id: z.string(),                 // canonical id
  type: z.string(),
  name: z.string(),
  fields: z.record(z.string(), z.unknown()).optional(),
  sources: z.array(z.string()).max(20),
});

export const Edge = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: z.string(),
  label: z.string().optional(),
});

export const EntityGraph = z.object({
  schemaVersion: z.literal(1),
  entities: z.array(Entity).max(500),
  edges: z.array(Edge).max(2000),
});
export type EntityGraph = z.infer<typeof EntityGraph>;
```

### 8.3 Insights & Run Plan (Zod)

```ts
export const Insights = z.object({
  hubs: z.array(z.object({ id: z.string(), name: z.string(), degree: z.number() })).max(5),
  components: z.object({ count: z.number(), sizes: z.array(z.number()) }),
  orphans: z.array(z.string()).max(50),
  perTypeCount: z.record(z.string(), z.number()),
});

export const EntityTypeDef = z.object({
  name: z.string(),
  description: z.string(),
  fields: z.array(z.string()).max(8).optional(),
});

export const RelationTypeDef = z.object({
  name: z.string(),
  from: z.string(),
  to: z.string(),
  description: z.string(),
});

export const SourceHint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vaultGlob'), glob: z.string() }),
  z.object({ kind: z.literal('vaultTag'), tag: z.string() }),
  z.object({ kind: z.literal('vaultFrontmatter'), field: z.string(), value: z.string() }),
  z.object({ kind: z.literal('mention'), path: z.string() }),
  z.object({ kind: z.literal('url'), url: z.string() }),
  z.object({ kind: z.literal('attachment'), attachmentId: z.string() }),
  z.object({ kind: z.literal('conversation'), title: z.string(), body: z.string() }),
]);

export const RunPlan = z.object({
  schemaVersion: z.literal(1),
  entityTypes: z.array(EntityTypeDef).max(8),
  relationTypes: z.array(RelationTypeDef).max(16),
  sourceHints: z.array(SourceHint).max(32),
  layoutHint: z.enum(['bipartite', 'tree', 'radial', 'force', 'grid', 'timeline', 'auto']),
  scope: z
    .object({
      dateRange: z.tuple([z.string(), z.string()]).optional(),
      filter: z.string().optional(),
    })
    .optional(),
  outputPath: z.string(),
});
export type RunPlan = z.infer<typeof RunPlan>;
```

### 8.4 Tool Result Shapes

```ts
type CanvasToolResultOk = {
  ok: true;
  runId: string;
  path: string;             // final canvas vault path
  insights: Insights;
  partial?: { failedSources: { ref: string; code: string; message: string }[] };
  durationMs: number;
};

type CanvasToolResultErr =
  | { ok: false; denied: true }
  | { ok: false; cancelled: true; phase: CanvasPhase; partial: unknown }
  | { ok: false; error: 'busy'; activeRunId: string; activeOp: CanvasOp }
  | { ok: false; error: { code: string; message: string }; partial?: unknown };

type RevealResult =
  | { ok: true; path: string; viewportApplied: boolean; warning?: string }
  | { ok: false; error: { code: string; message: string } };
```

### 8.5 Obsidian Canvas JSON (Subset Leo Emits)

```ts
export const CanvasNode = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    id: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    text: z.string(),
    color: z.string().optional(),
  }),
  z.object({
    type: z.literal('file'),
    id: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    file: z.string(),                 // vault-relative path
    color: z.string().optional(),
  }),
]);

export const CanvasEdge = z.object({
  id: z.string(),
  fromNode: z.string(),
  toNode: z.string(),
  fromSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
  toSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
  label: z.string().optional(),
  color: z.string().optional(),
});

export const CanvasJson = z.object({
  nodes: z.array(CanvasNode),
  edges: z.array(CanvasEdge),
});
export type CanvasJson = z.infer<typeof CanvasJson>;
```

---

## 9. Storage Layout

```
<vault>/
└── canvases/                            # default folder; not enforced — user can pick any path
    └── <slug>.canvas                    # Obsidian canvas JSON

<vault>/.leo/canvas/runs/
└── <slug>.json                          # SidecarV1 — internal-only memo, one per canvas
```

Example `.canvas` file (Leo-emitted subset — `text` and `file` nodes only):

```json
{
  "nodes": [
    { "type": "text", "id": "n1", "x": 0,   "y": 0,   "width": 240, "height": 100, "text": "# Conf 2026-Q1" },
    { "type": "file", "id": "n2", "x": 320, "y": 0,   "width": 240, "height": 100, "file": "people/alice.md" },
    { "type": "file", "id": "n3", "x": 320, "y": 160, "width": 240, "height": 100, "file": "people/bob.md" }
  ],
  "edges": [
    { "id": "e1", "fromNode": "n2", "toNode": "n1", "label": "attended" },
    { "id": "e2", "fromNode": "n3", "toNode": "n1", "label": "attended" }
  ]
}
```

Example sidecar `.leo/canvas/runs/conf-2026-q1-9f3a1c.json`:

```json
{
  "schemaVersion": 1,
  "runId": "20260505-101433-ab12cd",
  "schema": {
    "entityTypes": [
      { "name": "event", "description": "A scheduled gathering" },
      { "name": "person", "description": "An attendee" }
    ],
    "relationTypes": [
      { "name": "attended", "from": "person", "to": "event", "description": "Person attended event" }
    ]
  },
  "entityGraph": { /* ... */ },
  "coordMap": {
    "event:conf-2026-q1": { "x": 0,   "y": 0,   "w": 240, "h": 100 },
    "person:alice":       { "x": 320, "y": 0,   "w": 240, "h": 100 },
    "person:bob":         { "x": 320, "y": 160, "w": 240, "h": 100 }
  },
  "tombstones": [],
  "edgeTombstones": [],
  "lastRunAt": "2026-05-05T10:14:33Z"
}
```

---

## 10. Settings

The canvas feature has **no user-configurable settings in v1**. All thresholds, concurrency caps, layout constants, and bbox padding live in `src/agent/canvas/budgets.ts` and require a code change to tune. The Settings tab gains no new section.

A future toggle to disable the feature globally is out of scope for v1.

---

## 11. Module-to-Requirement Map

| Module                                                              | Requirements                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `tools/delegateCanvasCreate.ts`                                     | FR-CANVAS-01, 05, 43                                    |
| `tools/delegateCanvasContentEdit.ts`                                | FR-CANVAS-02, 05, 25, 26                                |
| `tools/delegateCanvasLayoutEdit.ts`                                 | FR-CANVAS-03, 05                                        |
| `tools/revealInCanvas.ts`                                           | FR-CANVAS-04, 55..58                                    |
| `refine.ts`, `refinePrompt.ts`                                      | FR-CANVAS-06..10                                        |
| `plan.ts`                                                           | FR-CANVAS-11..14                                        |
| `fetch.ts`                                                          | FR-CANVAS-13                                            |
| `extract.ts`                                                        | FR-CANVAS-15..16, NFR-CANVAS-07..08, 10                 |
| `reduce.ts`                                                         | FR-CANVAS-17..19, 44, NFR-CANVAS-07..08, 10             |
| `diff.ts`                                                           | FR-CANVAS-20..26                                        |
| `layouts/*`                                                         | FR-CANVAS-27..37, FR-CANVAS-35a, NFR-CANVAS-09          |
| `writer.ts`, `sidecar.ts`, `slug.ts`, `canvasJson.ts`               | FR-CANVAS-38..43, NFR-CANVAS-11                         |
| `subgraph.ts`, `orchestrator.ts`                                    | FR-CANVAS-49..54, NFR-CANVAS-01..02, 05                 |
| `mutex.ts`                                                          | FR-CANVAS-46..48, NFR-CANVAS-05                         |
| `widget/widgetController.ts`, `CanvasLiveBlock.tsx`                 | FR-CANVAS-59..62                                        |
| `widget/terminalSnapshot.ts`, `CanvasTerminalBlock.tsx`             | FR-CANVAS-61..62                                        |
| `liveControllerRegistry.ts`                                         | FR-CANVAS-59                                            |
| `editor/canvasNavigator.ts`                                         | FR-CANVAS-55..57                                        |
| `slashCommands` (existing module)                                   | FR-CANVAS-63                                            |
| `loggingNamespaces.ts`                                              | NFR-CANVAS-03                                           |
| `budgets.ts`                                                        | NFR-CANVAS-10..12                                       |

---

## 12. Testing Strategy

| Layer                                                 | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit** (Vitest)                                     | Each `layouts/*` algorithm — golden-file fixtures (deterministic output snapshotted); `canvasJson.ts` parse/serialize round-trip + reject malformed; `sidecar.ts` read/write + schema-version mismatch; `slug.ts` collision behavior with shared leaf names; `diff.ts` kept/added/removed sets + drift-threshold lock detection + edge-tombstone tracking; `extract.ts` Zod retry-on-parse-failure; `reduce.ts` canonical-id resolution paths (wikilink, url, normalized name, alias) + insights computation; `budgets.ts` constants. |
| **Integration** (Vitest + canned LLM `AsyncIterable`) | Full `delegate_canvas_create` end-to-end with mock LLM and fake `VaultAdapter`: refine → plan → fetch (mocked) → extract (canned) → reduce → layout (real, deterministic) → preview → approve → write. Assert canvas JSON shape, sidecar contents, mutex held → busy returned on second call. Same for `content_edit` (with diff merge — including a fixture canvas with one node manually moved on disk → verify `locked: true` and coord preserved post-rewrite). Same for `layout_edit` (skip-extraction path). Abort within 2s. All-sources-failed → ERROR. |
| **DOM** (Vitest + happy-dom)                          | `CanvasLiveBlock` renders all phases from canned controller view-models; `CanvasTerminalBlock` collapse/expand; controllers route Approve/Edit/Cancel correctly during PREVIEWING; AWAITING_CONFIG provider/model/preset/path picker validates inputs; `reveal_in_canvas` adapter feature-detect fallback exercised when canvas API shape mismatches.                                                                                                                                                              |
| **Live** (`vitest.llm.config.ts`)                     | Real Qwen 30B against `tests/smoke/fixtures/tinyVault` extended with event/person fixtures. Single `create` run — assert canvas file exists with expected node + edge counts, sidecar present, insights non-empty, hub identification correct. Re-run as `content_edit` after one node manually moved on disk — assert moved coord preserved.                                                                                                                                                                  |
| **Smoke**                                             | Manual: `/canvas-create` with simple ask, open file in Obsidian, verify rendering; `/canvas-edit` on same file with manual move, verify preserved; switch preset via `delegate_canvas_layout_edit`; `reveal_in_canvas` zooms correctly to nodeIds bbox; concurrent runs against different paths run in parallel; same-path returns busy.                                                                                                                                                                            |

---

## 13. Phasing

| Phase                                | Scope                                                                                                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1** — Reveal + canvasJson    | `canvasJson.ts` Zod schema + parse/serialize, `canvasNavigator.ts` adapter with feature-detect, `reveal_in_canvas` tool, `/canvas-status` slash command (read-only). No subgraph yet. Validates Obsidian internal API shape. |
| **Phase 2** — Create (single source) | Full subgraph end-to-end create path with single source (`vaultPath` or `url` only). All six layouts hand-rolled. Live + terminal widgets. Per-canvas-path mutex. `delegate_canvas_create` tool. `/canvas-create` slash command. |
| **Phase 3** — Source fan-out         | `SourceHint` discriminated union expansion for `vaultGlob` / `vaultTag` / `vaultFrontmatter` / `mention` / `attachment` / `conversation`. Eager expansion + cap. Per-source partial-failure path.                            |
| **Phase 4** — Content edit (diff)    | Sidecar persistence + read on edit. DIFFING phase. Tombstone tracking (entity + edge). `delegate_canvas_content_edit` tool. `/canvas-edit` slash command.                                                                    |
| **Phase 5** — Layout edit            | `delegate_canvas_layout_edit` tool, skip-extraction path through subgraph (degenerate FSM).                                                                                                                                  |
| **Phase 6** — Hardening              | Token-budget tuning against Qwen 30B, golden-file expansion, perf REPORT entry for canvas of 50/200 nodes, extractor-cap tuning. Bundle-size assertion.                                                                      |

Phase boundaries gate at the §12 test matrix: each phase ships unit + integration green for its scope.

---

## 14. Future Work (post-v1)

- Persisted reusable schemas analogous to `wiki/SCHEMA.md` — let users save a "people-and-events" schema for repeated use.
- Image and PDF source ingestion (text-extract preprocessor before extraction; reuse wiki future-work).
- ELK orthogonal layout for dense graphs; gated on bundle-budget headroom.
- LangGraph checkpoint persistence for resume-on-reload of in-flight runs.
- Auto-update on vault note change (trigger threshold: N modifications since last run on the canvas's source set).
- `link` and `group` canvas node types.
- Multi-canvas synthesis (single ask produces a series of canvases — overview + drill-downs).
- Embedded canvas preview block in the chat (in-pane render before user moves to Obsidian leaf).
- Settings UI for layout constants once defaults stabilize.
- "Soft delete" mode — tombstoned entities rendered with grayed color so the user can resurrect by clicking, instead of hard-removed.
- Cross-vault canvas sharing.

---

## 15. Open Questions (tracked, not blocking)

1. Should `reveal_in_canvas` also apply Obsidian canvas selection state (`selectNodeIds`) so users see the highlighted set framed, not just zoomed? Defer until users ask.
2. Should the auto-preset selector (FR-CANVAS-34) call out to the main provider with a small disambiguation prompt for borderline graph shapes (2 entity types but DAG-able)? Latter is more correct, former is cheaper. Bench at Phase 6.
3. Is `MOVE_DRIFT_PX = 16` too sensitive on touchpad scrolls or mid-Obsidian-resize layout shifts? Tune empirically against real edits.
4. Should reducer canonical-id resolution skip the LLM-alias step for graphs under N entities (latency win)? Measure on Qwen 30B.
5. Should the `layout_edit` path support "lock all current positions and only relayout new entities" as a sub-mode? Useful for incremental refinement; defer until requested.
6. Should `canvas-create` accept a `seedFromCanvas: string` option to clone an existing canvas's schema and entity graph as a starting point? Possibly Phase 5.
