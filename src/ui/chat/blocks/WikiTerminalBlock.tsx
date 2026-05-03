import { memo, useState } from 'react';
import {
  WIKI_TERMINAL_KIND,
  tryParseWikiTerminalSnapshot,
  type WikiTerminalSnapshot,
} from '@/agent/wiki/terminalSnapshot';
import { registerWidget, type WidgetComponentProps } from '../widgets/registry';

function WikiTerminalBlockImpl({ props }: WidgetComponentProps): JSX.Element | null {
  const snapshot = tryParseWikiTerminalSnapshot(props);
  if (snapshot === null) {
    return (
      <section
        className="leo-wiki-terminal-invalid"
        data-slot="wiki-terminal-invalid"
        aria-label="Wiki run snapshot invalid or outdated"
      >
        <p>This wiki run was recorded with an older snapshot format and cannot be rendered.</p>
      </section>
    );
  }
  return <WikiTerminalView snapshot={snapshot} />;
}

function WikiTerminalView({ snapshot }: { snapshot: WikiTerminalSnapshot }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const summary = collapsedSummary(snapshot);
  return (
    <section
      className={`leo-wiki-terminal-block leo-wiki-terminal-${snapshot.terminalPhase}`}
      data-slot="wiki-terminal-block"
      data-phase={snapshot.terminalPhase}
      data-op={snapshot.op}
      aria-label={`Wiki ${snapshot.op} run ${snapshot.runId} ended ${snapshot.terminalPhase}`}
    >
      <button
        type="button"
        className="leo-wiki-terminal-toggle"
        data-slot="wiki-terminal-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {summary}
      </button>
      {expanded ? <ExpandedBody snapshot={snapshot} /> : null}
    </section>
  );
}

function collapsedSummary(s: WikiTerminalSnapshot): string {
  const dur = `${(s.durationMs / 1000).toFixed(1)}s`;
  if (s.op === 'ingest') {
    if (s.terminalPhase === 'done') {
      return `Wiki ingest done · ${s.pagesCreated} created, ${s.pagesEdited} edited, ${s.sourcesPersisted} sources · ${dur}`;
    }
    if (s.terminalPhase === 'cancelled') return `Wiki ingest cancelled · ${dur}`;
    return `Wiki ingest error · ${s.error?.code ?? 'unknown'} · ${dur}`;
  }
  if (s.terminalPhase === 'done') {
    return `Wiki lint done · ${s.findingsAccepted} accepted / ${s.findingsRejected} rejected of ${s.findingsTotal} · ${dur}`;
  }
  if (s.terminalPhase === 'cancelled') return `Wiki lint cancelled · ${dur}`;
  return `Wiki lint error · ${s.error?.code ?? 'unknown'} · ${dur}`;
}

function ExpandedBody({ snapshot: s }: { snapshot: WikiTerminalSnapshot }): JSX.Element {
  return (
    <div className="leo-wiki-terminal-body" data-slot="wiki-terminal-body">
      <dl>
        <dt>Run id</dt>
        <dd>{s.runId}</dd>
        <dt>Op</dt>
        <dd>{s.op}</dd>
        <dt>Duration</dt>
        <dd>{(s.durationMs / 1000).toFixed(1)}s</dd>
        {s.op === 'ingest' ? (
          <>
            <dt>Pages created</dt>
            <dd>{s.pagesCreated}</dd>
            <dt>Pages edited</dt>
            <dd>{s.pagesEdited}</dd>
            <dt>Sources persisted</dt>
            <dd>{s.sourcesPersisted}</dd>
          </>
        ) : (
          <>
            <dt>Findings</dt>
            <dd>
              {s.findingsAccepted} accepted / {s.findingsRejected} rejected of {s.findingsTotal}
            </dd>
            <dt>Schema edited</dt>
            <dd>{s.schemaEdited ? 'yes' : 'no'}</dd>
          </>
        )}
        {s.error !== null ? (
          <>
            <dt>Error</dt>
            <dd>
              <code>{s.error.code}</code>: {s.error.message}
            </dd>
          </>
        ) : null}
        {s.logLine !== null ? (
          <>
            <dt>Log entry</dt>
            <dd>
              <code>{s.logLine}</code>
            </dd>
          </>
        ) : null}
      </dl>
      {s.op === 'ingest' && s.perSourceStatuses.length > 0 ? (
        <ul className="leo-wiki-terminal-sources" data-slot="wiki-terminal-sources">
          {s.perSourceStatuses.map((src) => (
            <li key={src.rawPath} data-status={src.status}>
              <code>{src.rawPath}</code> — {src.status}
              {src.error !== undefined ? ` (${src.error})` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export const WikiTerminalBlock = memo(WikiTerminalBlockImpl);

registerWidget(WIKI_TERMINAL_KIND, WikiTerminalBlock);
