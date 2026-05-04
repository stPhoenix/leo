import type { WikiStatus } from '@/agent/wiki/wikiStatus';
import { WIKI_STATUS_WIDGET_KIND } from '@/ui/wikiStatusCommand';
import { registerWidget, type WidgetComponentProps } from './registry';

export interface WikiStatusWidgetPayload {
  readonly status: WikiStatus;
}

export function WikiStatusWidget({ props }: WidgetComponentProps): JSX.Element {
  const payload = props as WikiStatusWidgetPayload;
  return <WikiStatusBody status={payload.status} />;
}

interface BodyProps {
  readonly status: WikiStatus;
}

function WikiStatusBody({ status }: BodyProps): JSX.Element {
  const mutex = renderMutex(status);
  const lint = status.lastLintTimestamp ?? 'never';
  return (
    <section
      className="leo-wiki-status-widget"
      data-slot="wiki-status-widget"
      data-mutex={status.mutexState.kind}
      aria-label="Wiki status"
    >
      <header className="leo-wiki-status-header">
        <span className="leo-wiki-status-title">Wiki status</span>
      </header>
      <table className="leo-wiki-status-table">
        <tbody>
          <tr>
            <th scope="row">Index pages</th>
            <td data-stat="page-count">{status.indexPageCount}</td>
          </tr>
          <tr>
            <th scope="row">Index size</th>
            <td data-stat="index-size">{formatBytes(status.indexSizeBytes)}</td>
          </tr>
          <tr>
            <th scope="row">Last lint</th>
            <td data-stat="last-lint">{lint}</td>
          </tr>
          <tr>
            <th scope="row">Orphan pages</th>
            <td data-stat="orphan-pages">{status.orphanPageCount}</td>
          </tr>
          <tr>
            <th scope="row">Orphan raw</th>
            <td data-stat="orphan-raw">{status.orphanRawCount}</td>
          </tr>
          <tr>
            <th scope="row">Mutex</th>
            <td data-stat="mutex">{mutex}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function renderMutex(status: WikiStatus): string {
  if (status.mutexState.kind === 'idle') return 'idle';
  return `${status.mutexState.op} ${status.mutexState.runId}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

registerWidget(WIKI_STATUS_WIDGET_KIND, WikiStatusWidget);
