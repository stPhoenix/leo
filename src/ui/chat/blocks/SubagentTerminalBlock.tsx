import { memo, useState } from 'react';
import {
  tryParseTaskTerminalSnapshot,
  type TaskTerminalSnapshot,
} from '@/agent/task/terminalSnapshot';
import type { WidgetComponentProps } from '../widgets/registry';

const ERROR_LABEL: Record<string, string> = {
  cancelled: 'Cancelled',
  timeout: 'Timed out',
  no_summary: 'No final answer produced',
  graph_throw: 'Subagent threw',
  reload: 'Discarded by reload',
  busy: 'Too many concurrent tasks',
  denied: 'Denied by user',
};

function SubagentTerminalBlockImpl({ props }: WidgetComponentProps): JSX.Element | null {
  const snapshot = tryParseTaskTerminalSnapshot(props);
  if (snapshot === null) {
    return (
      <section
        className="leo-subagent-terminal-invalid"
        data-slot="subagent-terminal-invalid"
        aria-label="Subagent run snapshot invalid or outdated"
      >
        <p>This subagent run was recorded with an older snapshot format and cannot be rendered.</p>
      </section>
    );
  }
  return <SubagentTerminalView snapshot={snapshot} />;
}

function SubagentTerminalView({ snapshot }: { snapshot: TaskTerminalSnapshot }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const summary = collapsedSummary(snapshot);
  return (
    <section
      className={`leo-subagent-terminal-block leo-subagent-terminal-${snapshot.terminalPhase}`}
      data-slot="subagent-terminal-block"
      data-phase={snapshot.terminalPhase}
      aria-label={`Subagent run ${snapshot.runId} ended ${snapshot.terminalPhase}`}
    >
      <button
        type="button"
        className="leo-subagent-terminal-toggle"
        data-slot="subagent-terminal-toggle"
        aria-expanded={expanded}
        onClick={(): void => setExpanded((v) => !v)}
      >
        {summary}
      </button>
      {expanded ? <ExpandedBody snapshot={snapshot} /> : null}
    </section>
  );
}

function collapsedSummary(s: TaskTerminalSnapshot): string {
  const dur = formatDuration(s.durationMs);
  if (s.terminalPhase === 'done') {
    return `Subagent done · ${s.toolCallsCount} tool call${s.toolCallsCount === 1 ? '' : 's'} · ${dur}`;
  }
  if (s.terminalPhase === 'cancelled') {
    return `Subagent cancelled · ${dur}`;
  }
  const code = s.error?.code ?? 'unknown';
  const label = ERROR_LABEL[code] ?? code;
  return `Subagent failed: ${label} · ${dur}`;
}

function ExpandedBody({ snapshot: s }: { snapshot: TaskTerminalSnapshot }): JSX.Element {
  return (
    <div className="leo-subagent-terminal-body" data-slot="subagent-terminal-body">
      <dl>
        <dt>Run id</dt>
        <dd>{s.runId}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(s.durationMs)}</dd>
        <dt>Tool calls</dt>
        <dd>{s.toolCallsCount}</dd>
        {s.lastToolId !== null ? (
          <>
            <dt>Last tool</dt>
            <dd>
              <code>{s.lastToolId}</code>
            </dd>
          </>
        ) : null}
        <dt>Prompt</dt>
        <dd className="leo-subagent-terminal-prompt">{s.prompt}</dd>
        {s.summary !== null && s.summary.length > 0 ? (
          <>
            <dt>Summary</dt>
            <dd className="leo-subagent-terminal-summary">{s.summary}</dd>
          </>
        ) : null}
        {s.error !== null ? (
          <>
            <dt>Error</dt>
            <dd>
              <code>{s.error.code}</code>: {s.error.message}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const SubagentTerminalBlock = memo(SubagentTerminalBlockImpl);
