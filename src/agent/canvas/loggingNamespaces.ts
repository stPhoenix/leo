const sharedPhases = (root: 'create' | 'contentEdit' | 'layoutEdit') =>
  ({
    transition: `canvas.${root}.subgraph.transition`,
    cancelled: `canvas.${root}.subgraph.cancelled`,
    refine: {
      start: `canvas.${root}.refine.start`,
      done: `canvas.${root}.refine.done`,
      failed: `canvas.${root}.refine.failed`,
    },
    plan: {
      start: `canvas.${root}.plan.start`,
      done: `canvas.${root}.plan.done`,
    },
    fetch: {
      start: `canvas.${root}.fetch.start`,
      done: `canvas.${root}.fetch.done`,
      failed: `canvas.${root}.fetch.failed`,
    },
    extract: {
      start: `canvas.${root}.extract.start`,
      done: `canvas.${root}.extract.done`,
      failed: `canvas.${root}.extract.failed`,
    },
    reduce: {
      start: `canvas.${root}.reduce.start`,
      done: `canvas.${root}.reduce.done`,
      failed: `canvas.${root}.reduce.failed`,
    },
    diff: {
      start: `canvas.${root}.diff.start`,
      done: `canvas.${root}.diff.done`,
    },
    layout: {
      start: `canvas.${root}.layout.start`,
      done: `canvas.${root}.layout.done`,
    },
    preview: {
      write: `canvas.${root}.preview.write`,
    },
    write: {
      start: `canvas.${root}.write.start`,
      done: `canvas.${root}.write.done`,
      failed: `canvas.${root}.write.failed`,
    },
    mutex: {
      acquire: `canvas.${root}.mutex.acquire`,
      release: `canvas.${root}.mutex.release`,
      busy: `canvas.${root}.mutex.busy`,
    },
    cancel: `canvas.${root}.cancel`,
    error: `canvas.${root}.error`,
  }) as const;

/**
 * Canonical Logger event namespaces for the canvas slice.
 *
 * NFR-CANVAS-03: state transitions + per-source / per-entity events at `debug`
 * under `canvas.create.*` / `canvas.contentEdit.*` / `canvas.layoutEdit.*` /
 * `canvas.reveal.*`. Errors at `error`. Source content + extractor outputs MUST
 * NOT appear above `debug` (mirrors `WIKI_SENSITIVE_FIELD_KEYS` policy).
 */
export const CANVAS_LOG = {
  create: sharedPhases('create'),
  contentEdit: sharedPhases('contentEdit'),
  layoutEdit: sharedPhases('layoutEdit'),
  reveal: {
    probe: {
      ok: 'canvas.reveal.probe.ok',
      fail: 'canvas.reveal.probe.fail',
    },
    invoke: {
      ok: 'canvas.reveal.invoke.ok',
      fail: 'canvas.reveal.invoke.fail',
    },
    openCanvas: {
      opened: 'canvas.reveal.openCanvas.opened',
      revealed: 'canvas.reveal.openCanvas.revealed',
      error: 'canvas.reveal.openCanvas.error',
    },
    unknownNodeIds: 'canvas.reveal.unknownNodeIds',
    error: 'canvas.reveal.error',
  },
} as const;

export type CanvasLogTree = typeof CANVAS_LOG;

/**
 * Field keys carrying user-content. Lint policy must reject any of these
 * appearing in `info|warn|error` log calls (mirrors wiki + external-agent
 * pattern). Sink redactor strips them at `info+`.
 */
export const CANVAS_SENSITIVE_FIELD_KEYS: readonly string[] = [
  'rawSource',
  'extractorOutput',
  'reducerOutput',
  'refineMessages',
  'sidecarBody',
];
