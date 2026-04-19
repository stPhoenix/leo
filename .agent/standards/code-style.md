# Code Style

Conventions tuned to Leo stack: TypeScript 5 strict, React 18, Obsidian plugin, LangGraph, Zod, esbuild, Vitest, Tailwind, IndexedDB, CodeMirror 6.

## TypeScript

- `"strict": true`. No `any`. Use `unknown` at boundaries, narrow with Zod.
- No `enum`. Use `as const` string literal unions.
- `import type` for type-only imports. Keeps esbuild tree-shaking tight.
- No default exports. Named exports only — better rename refactors, better tree-shaking.
- Prefer `type` aliases for unions/intersections; `interface` for object shapes extended across modules.
- `readonly` on public fields and array params when not mutated.
- Avoid `!` non-null assertion. Narrow with guards or throw explicit.
- Path alias `@/*` → `src/*`. Configure in `tsconfig.json` and esbuild.
- File names: `camelCase.ts` for modules, `PascalCase.tsx` for React components, `kebab-case.md` for docs.
- One public class/component per file. Helpers colocated below it.

## Zod & Tool Schemas

- One Zod schema per tool input. `z.infer` the TS type — no dual declaration.
- Describe fields with `.describe(...)` — LLM reads these.
- Reject at boundary: `schema.parse()` in adapter, not deep inside core.
- Reuse schemas from a `schemas/` module; never redefine same shape twice.

## React 18

- Function components only. No class components.
- Hooks order: `useState` → `useRef` → derived consts → `useMemo` → `useCallback` → `useEffect`.
- Rules of hooks enforced by ESLint `react-hooks/exhaustive-deps`. Do not suppress without comment citing reason.
- Lift state only when shared. Colocate otherwise.
- `useEffect` cleanup mandatory for subscriptions, timers, Obsidian event listeners.
- Stable props: wrap inline objects/functions in `useMemo`/`useCallback` when passed to memoized children or assistant-ui primitives.
- `key` must be stable id, never array index for reorderable lists.
- Portals for tool-confirmation modals — don't nest inside chat tree.

## Obsidian Plugin Patterns

- All lifecycle wiring in `main.ts` `onload`; tear down in `onunload`. Every `registerEvent` / `addCommand` auto-cleaned by Obsidian — use it, don't hand-roll.
- React roots: mount in `ItemView.onOpen`, `root.unmount()` in `onClose`. Never leak roots across view reopens.
- Never touch `app.vault.adapter` directly — go through `VaultAdapter`.
- Use `MetadataCache` first; read file content only when cache insufficient.
- `Notice` for user-visible errors. `Logger` for everything else.
- No synchronous FS in hot paths — Obsidian API is async; respect it.

## LangGraph / Agent Layer

- State shape defined once as a Zod schema → TS type. Nodes receive typed state.
- Pure nodes where possible. IO nodes isolate side effects.
- Always thread `AbortSignal` through `.stream({ signal })` and into tool `invoke(ctx)`.
- `interrupt()` for any tool with `requiresConfirmation: true`. No ad-hoc event bus.
- Tool results typed: `{ ok: true, data } | { ok: false, error }`. No thrown errors escaping tools.
- Never import `@langchain/core` root — import subpaths (`@langchain/core/messages`, etc.) for bundle size.

## CodeMirror 6

- Extensions composed in one `editor/extensions.ts` — return `Extension[]`.
- State via `StateField`; reactive values via `StateEffect`. No direct `view.state` mutation.
- Decorations built in `RangeSet`, never mutated in place.
- Edit lock: always `try { apply } finally { release }`. Never early-return with lock held.

## Async & Concurrency

- `AbortController` per in-flight request. Pass `signal` to `fetch` and downstream.
- No unhandled promise rejections — every `async` call either awaited, `.catch(logger.error)`, or fire-and-log.
- FIFO via explicit queue module, not ad-hoc `Promise` chains.
- Timeouts explicit on every `fetch`. No bare network calls.
- Debounce indexing with a single shared `debounce` util — don't re-roll.

## Error Handling

- Fail fast at boundaries (Zod parse, FS read). Panic-worthy invariants: `throw new Error` with context string.
- Adapters catch platform errors and surface typed `Result` or `ToolResult`. Core modules trust inputs.
- Every `catch` either handles, re-throws with added context, or logs at `error`. Never swallow silent.
- Release resources (locks, subscriptions, IndexedDB txns) in `finally`.

## Logging

- `Logger` levels: `debug | info | warn | error`. No `console.log` in committed code.
- Structured key/value: `logger.info("rag.query", { k, latencyMs })`.
- No PII or note content in logs beyond debug level.

## Styling (Tailwind + Obsidian)

- Tailwind utilities primary. Custom CSS only when utilities insufficient.
- Scope all styles under plugin root class (e.g. `.leo-root`) to prevent bleed.
- Use Obsidian CSS vars (`var(--text-normal)`, `var(--background-primary)`) over hard-coded colors.
- No `!important` except overriding Obsidian built-ins with a comment citing why.

## IndexedDB (idb)

- One DB, versioned schema. Migrations in `upgrade()` callback, never ad-hoc.
- Wrap all access in a typed `VectorStore` / store module. UI and agent never open DB directly.
- Transactions scoped tight — one logical op per txn. Never hold a txn across `await` on unrelated work.

## Testing (Vitest + msw)

- Test file next to source: `foo.ts` → `foo.test.ts` under `tests/unit/` mirror tree.
- Pure logic → unit tests. HTTP boundaries → `msw` fixtures.
- Arrange / Act / Assert blocks separated by blank lines.
- No real network, no real IndexedDB (use `fake-indexeddb`), no real clock (`vi.useFakeTimers`).
- Snapshot tests only for stable structural output — never for streaming tokens.

## Imports & Module Boundaries

Respect layer rule from architecture.md §2 — UI → Agent → Domain/Adapters → Platform. No back-edges.

- Domain/core modules import zero platform APIs. Enforce with ESLint `no-restricted-imports`.
- No circular deps. Detect with `madge` in CI.
- Barrel `index.ts` only at layer boundaries, not per subfolder (keeps esbuild fast).

## Comments & Docs

- Default: no comment. Well-named identifier beats comment.
- Comment only non-obvious WHY: invariant, workaround, perf constraint, Obsidian quirk.
- No JSDoc on internal functions. Public tool/skill specs get a one-line `description` field (LLM reads it).
- No task/PR references in comments — those rot.

## Formatting

- Prettier owns formatting. Do not hand-format.
- 2-space indent, semicolons on, single quotes, trailing commas `all`, line width 100.
- ESLint + `@typescript-eslint` strict preset. Warnings fail CI.

## Commits

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.
- Subject ≤ 50 chars, imperative. Body explains WHY, not WHAT.
- One logical change per commit. No drive-by reformats.
