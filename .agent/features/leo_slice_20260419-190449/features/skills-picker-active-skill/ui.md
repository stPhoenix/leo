# F22 — SkillPicker & active-skill UI

Back-link: [feature.md](./feature.md).

UI layer, Obsidian + React conventions, and platform-API wiring for this spec come from [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis), [tech-stack — Agent / Tool / Skill / MCP Wiring](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring), [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views), [architecture §3.2](../../../../architecture/architecture.md#32-agent-layer), [architecture §4](../../../../architecture/architecture.md#4-key-contracts), [architecture §5.2](../../../../architecture/architecture.md#52-chat-turn-no-tools), [architecture §6](../../../../architecture/architecture.md#6-state-ownership), [architecture §9](../../../../architecture/architecture.md#9-project-file-layout-proposed).

## Layout

### 1. [F04](../chat-sidebar-view/feature.md) HeaderBar — badge closed (width ≥ 280px)

```
┌──────────────────────────────────────────────────────────────────┐
│ Leo  ·  thread-2026-04-20  ·  [⚙ General ▾]         [⋯]  [✕]     │
└──────────────────────────────────────────────────────────────────┘
                               ▲
                     HeaderBar SkillPicker badge
              role="button" aria-haspopup="listbox"
              aria-label="Active skill: General"
              data-open="false"   focus-ring = var(--interactive-accent)
```

Badge = `setIcon("cog")` + `skill.name` + chevron `▾`; truncates mid-word with native `title` on overflow; rendered inside the `HeaderBar` region of [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) per [FR-CHAT-12](../../context.md#fr-chat-12).

### 2. HeaderBar — picker open, listbox anchored under badge

```
┌──────────────────────────────────────────────────────────────────┐
│ Leo  ·  thread-2026-04-20  ·  [⚙ General ▾]         [⋯]  [✕]     │
│                               └─┐                                 │
│  ┌──────────────────────────────┴────────────────────────────┐    │
│  │ role="listbox"  aria-label="Select skill for this thread" │    │
│  │ ┌────────────────────────────────────────────────────────┐│    │
│  │ │ ✓  General                              [builtin]      ││←── aria-selected="true"
│  │ │    Default assistant — no allowlist, all tools on.     ││    data-active="true"
│  │ ├────────────────────────────────────────────────────────┤│    │
│  │ │    Write assistant                      [builtin]      ││    │
│  │ │    Clear, concise prose. Read-only tools.              ││    │
│  │ ├────────────────────────────────────────────────────────┤│    │
│  │ │    Research                             [builtin]      ││    │
│  │ │    Deep reads + citations. Read-only tools.            ││    │
│  │ ├────────────────────────────────────────────────────────┤│    │
│  │ │    Code helper                          [builtin]      ││    │
│  │ │    Code explain + edit. read/edit tools.               ││    │
│  │ ├────────────────────────────────────────────────────────┤│    │
│  │ │    My research skill                                   ││    │ (user source = no tag)
│  │ │    Custom scaffold for literature reviews.             ││    │
│  │ └────────────────────────────────────────────────────────┘│    │
│  │                                               [Esc = close]│    │
│  └────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

- `[builtin]` tag shown only when `skill.source === "builtin"`; omitted for user skills ([FR-SKILL-01](../../context.md#fr-skill-01) / source-tag from [F21 skills-loader-builtin](../skills-loader-builtin/feature.md)).
- Checkmark `✓` prefixes the row whose `id === thread.metadata.skillId`; also `aria-selected="true"` + `data-active="true"` per [FR-CHAT-12](../../context.md#fr-chat-12) and row contract in [architecture §4](../../../../architecture/architecture.md#4-key-contracts).
- Rows `role="option"` with `aria-describedby` pointing at the `description` span so screen readers announce both name and one-line description per ARIA baseline inherited from [F04 chat-sidebar-view](../chat-sidebar-view/feature.md).
- Rows sorted alphabetically by `name` (AC-1, [feature.md](./feature.md)).

### 3. Command palette entry (`Plugin.addCommand`)

```
┌─ Cmd/Ctrl+P ─ Command palette ───────────────────────────────────┐
│ > select skill                                                    │
│ ─────────────────────────────────────────────────────────────── │
│   Leo: Select skill…                                              │
│   Leo: New thread                                                 │
│   Leo: Clear thread                                               │
└───────────────────────────────────────────────────────────────────┘
            │
            ▼ callback → open the same listbox shown in layout (2)
```

One handler backs both the badge click and the palette entry per [FR-UI-04](../../context.md#fr-ui-04) and [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) (`Plugin.addCommand`).

### 4. Collapsed HeaderBar (width < 280px) — icon only

```
┌──────────────────────────┐
│ Leo  [⚙]   [⋯]  [✕]      │
└──────────────────────────┘
         ▲
         └─ aria-label="Active skill: General"
            title="Active skill: General"  (native tooltip fallback)
            data-collapsed="true"
```

Badge sheds the `skill.name` label + chevron below 280px as inherited from [F04](../chat-sidebar-view/feature.md)'s `ResizeObserver`-driven `data-collapsed` attribute per [NFR-USE-09](../../context.md#nfr-use-09); dropdown still opens at full width when triggered. Collapse rule mirrors [F09 chat-context-indicator UI collapse pattern](../chat-context-indicator/ui.md).

## State machine

### Picker

```
      (close)              (select, commit)          (persisted,
      ┌────────┐           ┌─────────────┐            listbox closed)
      ▼        │           ▼             │                │
   ┌────────┐  │        ┌───────────┐    │          ┌──────────┐
   │ closed │──┴────►   │  opening  │────┴──────►   │ applied  │
   └────────┘  open     └───────────┘  apply(id)    └──────────┘
      ▲       click/cmd    │                              │
      │                    │ ↑↓/Enter/hover               │ emit
      │                    ▼                              │ thread.skill.changed
      │              ┌────────────┐                       │
      └──────────────│  selecting │◄──────────────────────┘
              Esc /  └────────────┘
              blur /   (row highlighted,
              click-   no commit yet)
              outside
```

Trigger-to-closed lifecycle: `closed → open → selecting → applied → closed`. Esc, blur, or click-outside collapse from any open state back to `closed` without mutating store (AC-style requirement: keyboard reachable + Esc-closes per [NFR-USE-05](../../context.md#nfr-use-05)).

### Effective-tools overlay (recomputed on skill-change)

```
┌────────────────────────────────┐
│ effective-tools: full-registry │◄──── allowedTools === undefined
└────────────────────────────────┘
           ▲
           │ skill.changed
           │ (SkillsStore.get(newId))
           ▼
┌────────────────────────────────┐
│ effective-tools: filtered(ids) │◄──── Array.isArray(allowedTools)
└────────────────────────────────┘
```

Each skill-change event re-runs [F16 tool-registry-builtin-read](../tool-registry-builtin-read/feature.md)'s `ToolRegistry.listFor(thread)` filter the next time `AgentRunner` asks for tools — never mutates the registry itself per [FR-SKILL-07](../../context.md#fr-skill-07) / [FR-AGENT-12](../../context.md#fr-agent-12) and [architecture §3.2](../../../../architecture/architecture.md#32-agent-layer).

### `defaultModel` overlay

```
       ┌──────────────┐               ┌──────────────────┐
       │   off        │── set ────►   │   on(modelId)    │
       │ (settings    │               │  (per-thread     │
       │  default)    │◄─── unset ────│   override)      │
       └──────────────┘               └──────────────────┘
             ▲                                │
             │ newSkill.defaultModel === undefined
             │
             └──── newSkill.defaultModel === modelId (string)
```

Overlay resolved on each turn by `AgentRunner` reading `SkillsStore.get(thread.metadata.skillId)?.defaultModel` and passing it to `ProviderManager.stream(..., {model})` per [FR-SKILL-08](../../context.md#fr-skill-08) and [architecture §5.2](../../../../architecture/architecture.md#52-chat-turn-no-tools).

## Event flow

### A. Open + select via HeaderBar badge (primary path)

```
[User click badge]
       │  onClick
       ▼
 SkillPicker:open()──────────► logger.log("skill.picker.open", {threadId})
       │                         (F01 Logger per NFR-LOG-04)
       ▼
 setState(picker="open")
       │
       ▼
 Listbox mounts, focus → active row (skillId match or first)
       │
       │  keyboard: ArrowDown / ArrowUp move aria-activedescendant
       │           Enter or click = commit row
       │           Esc / blur / click-outside = close without commit
       ▼
 SkillPicker:apply(newId)
       │
       ├─► ConversationStore.mutate(setSkillId(newId))   (F14 persist)
       │
       ├─► logger.log("skill.select", {threadId, fromId, toId: newId})
       │
       ├─► bus.emit("thread.skill.changed", {threadId, newId})
       │
       ▼
 setState(picker="closed")  +  badge label re-renders from SkillsStore.get(newId).name
```

Next `AgentRunner.send(msg, thread)` invocation:

```
AgentRunner.send(msg, thread)
       │
       ▼
 skill = SkillsStore.get(thread.metadata.skillId) ?? SkillsStore.get("general")
       │
       ├─► prompt = assemble({systemPrompt: skill.systemPrompt, ...priorTurnsVerbatim})
       │       (prior assistant/user turns are BYTE-IDENTICAL on disk per FR-SKILL-06)
       │
       ├─► tools = ToolRegistry.listFor(thread)  ─►  logger.log("skill.filter.applied",
       │                                                {threadId, allowedToolsCount: tools.length})
       │
       ├─► model = skill.defaultModel ?? settings.chatModel
       │       if skill.defaultModel: logger.log("skill.model.override", {threadId, model})
       │
       ▼
 ProviderManager.stream(prompt, {signal, tools, model})
```

### B. Command-palette path (converges on same handler)

```
[Cmd/Ctrl+P]→"Leo: Select skill…"
       │
       ▼
 Plugin.addCommand.callback()      ← registered once on onload
       │
       ▼
 SkillPicker:open()   (same entry point as badge click; see A)
```

### C. Esc-closes-menu precedence

```
[Esc pressed]
       │
       ▼
 if picker.isOpen  →  picker.close() + focus restores to badge
                                                             (Esc consumed here; does NOT reach F07 stop or F06 composer blur)
 else              →  propagate (falls through to F07/F06 per their UI docs)
```

Matches Esc-precedence contract in [F06 chat-composer-input UI](../chat-composer-input/ui.md) / [F07 chat-streaming-stop UI](../chat-streaming-stop/ui.md): inline UI closers consume Esc before global stop / blur.

### D. Fallback on missing skill id (self-heal)

```
on thread load / picker mount:
       │
       ▼
 s = SkillsStore.get(thread.metadata.skillId)
       │
       ├── s exists                 →  badge renders s.name
       │
       └── s == null (file deleted) →  ConversationStore.mutate(setSkillId("general"))
                                    →  logger.log("skill.select",
                                             {threadId, fromId: thread.metadata.skillId, toId: "general"})
                                    →  badge renders "General"
```

Mirrors AC-7 on [feature.md](./feature.md) and the `SkillsStore` read-only contract from [F21 skills-loader-builtin](../skills-loader-builtin/feature.md).

### E. Teardown

```
ChatView.onClose()
       │
       ▼
 SkillPicker.unmount()
       │
       ├─► unsubscribe SkillsStore change listener
       ├─► unsubscribe ConversationStore skillId listener
       ├─► remove document keydown (Esc) handler
       └─► registered via useEffect cleanup + Plugin.registerDomEvent
              (per code-style — React 18 / Obsidian Plugin Patterns)
```

## Component mapping

| UI element | Implementation | Contract link |
|---|---|---|
| HeaderBar badge trigger | `<button role="button" aria-haspopup="listbox" aria-expanded>` with `setIcon("cog")` + `skill.name` + `▾` | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Badge icon | Lucide `cog` via `setIcon("cog")` | [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Collapsed badge | `data-collapsed="true"` attr driven by [F04](../chat-sidebar-view/feature.md) `ResizeObserver` at 280px; label + chevron `display:none`, native `title` set to `"Active skill: <name>"` | [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views), [NFR-USE-09](../../context.md#nfr-use-09) |
| Dropdown container | Inline React `role="listbox"` anchored to badge (preferred over `Menu` to allow React sub-rendering of rows); falls back cleanly on touch/keyboard per Obsidian `Menu` conventions | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [architecture §9](../../../../architecture/architecture.md#9-project-file-layout-proposed) (`src/ui/chat/SkillPicker.tsx`) |
| Row | `role="option"` with `id`, `aria-selected`, `aria-describedby`, hover `var(--background-modifier-hover)`, active `var(--interactive-accent)` (background) | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) (Obsidian CSS variables) |
| `[builtin]` tag | `<span class="tag" aria-label="Built-in skill">` rendered only when `skill.source === "builtin"` | [architecture §4](../../../../architecture/architecture.md#4-key-contracts) (`Skill.source`) |
| Checkmark `✓` | `setIcon("check")` when `row.id === thread.metadata.skillId`; `aria-selected="true"` | [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Keyboard model | ↑/↓ move `aria-activedescendant`, Home/End jump, Enter commits, Esc closes; focus trap limited to listbox; focus returns to badge on close | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [NFR-USE-05](../../context.md#nfr-use-05) |
| Focus ring | `:focus-visible` outline using `var(--interactive-accent)` on badge and rows; zero colour literals | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) ("Obsidian CSS variables"), code-style — Styling |
| Command-palette entry | `Plugin.addCommand({id: "leo-select-skill", name: "Leo: Select skill…", callback: openPicker})` registered on `Plugin.onload`, auto-disposed on `onunload` | [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis), [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Skill source | `SkillsStore.list()` / `SkillsStore.get(id)` (read-only, in-memory `Map<string, Skill>` watched on vault events) from [F21 skills-loader-builtin](../skills-loader-builtin/feature.md) | [architecture §3.2](../../../../architecture/architecture.md#32-agent-layer), [architecture §8](../../../../architecture/architecture.md#8-extension-points) |
| Persistence | `ConversationStore.mutate(setSkillId)` → `thread.metadata.skillId` written via [F14 conversation-persistence-v1](../conversation-persistence-v1/feature.md) | [architecture §6](../../../../architecture/architecture.md#6-state-ownership) |
| Next-turn hook | `AgentRunner.send(msg, thread)` reads `thread.metadata.skillId` and feeds `skill.systemPrompt` into the prompt build; prior turns untouched | [architecture §5.2](../../../../architecture/architecture.md#52-chat-turn-no-tools), [FR-SKILL-06](../../context.md#fr-skill-06) |
| `allowedTools` filter | `ToolRegistry.listFor(thread)` from [F16 tool-registry-builtin-read](../tool-registry-builtin-read/feature.md) intersects registry by `skill.allowedTools` | [architecture §3.2](../../../../architecture/architecture.md#32-agent-layer), [FR-SKILL-07](../../context.md#fr-skill-07) / [FR-AGENT-12](../../context.md#fr-agent-12) |
| `defaultModel` override | `ProviderManager.stream(prompt, {signal, tools, model: skill.defaultModel ?? settings.chatModel})` | [architecture §5.2](../../../../architecture/architecture.md#52-chat-turn-no-tools), [FR-SKILL-08](../../context.md#fr-skill-08) |
| Listeners | `useEffect` subscribe/unsubscribe on `SkillsStore` + `ConversationStore`; hotkeys via `Plugin.registerDomEvent` auto-cleanup | code-style — React 18, code-style — Obsidian Plugin Patterns |
| Reduced motion | Badge chevron rotation + listbox open fade gated by `matchMedia("(prefers-reduced-motion: reduce)")`; when reduced: no rotate, no fade — swap states instantly | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [NFR-USE-11](../../context.md#nfr-use-11) |
| Structured logs | `logger.log("skill.picker.open" \| "skill.select" \| "skill.filter.applied" \| "skill.model.override", {...})` via F01 Logger | [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views), [NFR-LOG-04](../../context.md#nfr-log-04) |
