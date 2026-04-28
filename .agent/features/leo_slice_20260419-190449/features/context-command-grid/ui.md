# F47 — `/context` command + category breakdown + grid · UI

Visual contract and wiring for the interactive `/context` surface: dual dispatch (slash command from [F06 chat-composer-input](../chat-composer-input/feature.md) and `Leo: Show context` palette entry) → shared handler → [F46 context-analyzer-pipeline](../context-analyzer-pipeline/feature.md) → two-column layout rendered into the [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) ItemView. Every numeric constant, symbol code-point, ordering rule, and allocation formula below is linked, not restated — source is [context.md §2](../../../../srs/context.md#2-command-registration), [§8](../../../../srs/context.md#8-category-definitions--ordering), [§9](../../../../srs/context.md#9-grid-visualization), [§10](../../../../srs/context.md#10-interactive-ui-layout).

## Layout

The `/context` result mounts as an assistant-turn "transient panel" inside the [F04](../chat-sidebar-view/feature.md) `MessageList` region using the same tail-bubble slot used by streaming turns, but rendered by a dedicated `ContextPanel` React subtree that owns the two-column frame. Left column is the responsive grid; right column is the fixed-order category breakdown + detail sections. Four wireframes cover the responsive grid quadrants from [context.md §9.1](../../../../srs/context.md#91-grid-dimensions); two extras cover partial-square fullness and deferred-category rendering.

### Wireframe 1 — Narrow leaf, standard context window (`contextWindow < 1e6 && panelWidth < 80ch` → **5×5 / 25 squares**)

```
 0        10        20        30        40
 |---------|---------|---------|---------|      panel marker: < 80ch
+------------------------------------------+
| ContextPanel  region (role="region"      |   <- mounts in F04 MessageList
|              aria-label="Context usage") |      tail-bubble slot
+------------------------------------------+
| LEFT  (grid)             | RIGHT (break) |
|--------------------------+---------------|
| Context Usage            | Model:        |
|                          |  gpt-oss-20b  |
|  ◉ ◉ ◉ ◉ ◉               | Tokens:       |
|  ◉ ◉ ◐ ◻ ◻               |  12.4k / 128k |
|  ◻ ◻ ◻ ◻ ◻               |  (10%)        |
|  ◻ ◻ ◻ ◻ ◻               |               |
|  ◻ ◻ ◻ ◻ ⚡               | ◉ System prompt
|                          | ◉ System tools
|                          | ◉ Memory files
|                          | ◉ Messages
|                          | ◻ Free space  |
|                          | ⚡ Autocompact |
+------------------------------------------+
```

- Grid: 5 rows × 5 cols = **25 squares** per [§9.1](../../../../srs/context.md#91-grid-dimensions) row 1; trailing `⚡` is the reserved autocompact square rendered *after* Free space per [§9.4](../../../../srs/context.md#94-square-rendering-order).
- Break column row order is the eleven-position fixed order from [context.md §8](../../../../srs/context.md#8-category-definitions--ordering); conditional rows (MCP tools, Custom agents, Skills) collapse out-of-tree without shifting remaining rows per [feature.md](./feature.md) AC#3.
- Panel width is measured live from the [F04](../chat-sidebar-view/feature.md) `ResizeObserver`; the `< 80ch` threshold is computed against the offscreen-measured monospace glyph advance (see Event flow).

### Wireframe 2 — Wide leaf, standard context window (`contextWindow < 1e6 && panelWidth ≥ 80ch` → **10×10 / 100 squares**)

```
 0        10        20        30        40        50        60        70        80
 |---------|---------|---------|---------|---------|---------|---------|---------|   >= 80ch
+----------------------------------------------------------------------------------+
| ContextPanel  region                                                             |
+--------------------------------------+-------------------------------------------+
| LEFT  (grid — 100 squares)           | RIGHT  (breakdown + details)              |
|                                      |                                           |
|  Context Usage                       |   Model: gpt-oss-20b                      |
|                                      |   Tokens: 45.2k / 128k (35%)              |
|  ◉◉◉◉◉◉◉◉◉◉                          |                                           |
|  ◉◉◉◉◉◉◉◉◉◉                          |   ◉ System prompt     3.2k    2.5%        |
|  ◉◉◉◐◻◻◻◻◻◻                          |   ◉ System tools      8.1k    6.3%        |
|  ◻◻◻◻◻◻◻◻◻◻                          |   ◉ MCP tools         2.5k    2.0%        |
|  ◻◻◻◻◻◻◻◻◻◻                          |   ◉ Memory files      1.2k    0.9%        |
|  ◻◻◻◻◻◻◻◻◻◻                          |   ◉ Skills            0.8k    0.6%        |
|  ◻◻◻◻◻◻◻◻◻◻                          |   ◉ Messages         29.4k   23.0%        |
|  ◻◻◻◻◻◻◻◻◻◻                          |   ◻ Free space       82.8k   64.7%        |
|  ◻◻◻◻◻◻◻◻◻◻                          |   ⚡ Autocompact buf   —       —           |
|  ◻◻◻◻◻◻◻◻⚡⚡                          |                                           |
|                                      |   MCP Tools:                              |
|                                      |     serena / find_symbol   320            |
|                                      |     serena / list_dir      280            |
|                                      |                                           |
|                                      |   Memory Files:                           |
|                                      |     project  .leo/CLAUDE.md   800         |
|                                      |                                           |
|                                      |   Suggestions:  (owned by F48)            |
+--------------------------------------+-------------------------------------------+
```

- Grid: 10 rows × 10 cols = **100 squares** per [§9.1](../../../../srs/context.md#91-grid-dimensions) row 2 — the reference case in [context.md §10](../../../../srs/context.md#10-interactive-ui-layout).
- Suggestions block is a stub — actual rendering is owned by [F48](../../features-index.md); F47 reserves the slot only, per [feature.md](./feature.md) Out-of-scope.
- Category theme colors resolve through CSS custom properties on the view root (see Component mapping); no literal hex per [Code style — Styling](../../../../standards/code-style.md#styling).

### Wireframe 3 — Narrow leaf, 1M context (`contextWindow ≥ 1e6 && panelWidth < 80ch` → **5×10 / 50 squares**)

```
 0        10        20        30        40
 |---------|---------|---------|---------|      panel marker: < 80ch
+------------------------------------------+
| LEFT  (grid — 50 squares)   | RIGHT     |
|                             |           |
|  Context Usage              | Model:    |
|                             |  claude-  |
|  ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉         |  opus-4-6 |
|  ◉ ◉ ◉ ◐ ◻ ◻ ◻ ◻ ◻ ◻         |  [1m]     |
|  ◻ ◻ ◻ ◻ ◻ ◻ ◻ ◻ ◻ ◻         | Tokens:   |
|  ◻ ◻ ◻ ◻ ◻ ◻ ◻ ◻ ◻ ◻         |  45.2k /  |
|  ◻ ◻ ◻ ◻ ◻ ◻ ◻ ◻ ◻ ⚡         |  1M (5%)  |
|                             |           |
+------------------------------------------+
```

- Grid: 5 rows × 10 cols = **50 squares** per [§9.1](../../../../srs/context.md#91-grid-dimensions) row 3.
- 1M selection is driven by the resolved context window supplied on `ContextData` (authored by [F46](../context-analyzer-pipeline/feature.md)); F47 reads only, never probes the model.

### Wireframe 4 — Wide leaf, 1M context (`contextWindow ≥ 1e6 && panelWidth ≥ 80ch` → **20×10 / 200 squares**)

```
 0        10        20        30        40        50        60        70        80
 |---------|---------|---------|---------|---------|---------|---------|---------|   >= 80ch
+----------------------------------------------------------------------------------+
| LEFT  (grid — 200 squares, 10 rows × 20 cols)    | RIGHT  (breakdown)            |
|                                                  |                               |
|  Context Usage                                   |  Model: claude-opus-4-6[1m]   |
|                                                  |  Tokens: 45.2k / 1M (5%)      |
|  ◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉                            |                               |
|  ◉◉◐◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻                            |  ◉ System prompt   3.2k  0.3% |
|  ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻                            |  ◉ System tools    8.1k  0.8% |
|  ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻                            |  ◉ MCP tools       2.5k  0.3% |
|  ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻                            |  ◉ Memory files    1.2k  0.1% |
|  ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻                            |  ◉ Messages       28.5k  2.9% |
|  ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻                            |  ◻ Free space    955.2k 95.5% |
|  ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻                            |  ⚡ Autocompact buf  —      — |
|  ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻                            |                               |
|  ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻⚡⚡                            |                               |
+----------------------------------------------------------------------------------+
```

- Grid: 10 rows × 20 cols = **200 squares** per [§9.1](../../../../srs/context.md#91-grid-dimensions) row 4 — the densest case.
- The two trailing `⚡` squares are the reserved autocompact block appended *last* per [§9.4](../../../../srs/context.md#94-square-rendering-order); they replace what would have been Free-space squares, not category squares.

### Wireframe 5 — Category breakdown (all eleven rows present) and partial-square fullness gate

```
 0        10        20        30        40        50        60
 |---------|---------|---------|---------|---------|---------|
+-------------------------------------------------------------+
| RIGHT column — full eleven-row ordering (context.md §8)    |
|                                                             |
|   ◉  System prompt             3.2k       2.5%              |  <- pos 1
|   ◉  System tools              8.1k       6.3%              |  <- pos 2
|   ◉  MCP tools                 2.5k       2.0%              |  <- pos 3
|   ·  MCP tools (deferred)     — dim —     —                 |  <- pos 4  (deferred, no grid, no %)
|   ·  System tools (deferred)  — dim —     —                 |  <- pos 5  (deferred, no grid, no %)
|   ◉  Custom agents             0.6k       0.5%              |  <- pos 6
|   ◉  Memory files              1.2k       0.9%              |  <- pos 7
|   ◉  Skills                    0.8k       0.6%              |  <- pos 8
|   ◉  Messages                 29.4k      23.0%              |  <- pos 9
|   ⚡  Autocompact buffer        5.0k       —                 |  <- pos 10 (reserved)
|   ◻  Free space               77.2k      60.3%              |  <- pos 11
+-------------------------------------------------------------+

Partial-square fullness gate  (context.md §9.3 + §9.5)
+-------------------------------------------------------------+
|   fractionalPart = exactSquares - floor(exactSquares)       |
|                                                             |
|      0.00    ---->   ◻  (free-space glyph; no square emitted)
|      0.30    ---->   ◐  (<0.7 gate)
|      0.70    ---->   ◉  (>=0.7 gate)
|      0.999   ---->   ◉
|      1.00    ---->   ◉  (whole square)
+-------------------------------------------------------------+
```

- The dim `·` marker on positions 4–5 represents the `isDeferred: true` visual treatment from [context.md §8 Deferred Categories](../../../../srs/context.md#8-category-definitions--ordering): rendered in the list, zero grid squares, excluded from the usage-percentage denominator per [feature.md](./feature.md) AC#4. In Leo v1 these rows are typically *absent* from `ContextData` (no tool-search), so the renderer no-ops — the dim row is only painted when the pipeline hands us an `isDeferred` entry (future tool-search integration).
- The symbol gate maps fractional fullness → glyph per [context.md §9.5](../../../../srs/context.md#95-visual-symbols); boundaries `0, 0.3, 0.7, 0.999, 1.0` are pinned by the Vitest table in [feature.md](./feature.md) AC#7.

### Wireframe 6 — Deferred-category tile (future tool-search integration)

```
+-------------------------------------------------------------+
|   RIGHT column excerpt — deferred tile in-place              |
|                                                             |
|   ◉  MCP tools                 2.5k       2.0%              |  <- pos 3 (active)
|   +------------------------------------------------+        |
|   | · MCP tools (deferred)              — dim —    |        |  <- pos 4
|   |   (tokens not counted against window; no grid   |        |     dimmed card
|   |    contribution; listed for future surfacing)   |        |     no interaction
|   +------------------------------------------------+        |
|   ·  System tools (deferred)          — dim —               |  <- pos 5
|   ◉  Custom agents             0.6k       0.5%              |  <- pos 6
|                                                             |
|   Grid  (left column, unchanged whether deferred is         |
|    present or absent):                                      |
|                                                             |
|   ◉◉◉◉◉◉◉◉◉◉   <- same square-count as the identical        |
|   ◉◉◐◻◻◻◻◻◻◻     fixture without the deferred entry         |
|   ◻◻◻◻◻◻◻◻◻◻     (feature.md AC#4)                          |
|   ...                                                       |
+-------------------------------------------------------------+
```

- The dim treatment resolves through `var(--text-muted)` / a `data-deferred="true"` hook; concrete CSS token mapping lives in the plugin's scoped stylesheet, not inline literals (per [Code style — Styling](../../../../standards/code-style.md#styling)).
- AC#4's negative assertion is baked into the Vitest fixture: grid-square-count MUST be identical with vs without the deferred entry.

## State machine

The panel has two coupled machines: **ContextPanelMachine** governing the overall dispatch → fetch → render → teardown lifecycle, and **GridDimensionMachine** governing the four-quadrant grid-size selection driven by `ResizeObserver` notifications from [F04](../chat-sidebar-view/feature.md).

```mermaid
stateDiagram-v2
    [*] --> idle: ChatView mount

    idle --> dispatching: slash_submit("/context") | palette_invoke("leo-show-context")
    dispatching --> loading: handler creates AbortController + calls F46.analyzeContextUsage
    loading --> rendered: ContextData resolved
    loading --> error: F46 rejects (any reason) | abort signalled
    loading --> idle: unmount (controller.abort, no render)

    rendered --> rendered: resize (GridDimensionMachine re-selects; breakdown untouched; F46 NOT re-called)
    rendered --> idle: dismiss | next turn replaces panel
    rendered --> idle: unmount (controller disposed)

    error --> idle: user dismisses F13 error surface | unmount

    state rendered {
        [*] --> grid5x5
        grid5x5  --> grid10x10: panelWidth crosses >=80ch   (contextWindow < 1e6)
        grid10x10 --> grid5x5:  panelWidth crosses <80ch    (contextWindow < 1e6)
        grid5x10  --> grid20x10: panelWidth crosses >=80ch  (contextWindow >= 1e6)
        grid20x10 --> grid5x10:  panelWidth crosses <80ch   (contextWindow >= 1e6)
    }
```

Plain adjacency list (equivalent to the diagram above, for reviewers who prefer it):

```
ChatView.mount                                    -> idle
idle            + slash_submit("/context")        -> dispatching
idle            + palette_invoke("leo-show-context") -> dispatching
dispatching     + handler.start                   -> loading            [spawn AbortController, call F46]
loading         + F46.resolve(ContextData)        -> rendered{grid5x5|10x10|5x10|20x10}
loading         + F46.reject(err)                 -> error              [F13 error surface; no partial render]
loading         + abort                           -> error              [DOMException('aborted')]
loading         + unmount                         -> idle               [controller.abort()]
rendered        + resize(panelWidth delta)        -> rendered{new grid} [GridDimensionMachine; breakdown untouched]
rendered        + dismiss | next-turn             -> idle
rendered        + unmount                         -> idle               [controller disposed]
error           + dismiss | unmount               -> idle
```

- The only IO-bearing transitions are `dispatching -> loading` (spawns `AbortController`, invokes [F46](../context-analyzer-pipeline/feature.md)) and `loading -> error` (routes to [F13](../ui-visual-states-notifications/feature.md) error surface per [feature.md](./feature.md) AC#10). The `rendered -> rendered` resize edge is *pure layout* — no re-call of F46 per [feature.md](./feature.md) AC#9.
- `GridDimensionMachine` is a pure finite-state function of `(contextWindow, panelWidth)`; it is Vitest-covered independently by the four-quadrant parametrized table per [feature.md](./feature.md) AC#5. Hysteresis is intentionally absent in v1 — the `<80ch` threshold flips cleanly on each resize edge.
- There is no "loading -> rendered -> loading" edge: `/context` is one-shot per invocation, matching the "one-shot render" contract from [context.md §10 Rendering](../../../../srs/context.md#10-interactive-ui-layout). Re-running the command creates a *new* panel state, not a second transition on the existing one.

## Event flow

The `/context` surface converges two entry points on one handler, runs the [F46](../context-analyzer-pipeline/feature.md) pipeline under a turn-scoped `AbortController`, and renders the two-column frame into [F04](../chat-sidebar-view/feature.md)'s tail-bubble slot. All teardown rides the [F04](../chat-sidebar-view/feature.md) `onClose` path and the React 18 `useEffect` cleanup contract per [Code style — React 18](../../../../standards/code-style.md#react-18).

```
plugin.onload():
  Plugin.addCommand({ id: "leo-show-context",
                      name: "Leo: Show context",
                      callback: showContextHandler })
  -> palette entry registered; auto-disposed on onunload per F01 contract

F06 composer submit():
  if (rawInput.trim() === "/context" && chatViewVisible):
      showContextHandler(agentCtx)          // same entry point as palette
      return                                // short-circuit; do not send to provider
  else:
      ...normal message submit path

showContextHandler(agentCtx):                                           // [feature.md AC#1]
  1. controller = new AbortController()                                 // turn-scoped
  2. panel.setState("dispatching")
  3. try:
       data = await F46.analyzeContextUsage({
                messages, model, tools, agentDefinitions, originalMessages,
                signal: controller.signal, /* ... per context.md §6.1 */
              })
       panel.setState("rendered", data)
     catch (err):
       if (err.name === "AbortError"):
            panel.setState("idle")                                       // silent unmount path
       else:
            F13.Notifications.error(err.message)                         // [feature.md AC#10]
            panel.setState("error", err)
  4. return disposable: () => controller.abort()                        // bound to F04 onClose

ContextPanel.useEffect(mount):
  - subscribe to F04 ResizeObserver
  - on notification:
      newWidth = container.clientWidth / measureGlyphAdvance()           // offscreen-measured, cached
      newDims  = GridDimensionMachine.select(contextWindow, newWidth)
      if (newDims !== currentDims): setState({ dims: newDims })          // [feature.md AC#9]
      // F46 is NOT re-called

ContextPanel render():
  1. LEFT column:
       rows = buildGrid(ContextData, dims)   // §9.2 allocation + §9.3 fullness + §9.4 order
       for each square: pick glyph per §9.5 (fullness >= 0.7 -> ◉ else ◐; free -> ◻; reserved -> ⚡)
  2. RIGHT column:
       for cat in CATEGORY_ORDER (context.md §8, eleven positions):
         if !data.categories[cat]: skip (conditional rows collapse in place; AC#3)
         if data.categories[cat].isDeferred: render dim row, no grid, no %-denom contribution (AC#4)
         else: render "{symbol} {name} {tokens} {pct}"

ContextPanel.useEffect(cleanup):
  - controller.abort()                                                   // dispose turn scope
  - ResizeObserver unsubscribe
  - React unmount symmetric with F04 onClose per Architecture §10
```

- Dual-path convergence is pinned by a Vitest fixture spying on `showContextHandler`: both the slash-submit and the palette `callback` produce identical invocation payloads per [feature.md](./feature.md) AC#1.
- The `measureGlyphAdvance()` helper runs once on mount (offscreen 100-char monospace span, divide by 100) and is invalidated only when the user changes the Obsidian font — cached across `ResizeObserver` ticks to keep resize handling allocation-free.
- Error surface routing goes through [F13](../ui-visual-states-notifications/feature.md)'s `Notifications.error` channel so `/context` failures share the same toast treatment as every other reject path; no partial grid is ever painted per [feature.md](./feature.md) AC#10.
- The palette entry is registered globally in v1 with a silent "Open Leo chat first" `Notice` fallback when the ChatView is not mounted (see [feature.md Open questions](./feature.md#open-questions)); swap to `checkCallback` if the verifier prefers hiding the entry.

## Component mapping

| Concern | Module / primitive | Standards anchor |
|---|---|---|
| `ContextPanel` React subtree (two-column frame, mount target in `MessageList` tail-bubble slot) | React 18 function component mounted via `createRoot` inside [F04](../chat-sidebar-view/feature.md) `ChatView.onOpen`; unmounted in `onClose` | [Tech stack — UI Layer (React 18)](../../../../standards/tech-stack.md#ui-layer), [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer), [Code style — React 18](../../../../standards/code-style.md#react-18) |
| Chat-surface host (tail-bubble slot, assistant-turn styling reuse) | [Assistant UI `@assistant-ui/react`](../../../../standards/tech-stack.md#ui-layer) message-bubble primitive — `ContextPanel` rides the same slot streaming turns use (consistent padding, type rail, copy affordance) | [Tech stack — UI Layer (`@assistant-ui/react`)](../../../../standards/tech-stack.md#ui-layer), [Tech stack — Dependencies — Production](../../../../standards/tech-stack.md#dependencies--production) |
| Slash-command dispatch `^/context$` intercept | Handler plumbed on [F06 composer](../chat-composer-input/feature.md) submit path (v1: regex match before provider send, per [feature.md Open questions](./feature.md#open-questions)); SlashCommandRegistry deferred | [Tech stack — Agent Layer](../../../../standards/tech-stack.md#agent-layer), [Architecture §5.6 Command/Palette Dispatch](../../../../architecture/architecture.md#5-end-to-end-flows), [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Palette entry `Leo: Show context` | Obsidian `Plugin.addCommand({ id: "leo-show-context", name, callback: showContextHandler })`; auto-disposed on `onunload` per [F01](../plugin-bootstrap-logging/feature.md) | [Tech stack — Platform APIs (`Plugin.addCommand`)](../../../../standards/tech-stack.md#platform-apis), [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Shared `showContextHandler` (dual-path convergence) | TypeScript function in the agent layer wrapping the `AbortController` + [F46](../context-analyzer-pipeline/feature.md) call | [Tech stack — Agent Layer](../../../../standards/tech-stack.md#agent-layer), [Architecture §3.2 Agent Layer](../../../../architecture/architecture.md#32-agent-layer), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency) |
| Turn-scoped `AbortController` (abort on unmount + `/context`-level cancel) | Plain `new AbortController()` spawned per invocation; `.abort()` in React `useEffect` cleanup symmetric with unmount | [Tech stack — Agent Layer (Cancel row)](../../../../standards/tech-stack.md#agent-layer), [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency) |
| Pure grid helper `buildGrid(data, dims)` (§9.2 allocation + §9.3 fullness + §9.4 order) | Pure TypeScript in the domain/core layer; no Obsidian / React imports; Vitest-covered per [feature.md](./feature.md) AC#6/#7/#8 | [Tech stack — Runtime & Build](../../../../standards/tech-stack.md#runtime--build), [Architecture §3.3 Domain / Core (pure)](../../../../architecture/architecture.md#33-domain--core-pure), [Code style — TypeScript](../../../../standards/code-style.md#typescript) |
| `GridDimensionMachine.select(contextWindow, panelWidth)` (5×5 / 10×10 / 5×10 / 20×10) | Pure TypeScript lookup against the four-row table from [context.md §9.1](../../../../srs/context.md#91-grid-dimensions); Vitest parametrized table per [feature.md](./feature.md) AC#5 | [Tech stack — Testing (Vitest)](../../../../standards/tech-stack.md#testing), [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) |
| Chars-per-line heuristic (`clientWidth / glyphAdvance`) | One-time offscreen-measure helper + memo; re-invalidated on font-change only; driven by [F04](../chat-sidebar-view/feature.md) `ResizeObserver` | [Tech stack — Platform APIs (`ResizeObserver`)](../../../../standards/tech-stack.md#platform-apis), [Code style — Styling](../../../../standards/code-style.md#styling) |
| Category-order renderer (eleven positions, conditional collapse, deferred dim) | TypeScript iteration over the `CATEGORY_ORDER` constant (authored from [context.md §8](../../../../srs/context.md#8-category-definitions--ordering)); Vitest ordering snapshot per [feature.md](./feature.md) AC#2 | [Tech stack — Testing](../../../../standards/tech-stack.md#testing), [Code style — React 18](../../../../standards/code-style.md#react-18) |
| Symbol glyphs `◉ ◐ ◻ ⚡` | Unicode code-points from [§9.5](../../../../srs/context.md#95-visual-symbols); rendered as plain text in the monospace grid; vector fallback via Obsidian `setIcon` reserved for non-grid affordances only | [Tech stack — Platform APIs (`setIcon`)](../../../../standards/tech-stack.md#platform-apis), [Tech stack — UI Layer (Icons)](../../../../standards/tech-stack.md#ui-layer) |
| Category theme colors (resolve through CSS variables, no literals) | Scoped stylesheet on the plugin root mapping each category to `--leo-cat-<name>` tokens that fall back to Obsidian `--color-*` vars | [Tech stack — UI Layer (Styling — Obsidian CSS variables)](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling](../../../../standards/code-style.md#styling) |
| Deferred-category visual treatment (`isDeferred: true` → dim row, zero grid squares, excluded from % denom) | Data-attribute `data-deferred="true"` gating `color: var(--text-muted)` + `opacity: 0.65`; grid helper skips allocation; percentage computed over non-deferred token sum | [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling](../../../../standards/code-style.md#styling) |
| Error surface on F46 rejection / abort | [F13 `Notifications.error(message)`](../ui-visual-states-notifications/feature.md) toast channel; ContextPanel unmounts without rendering a partial grid per [feature.md](./feature.md) AC#10 | [Tech stack — Platform APIs (`Notice`)](../../../../standards/tech-stack.md#platform-apis), [Code style — Error Handling](../../../../standards/code-style.md#error-handling) |
| Structured logging on error path | [F01 `Logger.log`](../plugin-bootstrap-logging/feature.md) with `context.command.error` event; payload includes `{ path: "slash" | "palette", reason }` | [Tech stack — Tooling & Quality](../../../../standards/tech-stack.md#tooling--quality), [Code style — Logging](../../../../standards/code-style.md#logging) |
| Accessibility chrome (`role="region"`, `aria-label="Context usage"`, `aria-live="off"`) | Static region attributes on `ContextPanel` root; one-shot render so no live-region announcements; grid squares carry `aria-hidden="true"` with a category-legend table serving as the accessible equivalent | [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [Code style — React 18](../../../../standards/code-style.md#react-18) |
| Reduced-motion compliance | No animation on panel mount; matches `matchMedia("(prefers-reduced-motion: reduce)")` default via "no transitions" baseline | [Code style — Styling](../../../../standards/code-style.md#styling) |
| Unmount / teardown symmetry | `useEffect` cleanup calls `controller.abort()` and unsubscribes the `ResizeObserver`; [F04](../chat-sidebar-view/feature.md) `ChatView.onClose` drives React unmount | [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules), [Code style — React 18](../../../../standards/code-style.md#react-18), [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Vitest test matrix driver | `vitest` for (category-ordering snapshot, grid-dimension 4-quadrant table, square-allocation fixtures, partial-square fullness boundaries, reserved-square append order, deferred-exclusion, dual-path handler convergence); `msw` unused here (no HTTP) | [Tech stack — Testing (Vitest + `msw`)](../../../../standards/tech-stack.md#testing), [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) |

## Back-link

- Feature spec: [./feature.md](./feature.md)
