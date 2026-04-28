# F12 — Token usage indicator

## Purpose

Surface per-assistant-message token accounting in the chat transcript so the user can see how much of the context budget each turn consumed, tied into the streaming pipeline delivered by [F07](../chat-streaming-stop/feature.md). When the provider stream terminates with a `done` / `usage` event from the LM Studio adapter ([F02](../provider-lmstudio-core/feature.md)), the indicator reads `usage.prompt_tokens` / `usage.completion_tokens` / `usage.total_tokens` and renders them in the assistant message footer; when the provider omits the `usage` block (OpenAI-compatible implementations treat it as optional), the indicator falls back to a rough `Math.ceil(len / 4)` estimate over the rendered text so every completed assistant message still shows input / output / total counts per [FR-CHAT-11](../../context.md#fr-chat-11). Cost-in-$ is intentionally out of scope here and lands with the cloud provider work in F38.

## Scope

### In scope

- A per-assistant-message footer slot rendered inside the [F05](../chat-message-list-markdown/feature.md) message bubble (via the streaming surface from [F07](../chat-streaming-stop/feature.md)) showing three labelled counts: input (prompt), output (completion), and total tokens.
- Usage extraction from the provider terminal stream events emitted by [F02](../provider-lmstudio-core/feature.md) — specifically the `usage` / `done` `StreamEvent` payload with OpenAI-compatible `{prompt_tokens, completion_tokens, total_tokens}` — as the primary source.
- Fallback estimator, activated whenever the provider omits the `usage` block (or emits partial fields): `input ≈ ceil(promptChars / 4)`, `output ≈ ceil(outputChars / 4)`, `total = input + output`; a small visual marker (e.g. `~` prefix) flags estimated values so the user can tell the difference.
- Token counts captured and rendered on `done`, on stream `error` (using whatever tokens streamed before the error), and on cancel from the [F07](../chat-streaming-stop/feature.md) Stop flow (including the "cancelled after N tools" terminal state) so every assistant message footer renders a stable input/output/total triple.
- Footer layout that uses Obsidian CSS variables (no hardcoded colors), degrades cleanly to a single muted line under the ChatView min-width, and stays reachable by keyboard focus from [F05](../chat-message-list-markdown/feature.md)'s bubble traversal.
- Unit coverage for: provider-usage path with all three fields populated, fallback path when `usage` is absent, mixed path when `usage` is partial, cancel/error paths, and the `len/4` estimator boundary values.

### Out of scope

- Cost-in-$ for cloud providers (OpenAI / Anthropic / Ollama / custom) — ships with [F38 cloud-providers-safestorage](../../features-index.md) and turns on only when a cloud provider is configured per [FR-CHAT-11](../../context.md#fr-chat-11).
- The 3-tier token estimator (API usage → hybrid per-block → rough `len/4` with 4/3 multiplier and per-block rules from compact.md §4) — ships with F41 and is adopted by this indicator once available.
- `/context` category breakdown, grid visualization, suggestion engine, and token status line — ship with F46 / F47 / F48.

## Acceptance criteria

1. When the provider stream emitted by [F02](../provider-lmstudio-core/feature.md) terminates with a `usage` payload carrying `prompt_tokens`, `completion_tokens`, and `total_tokens`, the assistant message footer renders three labelled counts (input / output / total) taken verbatim from that payload. (FR-CHAT-11)
2. When the terminal stream event omits the `usage` block, the footer still renders input / output / total, with input and output estimated via `Math.ceil(len / 4)` over the prompt text and the rendered assistant text respectively, total equal to their sum, and a visible marker indicating the values are estimates. (FR-CHAT-11)
3. When `usage` is present but partial (e.g. `total_tokens` missing), the present fields are used verbatim and only the missing fields fall back to the `len/4` estimator; the footer marks only the missing fields as estimated. (FR-CHAT-11)
4. Footer values are captured on stream `done`, on stream `error` (using tokens received up to the error), and on user Stop / "cancelled after N tools" from [F07](../chat-streaming-stop/feature.md), so every completed-or-terminated assistant message renders a stable input/output/total triple. (FR-CHAT-11)
5. Footer markup uses Obsidian CSS variables only (no hardcoded colors), remains legible under the ChatView min-width from [F04](../chat-sidebar-view/feature.md), and stays reachable by keyboard focus consistent with the [F05](../chat-message-list-markdown/feature.md) bubble. (FR-CHAT-11)
6. Cost-in-$ is never rendered in Phase 1 because no cloud provider is configured; the footer exposes only token counts and defers the $ slot to F38. (FR-CHAT-11)
7. Unit suite covers: full-usage provider path, missing-usage fallback path, partial-usage mixed path, cancel and error paths, and `len/4` estimator values at empty, single-char, 4-char, and 5-char boundaries. (FR-CHAT-11)

## Dependencies

- [F07 chat-streaming-stop](../chat-streaming-stop/feature.md) — owns the streaming pipeline and terminal-event plumbing (`done` / `error` / cancel) that this feature hooks into to read provider `usage` and commit the footer.
- Drives requirement [FR-CHAT-11](../../context.md#fr-chat-11).

## Implementation notes

- [Architecture §3.1 UI Layer — ChatView](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) hosts the footer inside the assistant bubble.
- [Architecture §4 Key Contracts — StreamEvent](../../../../architecture/architecture.md#4-key-contracts) fixes the `usage` / `done` event shape consumed here.
- [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools) anchors the terminal-event commit point.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) governs teardown on view unmount.
- [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) and [Agent Layer](../../../../standards/tech-stack.md#agent-layer) pin React 18 and the SSE client.
- [Code style — React 18](../../../../standards/code-style.md#react-18), [Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian), [Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw).
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles).

## Open questions

- None. Acceptance criteria and implementation notes exhaust this feature's scope; no decisions are deferred at this slice.
