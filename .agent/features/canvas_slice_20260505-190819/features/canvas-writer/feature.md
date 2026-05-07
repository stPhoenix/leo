# F15 · canvas-writer — Preview write + atomic + sidecar persist

## Purpose

Two-step writer: PREVIEWING phase writes the rendered `CanvasJson` to `<targetPath>.preview.canvas` (atomic tmp + rename); WRITING phase renames the preview to the final `<targetPath>` and persists the sidecar. Enforces target-exists guard for `delegate_canvas_create` (FR-CANVAS-43). Cleans up preview file on cancel/error. Atomic rename guarantees never-half-renamed canvases per FR-CANVAS-50.

Covers [FR-CANVAS-38](../../context.md#functional-requirements) (preview write), [FR-CANVAS-41](../../context.md#functional-requirements), [FR-CANVAS-43](../../context.md#functional-requirements), [FR-CANVAS-50](../../context.md#functional-requirements) (atomic), [NFR-CANVAS-05](../../context.md#non-functional-requirements) (preview cleanup), [NFR-CANVAS-12](../../context.md#non-functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/writer.ts` exporting:
  - `writePreview({ adapter, targetPath, canvasJson }) → Result<{ previewPath: string }>` — writes `<targetPath>.preview.canvas` atomically (tmp + rename).
  - `commitPreview({ adapter, previewPath, targetPath }) → Result<void>` — atomic rename to final.
  - `cleanupPreview({ adapter, previewPath }) → Promise<void>` — best-effort delete; idempotent.
  - `writeSidecarFromState({ adapter, sidecar }) → Result<void>` — wraps F07 sidecar writer; called only post-`commitPreview` success.
  - `assertTargetDoesNotExist({ adapter, targetPath }) → Result<void, 'target_path_exists'>` — pre-flight for `delegate_canvas_create` (FR-CANVAS-43).
- Path validation: every writer entry-point rejects via `validateVaultRelativePath` (F01); only `.canvas` extension accepted; sidecar paths confined to `.leo/canvas/runs/`.
- Atomic semantics: on `tmp + rename` rename failure, leave no orphan files (delete tmp).

**Out of scope**

- Coord-map construction — F13 emits the canvas JSON; F14 + F13 jointly produce coords; writer just persists.
- Sidecar shape — F07.
- Mutex acquisition — F06.

## Acceptance criteria

1. `writePreview` produces `<targetPath>.preview.canvas`; the file parses to the same `CanvasJson` (round-trip stable) — traces to FR-CANVAS-38.
2. `commitPreview` renames preview to target; preview no longer exists; target parses identically — traces to FR-CANVAS-41.
3. `commitPreview` failure (target locked, etc.) leaves preview intact — caller can retry — traces to FR-CANVAS-50.
4. `cleanupPreview` removes preview if present; calling twice does not throw — traces to NFR-CANVAS-05.
5. `assertTargetDoesNotExist` returns `Err('target_path_exists')` when path exists — traces to FR-CANVAS-43.
6. `writeSidecarFromState` only writes after `commitPreview` resolves; on `commitPreview` failure, sidecar is **not** updated — traces to FR-CANVAS-53 (last-success sidecar remains).
7. Path validator rejects non-`.canvas` target paths and sidecar paths outside `.leo/canvas/runs/` — traces to NFR-CANVAS-12.
8. During cancel mid-WRITING, the in-flight rename completes and sidecar writes before the FSM driver flips to CANCELLED (driver enforces; writer's contract is "commit is uninterruptible") — traces to FR-CANVAS-50.

## Dependencies

- [../canvas-json/feature.md](../canvas-json/feature.md) — `CanvasJson` parse/serialize, path validators.
- [../canvas-sidecar/feature.md](../canvas-sidecar/feature.md) — sidecar serialization.
- [../canvas-layouts/feature.md](../canvas-layouts/feature.md) — produces `CanvasJson` input.
- Forward consumers: [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md), [../canvas-widget-live/feature.md](../canvas-widget-live/feature.md) (preview link).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-38, FR-CANVAS-41, FR-CANVAS-43, FR-CANVAS-50; [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-05, NFR-CANVAS-12.

## Implementation notes

- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — adapter rule: never `app.vault.adapter` directly.
- [../../../../architecture/architecture.md#7-error-handling-strategy](../../../../architecture/architecture.md#7-error-handling-strategy) — typed `Result` boundary.
- [../../../../architecture/architecture.md#10-concurrency--lifecycle-rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — atomic rename + finally cleanup.
- [../../../../standards/code-style.md#error-handling](../../../../standards/code-style.md#error-handling) — `try / finally` mandatory; idempotent cleanup.
- [../../../../standards/code-style.md#async--concurrency](../../../../standards/code-style.md#async--concurrency) — `tmp + rename` pattern matches `vectorStore.ts` precedent.

## Open questions

- Should `commitPreview` retry on transient rename failure? Once, with a short backoff, similar to `vectorStore.ts`. Defer second-retry to v2.
- Should sidecar write also be atomic (tmp + rename)? Yes — F07 already specifies this.
