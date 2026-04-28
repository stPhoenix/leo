import type { RagSnapshot } from '@/rag/ragSnapshot';
import type { IndexerPhase } from '@/indexer/indexerStatusTap';
import { registerWidget, type WidgetComponentProps } from './registry';

export interface RagWidgetPayload {
  readonly snapshot: RagSnapshot;
}

export function RagWidget({ props }: WidgetComponentProps): JSX.Element {
  const payload = props as RagWidgetPayload;
  return <RagWidgetBody snapshot={payload.snapshot} />;
}

interface BodyProps {
  readonly snapshot: RagSnapshot;
}

function RagWidgetBody({ snapshot }: BodyProps): JSX.Element {
  const variant = pickVariant(snapshot);
  return (
    <section
      className={`leo-rag-widget is-variant-${variant}`}
      data-slot="rag-widget"
      data-variant={variant}
      aria-label="RAG index status"
    >
      <RagWidgetHeader variant={variant} />
      {variant === 'unavailable' ? (
        <RagUnavailable snapshot={snapshot} />
      ) : (
        <>
          {snapshot.indexerStatus.phase === 'draining' ? (
            <RagProgressRow snapshot={snapshot} />
          ) : null}
          {variant === 'empty' ? <RagEmpty snapshot={snapshot} /> : null}
          {variant === 'idle' || variant === 'indexing' ? (
            <RagStatTable snapshot={snapshot} />
          ) : null}
          {variant === 'paused' || variant === 'errored' ? <RagAlert snapshot={snapshot} /> : null}
          {variant === 'paused' || variant === 'errored' ? (
            <RagStatTable snapshot={snapshot} />
          ) : null}
        </>
      )}
    </section>
  );
}

type RagVariant = 'idle' | 'indexing' | 'empty' | 'unavailable' | 'paused' | 'errored';

function pickVariant(snapshot: RagSnapshot): RagVariant {
  if (!snapshot.storeAvailable) return 'unavailable';
  const phase = snapshot.indexerStatus.phase;
  if (phase === 'paused-on-user') return 'paused';
  if (phase === 'errored') return 'errored';
  if (phase === 'draining') return 'indexing';
  if (snapshot.chunkCount === 0) return 'empty';
  return 'idle';
}

function badgeLabel(variant: RagVariant): string {
  if (variant === 'idle') return 'available';
  if (variant === 'indexing') return 'indexing';
  if (variant === 'empty') return 'empty';
  if (variant === 'unavailable') return 'unavailable';
  if (variant === 'paused') return 'paused';
  return 'error';
}

function RagWidgetHeader({ variant }: { readonly variant: RagVariant }): JSX.Element {
  return (
    <header className="leo-rag-widget-head">
      <span className="leo-rag-widget-title">RAG · index status</span>
      <span
        className={`leo-rag-widget-badge is-variant-${variant}`}
        data-slot="rag-badge"
        data-variant={variant}
      >
        {badgeLabel(variant)}
      </span>
    </header>
  );
}

function RagProgressRow({ snapshot }: BodyProps): JSX.Element {
  const path = snapshot.indexerStatus.currentPath;
  const base = path !== null ? basename(path) : null;
  return (
    <div className="leo-rag-widget-progress" data-slot="rag-progress">
      <span className="leo-rag-widget-progress-spinner" aria-hidden="true">
        ⟳
      </span>
      <span className="leo-rag-widget-progress-text">
        Indexing… {fmt(snapshot.indexerStatus.remaining)} files left
        {base !== null ? ` · ${base}` : ''}
      </span>
    </div>
  );
}

function RagUnavailable({ snapshot }: BodyProps): JSX.Element {
  const reason = snapshot.storeUnavailableReason ?? 'unavailable';
  return (
    <div className="leo-rag-widget-unavailable" data-slot="rag-unavailable" role="alert">
      <span className="leo-rag-widget-unavailable-icon" aria-hidden="true">
        ⚠
      </span>
      <div className="leo-rag-widget-unavailable-body">
        <div className="leo-rag-widget-unavailable-headline">RAG unavailable — {reason}</div>
        <div className="leo-rag-widget-unavailable-hint">
          The vector store could not be opened. Try Re-index from Settings → Leo → Index.
        </div>
        {renderIndexerLine(snapshot.indexerStatus.phase, snapshot.indexerStatus.lastError)}
      </div>
    </div>
  );
}

function RagAlert({ snapshot }: BodyProps): JSX.Element {
  const phase = snapshot.indexerStatus.phase;
  const headline = phase === 'paused-on-user' ? 'Indexer paused' : 'Indexer error';
  const detail = snapshot.indexerStatus.lastError ?? '';
  return (
    <div className="leo-rag-widget-alert" data-slot="rag-alert" data-phase={phase} role="status">
      <span className="leo-rag-widget-alert-icon" aria-hidden="true">
        ⏸
      </span>
      <div className="leo-rag-widget-alert-body">
        <div className="leo-rag-widget-alert-headline">{headline}</div>
        {detail !== '' ? <div className="leo-rag-widget-alert-detail">{detail}</div> : null}
      </div>
    </div>
  );
}

function RagEmpty({ snapshot }: BodyProps): JSX.Element {
  return (
    <div className="leo-rag-widget-empty" data-slot="rag-empty">
      <div className="leo-rag-widget-empty-headline">No notes indexed yet.</div>
      <RagStatTable snapshot={snapshot} dimmed />
    </div>
  );
}

interface StatTableProps extends BodyProps {
  readonly dimmed?: boolean;
}

function RagStatTable({ snapshot, dimmed = false }: StatTableProps): JSX.Element {
  const rows: { label: string; value: string }[] = [
    { label: 'Files indexed', value: fmt(snapshot.filesIndexed) },
    { label: 'Chunks', value: fmt(snapshot.chunkCount) },
    {
      label: 'Embedding model',
      value: snapshot.model ?? '—',
    },
    { label: 'Vector dimension', value: snapshot.dim !== null ? fmt(snapshot.dim) : '—' },
    {
      label: 'Vector bytes (approx)',
      value: snapshot.vectorBytesApprox > 0 ? `≈ ${fmtBytes(snapshot.vectorBytesApprox)}` : '—',
    },
    { label: 'Graph nodes', value: fmt(snapshot.graphNodeCount) },
    { label: 'Exclude patterns', value: fmt(snapshot.excludePatternCount) },
  ];
  if (snapshot.textBytesApprox !== null && snapshot.textBytesApprox > 0) {
    rows.splice(5, 0, {
      label: 'Text bytes (approx)',
      value: `≈ ${fmtBytes(snapshot.textBytesApprox)}`,
    });
  }
  return (
    <ul
      className={`leo-rag-widget-stats${dimmed ? ' is-dimmed' : ''}`}
      data-slot="rag-stats"
      aria-label="RAG statistics"
    >
      {rows.map((row) => (
        <li key={row.label} className="leo-rag-widget-stat-row">
          <span className="leo-rag-widget-stat-label">{row.label}</span>
          <span className="leo-rag-widget-stat-value">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

function renderIndexerLine(phase: IndexerPhase, lastError: string | null): JSX.Element | null {
  if (phase === 'idle' || phase === 'draining') return null;
  if (lastError === null) return null;
  return (
    <div className="leo-rag-widget-unavailable-indexer">
      Indexer: <span className="leo-rag-widget-unavailable-indexer-detail">{lastError}</span>
    </div>
  );
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

registerWidget('rag', RagWidget);
