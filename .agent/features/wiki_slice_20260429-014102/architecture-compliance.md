# Architecture compliance audit — wiki slice

Audit of every feature.md against [architecture.md](../../architecture/architecture.md). Each row records the architectural rule, the finding before fix, and the patch applied to the feature's `Implementation notes` section.

## Findings & fixes

| # | Feature | Architectural rule | Pre-fix gap | Fix |
|---|---|---|---|---|
| 1 | F01 wiki-bootstrap | §3.3 — `dirtyQueue` is pure state machine, IO wired externally | Notes said "filter `wiki/` at `dirtyQueue` intake" — read as if filter lived inside the pure module | Clarified: filter sits at the indexer caller (the side that adds to `dirtyQueue`); `dirtyQueue` itself stays pure. Linked §3.3, §3.4, §5.1. |
| 2 | F02 wiki-search-basics | §4 — every tool is a `ToolSpec`; tools read vault via `ToolCtx.vault` | Tool registration described informally, no `ToolSpec` callout, no `ToolCtx` access discipline | Added explicit `ToolSpec` (`source:"builtin"`, `requiresConfirmation:false`) + `ToolCtx.vault` clause; linked §4. Linked §3.3 for `LEO_PREAMBLE` consumer. |
| 3 | F03 wiki-status-slash | §3.1 — UI never reads vault directly; §4 — slash commands invoke tools | Notes implied a slash handler reading vault state, blurring UI/agent boundary | Specified the slash dispatches to a built-in `wiki_status` `ToolSpec`; tool reads vault state via `ToolCtx.vault`. Linked §3.1, §4. |
| 4 | F04 wiki-runtime-utils | §3.2 — agent-layer utilities import zero platform/UI APIs | No explicit layer-discipline note | Added agent-layer purity clause; linked §3.2, §3.4. |
| 5 | F05 wiki-mutex | §6 — state ownership; §10 — concurrency / lifecycle | Mutex state owner not surfaced; plugin-unload behavior not stated | Added in-memory ownership analogy to `AgentRunner`'s in-flight queue; plugin-unload discard. Linked §6, §10. |
| 6 | F06 wiki-widget-framework | §1 — UI→Agent only; §3.1 — React mount/unmount on `ItemView` lifecycle; §6 — chat block payload owned by `ConversationStore` | Snapshot persistence path and live-registry ownership not tied to authoritative architecture sections | Added: terminal snapshot persists via chat block payload owned by `ConversationStore`; `liveControllerRegistry` in-memory, discarded on unload; React mount in `ItemView.onOpen`/`onClose`. Linked §1, §3.1, §6, §10. |
| 7 | F07 wiki-search-warning | §1 — layer order (no UI→data shortcuts) | Notes already said "warning is data, not UI"; added stronger §1 link | Linked §1 to lock the boundary. |
| 8 | F08 wiki-ingest-fetch-persist | §1 — no agent→chat back-edge; §1 / `tech-stack.md` — `interrupt()` for confirmation/pause; §10 — abort wiring | Attachment resolution previously read as a direct `src/chat/` import (back-edge); abort wiring not explicit | Routed attachment resolution through a typed accessor on `ToolCtx`; explicit `LLM.stream({signal})` + `tool.invoke(ctx)` abort threading. Linked §1, §3.4, §10. |
| 9 | F09 wiki-ingest-subagents | §1 — single in-flight global agent request; §10 — fan-out semantics | Intra-tool fan-out vs global single-in-flight not explicitly reconciled | Added: parent agent turn is one in-flight unit; intra-tool concurrency allowed; semaphore inside subgraph. Linked §1. |
| 10 | F10 wiki-ingest-writer | §3.4 — `VaultAdapter`; §7 — error handling | Per-write failure not tied to architectural error model | Wrote: per-write failure surfaces as tool-error in parent FSM; no global rollback. Linked §3.4, §7. |
| 11 | F11 wiki-ingest-subgraph | §1 — single in-flight agent; §4 — `ToolResult`; §7 — no thrown errors escape; §10 — abort + plugin unload | `ToolResult` shape and AbortSignal/unload wiring not explicitly cited | Added: parent turn = one `RunHandle`; standard `ToolResult` shape; abort threading; plugin-unload aborts in-flight runs. Linked §1, §4, §7, §10. |
| 12 | F12 wiki-ingest-tool | §4 — `ToolSpec` contract; §5.3 — confirmation flow; §3.1 — UI never invokes subgraph; §10 — unload | `ToolSpec` fields not enumerated; confirmation flow not anchored | Enumerated `ToolSpec` (`source:"builtin"`, `requiresConfirmation:true`, `schema`, `invoke(input,ctx)`); confirmation on `tool_confirmation` stream-event path; slash → tool, never subgraph; unload via `AgentRunner` cancel + outer `finally`. Linked §3.1, §4, §5.3, §10. |
| 13 | F13 wiki-ingest-conversation | §4 — `ToolSpec` schema extension | Schema extension not tied to `ToolSpec` rules | Added: conversation kind extends `ToolSpec.schema` from F12 under same rules. Linked §4. |
| 14 | F14 wiki-inbox-tool | §4 — `requiresConfirmation` defaults `true` for write-tools | Tool sets `requiresConfirmation:false` (per FR-WIKI-08) but deviation not flagged as documented | Added explicit deviation note tying to FR-WIKI-08 rationale (low-risk additive). Linked §3.4, §4. |
| 15 | F15 wiki-inbox-batch | §1 — single in-flight; mirrors `AgentRunner`'s queue idiom; §10 — abort | Sequential drain not reconciled with global single-in-flight | Added: per-item ingest reuses F11 → single-in-flight holds across batch; queue mirrors `AgentRunner`. Linked §1, §10. |
| 16 | F16 wiki-lint-scan | §3.3 — pure scan; §3.4 — `GraphCache` is the canonical adjacency adapter | Direct `MetadataCache` reads suggested without preferring `GraphCache` | Pointed at `GraphCache` first, fall back to `MetadataCache` only when missing. Linked §3.3, §3.4. |
| 17 | F17 wiki-lint-checkers | §1 — single in-flight | Same fan-out reconciliation as F09 | Mirrored F09 fan-out clause. Linked §1. |
| 18 | F18 wiki-lint-subgraph | §1 — `interrupt()` for confirmation; §4 — `ToolResult`; §10 — abort | `interrupt()` for CONFIRMING and `ToolResult` shape not anchored | Added: CONFIRMING uses `interrupt()`; standard `ToolResult`; abort threading; outer `finally` mutex release. Linked §1, §4, §10. |
| 19 | F19 wiki-lint-tool | §4 — `ToolSpec`; §5.3 — confirmation; §3.1 — UI does not drive subgraph | Same gaps as F12 plus per-schema-patch confirm surface | Mirrored F12 enumeration; added per-schema-patch confirm via the same `confirmationController`. Linked §3.1, §4, §5.3. |

## Architecture sections cross-checked

- **§1 Architectural Principles** — layered deps (UI→Agent→Domain/Adapters→Platform), one-in-flight via `AgentRunner`, interrupt-driven tool flow, registry pattern, fail-safe edits.
- **§3 Modules** — UI / Agent / Domain (pure) / Adapters layering for every feature.
- **§4 Key Contracts** — `ToolSpec`, `ToolCtx`, `ToolResult`, `StreamEvent` for every tool feature.
- **§5.1 Plugin Startup** — bootstrap participation in `onload`.
- **§5.3 Tool Confirmation Flow** — confirmation events for `delegate_wiki_ingest` / `delegate_wiki_lint` / per-schema-patch.
- **§5.6 Cancellation** — `AbortSignal` semantics for both subgraphs.
- **§6 State Ownership** — `WikiMutex`, `liveControllerRegistry`, `WikiTerminalSnapshot` ownership.
- **§7 Error Handling** — `ToolResult` `{ok:false,error}` shape; no thrown errors escape.
- **§10 Concurrency & Lifecycle** — single agent request, mutex release in `finally`, plugin-unload cancel + unmount.

## No architectural deviations remaining

- No agent → chat back-edges (attachments routed via `ToolCtx`).
- No UI → vault back-edges (UI invokes tools, never `VaultAdapter` directly).
- No tools registered outside `ToolRegistry`.
- All confirmation flows ride `tool_confirmation` + `confirmationController`.
- All subgraphs return `ToolResult` shape; no thrown errors escape tool boundary.
- All abort paths thread `AbortSignal` from `AgentRunner` through provider + tool calls.
- All mutex / lock holders release in outermost `try/finally`.
- All chat-block payloads owned by `ConversationStore`; live-registry state in-memory only.

One **documented deviation**: `inbox_add` uses `requiresConfirmation:false` (FR-WIKI-08), explained inline in F14.

## Verdict: COMPLIANT (post-fix)
