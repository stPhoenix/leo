import type { CanvasStatus } from '@/agent/canvas/canvasStatus';
import { CANVAS_STATUS_WIDGET_KIND } from '@/ui/canvasStatusCommand';
import { registerWidget, type WidgetComponentProps } from './registry';

export interface CanvasStatusWidgetPayload {
  readonly status: CanvasStatus;
}

export function CanvasStatusWidget({ props }: WidgetComponentProps): JSX.Element {
  const payload = props as CanvasStatusWidgetPayload;
  return <CanvasStatusBody status={payload.status} />;
}

interface BodyProps {
  readonly status: CanvasStatus;
}

function CanvasStatusBody({ status }: BodyProps): JSX.Element {
  const empty = status.activeRuns.length === 0 && status.recentSidecars.length === 0;
  return (
    <section
      className="leo-canvas-status-widget"
      data-slot="canvas-status-widget"
      aria-label="Canvas status"
    >
      <header className="leo-canvas-status-header">
        <span className="leo-canvas-status-title">Canvas status</span>
      </header>
      {status.sidecarDirError !== null ? (
        <p className="leo-canvas-status-error" data-slot="canvas-status-error">
          Sidecar dir unreadable: {status.sidecarDirError}
        </p>
      ) : null}
      {empty && status.sidecarDirError === null ? (
        <p className="leo-canvas-status-empty" data-slot="canvas-status-empty">
          No canvas runs yet.
        </p>
      ) : null}
      {status.activeRuns.length > 0 ? (
        <section className="leo-canvas-status-section">
          <h3>Active runs ({status.activeRuns.length})</h3>
          <ul className="leo-canvas-status-active" data-slot="canvas-status-active">
            {status.activeRuns.map((r) => (
              <li key={r.runId}>
                <code>{r.path}</code> · {r.op} · runId={r.runId}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {status.recentSidecars.length > 0 ? (
        <section className="leo-canvas-status-section">
          <h3>Recent canvases ({status.recentSidecars.length})</h3>
          <ul className="leo-canvas-status-sidecars" data-slot="canvas-status-sidecars">
            {status.recentSidecars.map((s) => (
              <li key={s.slug}>
                <strong>{s.leaf}</strong> · last run {s.lastRunAt} · runId={s.runId}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

registerWidget(CANVAS_STATUS_WIDGET_KIND, CanvasStatusWidget);
