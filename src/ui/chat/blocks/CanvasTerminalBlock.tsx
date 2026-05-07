import { memo, useState } from 'react';
import {
  CANVAS_TERMINAL_KIND,
  tryParseCanvasTerminalSnapshot,
  type CanvasTerminalSnapshot,
} from '@/agent/canvas/widget/terminalSnapshot';
import { CANVAS_PALETTES } from '@/agent/canvas/layouts/colorPalette';
import type { CanvasPaletteId } from '@/agent/canvas/layouts/colorPalette';
import { registerWidget, type WidgetComponentProps } from '../widgets/registry';

export interface CanvasTerminalActions {
  readonly onOpenCanvas?: (path: string) => void;
}

let actions: CanvasTerminalActions = {};

export function setCanvasTerminalActions(next: CanvasTerminalActions): void {
  actions = next;
}

function CanvasTerminalBlockImpl({ props }: WidgetComponentProps): JSX.Element | null {
  const snapshot = tryParseCanvasTerminalSnapshot(props);
  if (snapshot === null) {
    return (
      <section
        className="leo-canvas-terminal-invalid"
        data-slot="canvas-terminal-invalid"
        aria-label="Canvas run snapshot invalid or outdated"
      >
        <p>This canvas run was recorded with an older snapshot format and cannot be rendered.</p>
      </section>
    );
  }
  return <CanvasTerminalView snapshot={snapshot} />;
}

function CanvasTerminalView({
  snapshot,
}: {
  readonly snapshot: CanvasTerminalSnapshot;
}): JSX.Element {
  const [expanded, setExpanded] = useState(snapshot.outcome === 'error');
  const summary = collapsedSummary(snapshot);
  return (
    <section
      className={`leo-canvas-terminal-block leo-canvas-terminal-${snapshot.outcome}`}
      data-slot="canvas-terminal-block"
      data-outcome={snapshot.outcome}
      data-op={snapshot.op}
      aria-label={`Canvas ${snapshot.op} run ${snapshot.runId} ended ${snapshot.outcome}`}
    >
      <button
        type="button"
        className="leo-canvas-terminal-toggle"
        data-slot="canvas-terminal-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {summary}
      </button>
      {expanded ? <ExpandedBody snapshot={snapshot} /> : null}
    </section>
  );
}

function collapsedSummary(s: CanvasTerminalSnapshot): string {
  const dur = `${(s.durationMs / 1000).toFixed(1)}s`;
  if (s.outcome === 'done') {
    return `Canvas ${s.op} · ${s.targetPath} · ${s.nodeCount} nodes · ${s.edgeCount} edges · ${dur}`;
  }
  if (s.outcome === 'cancelled') return `Canvas ${s.op} cancelled · ${s.targetPath} · ${dur}`;
  return `Canvas ${s.op} error · ${s.error?.code ?? 'unknown'} · ${dur}`;
}

function ExpandedBody({ snapshot: s }: { readonly snapshot: CanvasTerminalSnapshot }): JSX.Element {
  return (
    <div className="leo-canvas-terminal-body" data-slot="canvas-terminal-body">
      <dl>
        <dt>Run id</dt>
        <dd>{s.runId}</dd>
        <dt>Op</dt>
        <dd>{s.op}</dd>
        <dt>Phase at terminal</dt>
        <dd>{s.phaseAtTerminal}</dd>
        <dt>Duration</dt>
        <dd>{(s.durationMs / 1000).toFixed(1)}s</dd>
        <dt>Target</dt>
        <dd>
          <code>{s.targetPath}</code>{' '}
          {s.outcome === 'done' ? (
            <button
              type="button"
              data-slot="canvas-terminal-open"
              onClick={() => actions.onOpenCanvas?.(s.targetPath)}
            >
              Open canvas
            </button>
          ) : null}
        </dd>
        {s.paletteId !== undefined ? (
          <>
            <dt>Palette</dt>
            <dd data-slot="canvas-terminal-palette">{paletteLabelFor(s.paletteId)}</dd>
          </>
        ) : null}
        {s.insights !== undefined ? (
          <>
            <dt>Hubs</dt>
            <dd>{s.insights.hubs.length}</dd>
            <dt>Components</dt>
            <dd>{s.insights.components.count}</dd>
            <dt>Per-type counts</dt>
            <dd>
              {Object.entries(s.insights.perTypeCount)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ')}
            </dd>
          </>
        ) : null}
        {s.error !== undefined ? (
          <>
            <dt>Error</dt>
            <dd>
              <code>{s.error.code}</code>: {s.error.message}
            </dd>
          </>
        ) : null}
      </dl>
      {s.failedSources.length > 0 ? (
        <ul className="leo-canvas-terminal-failed" data-slot="canvas-terminal-failed">
          {s.failedSources.map((src) => (
            <li key={src.ref}>
              <code>{src.ref}</code> — {src.code}: {src.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function paletteLabelFor(id: string): string {
  return CANVAS_PALETTES.get(id as CanvasPaletteId)?.label ?? id;
}

export const CanvasTerminalBlock = memo(CanvasTerminalBlockImpl);

registerWidget(CANVAS_TERMINAL_KIND, CanvasTerminalBlock);
