# F01 — Plugin bootstrap & rotating log

## Purpose

Deliver the foundation layer of the Leo plugin: a clean Obsidian `Plugin` lifecycle (`onload` / `onunload`) that wires a leveled, structured `Logger` whose levels are gated by the configured `logLevel` per [NFR-LOG-01](../../context.md#nfr-log-01), persists output to a rotating file at `.leo/logs/leo.log` per [NFR-LOG-02](../../context.md#nfr-log-02), surfaces user-visible errors through Obsidian `Notice` + status bar per [NFR-LOG-03](../../context.md#nfr-log-03), and exposes structured key/value logging suitable for indexing, provider, tool, and MCP callsites per [NFR-LOG-04](../../context.md#nfr-log-04). This feature has no dependencies and is the substrate every later feature relies on for observability.

## Scope

### In scope

- Obsidian `Plugin` subclass with `onload` / `onunload` wired to initialize and tear down the `Logger`, flush buffered log writes on unload, and register lifecycle cleanup via Obsidian's auto-cleanup APIs.
- `Logger` module exposing `debug`, `info`, `warn`, `error` methods that accept a structured key/value payload (`logger.info("rag.query", { k, latencyMs })`).
- `logLevel` setting (default `info`) read from Obsidian plugin data; level gating applied before any write or `console.*` call.
- Rotating file writer at `<vault>/.leo/logs/leo.log` with a 1 MB size threshold per file and up to 5 rotated siblings (`leo.log.1` … `leo.log.5`).
- User-visible error surface: `Logger.error` routes a short message to `Notice` and updates a persistent status-bar item when configured as a user-facing error.
- Creation of `.leo/` and `.leo/logs/` directories on first load if absent.
- Minimal unit coverage for level gating, rotation size/count math, and `Notice`/status-bar routing.

### Out of scope

- Provider retry / timeout / backoff log events (ship with F02 `provider-lmstudio-core`).
- Indexing progress logs, index-header mismatch prompts, and status-bar progress widget (ship with F27 `vault-indexer-dirty-queue` and F30 `indexer-ui-controls`).
- Tool-invocation log events (ship with F16 `tool-registry-builtin-read` and subsequent tool features).
- MCP event logs (ship with F51 `mcp-client-config-transports`).
- Settings-tab UI for toggling `logLevel` (ships with F03 `settings-tab-scaffold`); in this feature the setting is read-only from plugin data.
- Telemetry, log shipping, or any network egress from the logger — forbidden by [NFR-DATA-03](../../context.md) and out of scope for v1.

## Acceptance criteria

1. `Plugin.onload` completes successfully on a fresh vault, creating `.leo/` and `.leo/logs/` if missing, and `Plugin.onunload` flushes pending log writes and releases the log file handle without leaking event listeners. (NFR-LOG-02)
2. `Logger.debug|info|warn|error` calls are dropped when the call's level is below the configured `logLevel`; when `logLevel === 'info'` (default), `debug` is suppressed and `info|warn|error` are emitted. (NFR-LOG-01)
3. Each emitted log line reaches both the Electron `console` channel matching its level (`console.debug|info|warn|error`) and the rotating file sink, with identical payload shape. (NFR-LOG-01, NFR-LOG-02)
4. The file sink at `<vault>/.leo/logs/leo.log` rotates once the active file would exceed 1 MB: the active file is renamed to `leo.log.1` (existing `.1` → `.2`, …, `.5` overwritten) and a new `leo.log` is started; never more than five rotated siblings exist. (NFR-LOG-02)
5. Calling `Logger.error` with a `userFacing: true` (or equivalent) flag displays an Obsidian `Notice` and updates a persistent status-bar item; `info` / `debug` / `warn` never raise a `Notice`. (NFR-LOG-03)
6. `Logger.<level>(event, fields)` serializes `fields` as a structured key/value record (e.g. JSON) alongside a stable `event` name, so downstream callsites (indexing, provider, tool, MCP) can attach arbitrary structured context without string-interpolation. (NFR-LOG-04)
7. Unit tests cover: level gating truth table for each configured `logLevel`; rotation triggers at the 1 MB boundary and caps at 5 siblings; `Notice` + status-bar path fires only for user-facing errors; structured payload round-trips through the file sink. (NFR-LOG-01, NFR-LOG-02, NFR-LOG-03, NFR-LOG-04)

## Dependencies

None (foundation feature). Drives directly from [NFR-LOG-01](../../context.md#nfr-log-01), [NFR-LOG-02](../../context.md#nfr-log-02), [NFR-LOG-03](../../context.md#nfr-log-03), [NFR-LOG-04](../../context.md#nfr-log-04). See also the [features index](../../features-index.md) for downstream consumers (F02, F04, F08, F21, F27, F51, …) that will call into this `Logger`.

## Implementation notes

- [Architecture §3.4 Adapters — Logger](../../../../architecture/architecture.md#34-adapters) — places `Logger` in the adapter layer writing to the vault FS; this feature implements that row.
- [Architecture §6 State Ownership — Logs](../../../../architecture/architecture.md#6-state-ownership) — mandates `.leo/logs/leo.log*` as the on-disk ownership; rotation scheme follows that row.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — requires `plugin.onunload` to flush the logger; the unload path here must comply.
- [Architecture §5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup) — shows `onload` kicks async work in parallel; `Logger` initialization must be synchronous and complete before any other adapter logs.
- [Tech stack — Storage Layout](../../../../standards/tech-stack.md#storage-layout) — pins the exact file tree (`leo.log` plus `leo.log.1 … .5`) this feature must produce.
- [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — names `Notice` and `addStatusBarItem` as the user-error channels used by `Logger.error`.
- [Code style — Logging](../../../../standards/code-style.md#logging) — fixes the four levels, forbids `console.log` in committed code, and mandates structured key/value payloads with no PII beyond `debug`.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — requires lifecycle wiring in `main.ts` `onload` and teardown in `onunload`; this feature establishes that entry point for the plugin.
- [Code style — Error Handling](../../../../standards/code-style.md#error-handling) — requires release of resources in `finally`; applies to the file-sink handle and rotation renames.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — governs the unit tests called out in AC7 (no real clock, no real FS in pure-logic tests; file-sink tests use a fake vault).
- [Best practices — Make It Observable](../../../../standards/best-practices.md#core-principles) — structured logs at meaningful checkpoints justify the `event + fields` API required by NFR-LOG-04.

## Open questions

- `logLevel` for provider retry events (global SRS open question under [NFR-LOG-01](../../context.md#open-questions)) is not resolved here; F02 should pick the level when it lands, and this feature only exposes the API.
- Should the rotating log also deduplicate tight error bursts (e.g. during an LM Studio outage) to avoid pathological rotation churn, or is the 1 MB × 5 cap sufficient on its own? No SRS guidance; defaulting to "no dedupe" unless verification flags it.
- On `onunload`, if the last write is mid-flight when Obsidian closes, do we block unload briefly or drop the tail? Suggest a short bounded flush (e.g. 250 ms) with drop-and-log on timeout, pending confirmation.
