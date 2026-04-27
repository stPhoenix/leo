import { memo, useState } from 'react';
import {
  tryParseTerminalSnapshot,
  type ExternalAgentTerminalSnapshot,
} from '@/agent/externalAgent/terminalSnapshot';

export interface ExternalAgentTerminalBlockProps {
  readonly props: unknown;
}

function ExternalAgentTerminalBlockImpl(
  props: ExternalAgentTerminalBlockProps,
): JSX.Element | null {
  const snapshot = tryParseTerminalSnapshot(props.props);
  if (snapshot === null) return null;
  return <TerminalView snapshot={snapshot} />;
}

export const ExternalAgentTerminalBlock = memo(ExternalAgentTerminalBlockImpl);

interface TerminalViewProps {
  readonly snapshot: ExternalAgentTerminalSnapshot;
}

function TerminalView(props: TerminalViewProps): JSX.Element {
  const { snapshot } = props;
  const [expanded, setExpanded] = useState(false);
  const icon =
    snapshot.terminalPhase === 'done' ? '✓' : snapshot.terminalPhase === 'cancelled' ? '✕' : '⚠';
  const folder = snapshot.folder;
  const isReload = snapshot.terminalPhase === 'error' && snapshot.error?.code === 'reload';
  return (
    <section
      className="leo-root leo-external-agent leo-ea-terminal leo-ea-persisted"
      data-slot="external-agent"
      data-phase={snapshot.terminalPhase}
      data-persisted="true"
      aria-label={`External agent run ${snapshot.terminalPhase} (persisted)`}
    >
      <button
        type="button"
        className="leo-ea-summary"
        aria-expanded={expanded}
        aria-label={`External agent run ${snapshot.terminalPhase} — toggle details`}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="leo-ea-summary-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="leo-ea-summary-text">
          External Agent · {snapshot.adapterLabel} · {formatDuration(snapshot.durationMs)}
          {folder !== null && folder.length > 0 ? ` · ${folder}` : ' · no folder'}
        </span>
      </button>
      {isReload ? (
        <p className="leo-ea-reload-notice" data-slot="external-agent-reload">
          Plugin reloaded during this run — request was lost.
        </p>
      ) : null}
      {expanded ? (
        <div className="leo-ea-expanded" data-slot="external-agent-expanded">
          <div className="leo-ea-section">
            <span className="leo-ea-label">Refined prompt:</span>
            <pre className="leo-ea-mono">{snapshot.refinedPrompt}</pre>
          </div>
          {snapshot.refineTranscript.length > 0 ? (
            <div className="leo-ea-section">
              <span className="leo-ea-label">Refine transcript:</span>
              <ul className="leo-ea-transcript">
                {snapshot.refineTranscript.map((m, i) => (
                  <li key={i} className={`leo-ea-transcript-${m.role}`}>
                    <strong>{m.role}:</strong> {m.content}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {snapshot.responseText.length > 0 ? (
            <div className="leo-ea-section">
              <span className="leo-ea-label">Response:</span>
              <pre className="leo-ea-mono">{snapshot.responseText}</pre>
            </div>
          ) : null}
          {snapshot.error !== null ? (
            <div className="leo-ea-section leo-ea-error">
              <span className="leo-ea-label">Error:</span>
              <pre className="leo-ea-mono">
                [{snapshot.error.code}] {snapshot.error.message}
              </pre>
            </div>
          ) : null}
          {snapshot.files.length > 0 ? (
            <div className="leo-ea-section">
              <span className="leo-ea-label">Files written:</span>
              <ul>
                {snapshot.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {snapshot.logCount > 0 ? (
            <p className="leo-ea-log-count">
              Event log: {snapshot.logCount} entries (full log retained in result folder).
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}
