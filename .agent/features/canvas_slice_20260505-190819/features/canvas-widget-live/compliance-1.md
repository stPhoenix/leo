# Compliance iteration 1 — F17 canvas-widget-live

## Standards

- **tech-stack.md** — React 18 function components; `useSyncExternalStore` for live-controller subscription; Lucide icons not needed for first cut (text-only); Storybook fixtures supplied.
- **code-style.md** — Function components only; hooks order respected; named exports; no `any`; `import type` for type-only; `useEffect` cleanup on elapsed timer; portals not needed (widget renders inline).
- **best-practices.md** — KISS (controller mirrors `WikiWidgetController` 1:1); SRP (state.ts / controller.ts / live registry / live block / widget split); Make-It-Observable (data-slot/data-phase attributes); listener exceptions isolated.
- **project-structure.md** — files placed under `src/agent/canvas/widget/` + `src/agent/canvas/liveControllerRegistry.ts` + `src/ui/chat/blocks/Canvas*`; tests under `tests/unit/canvas/`.

## Verdict: PASS
