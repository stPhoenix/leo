import { memo, useState } from 'react';
import {
  COMPACT_TERMINAL_KIND,
  tryParseCompactTerminalSnapshot,
  type CompactTerminalSnapshot,
} from '@/agent/compact/terminalSnapshot';
import { registerWidget, type WidgetComponentProps } from '../widgets/registry';

const ERROR_LABEL: Record<string, string> = {
  no_stream: 'No streaming response',
  no_summary: 'Could not parse summary',
  prompt_too_long: 'Prompt too long',
  circuit_broken: 'Disabled this session',
  aborted: 'Aborted',
  empty_history: 'Nothing to compact',
  reload: 'Discarded by reload',
  unknown: 'Unknown error',
};

function CompactTerminalBlockImpl({ props }: WidgetComponentProps): JSX.Element | null {
  const snapshot = tryParseCompactTerminalSnapshot(props);
  if (snapshot === null) {
    return (
      <section
        className="leo-compact-terminal-invalid"
        data-slot="compact-terminal-invalid"
        aria-label="Compact run snapshot invalid or outdated"
      >
        <p>This compact run was recorded with an older snapshot format and cannot be rendered.</p>
      </section>
    );
  }
  return <CompactTerminalView snapshot={snapshot} />;
}

function CompactTerminalView({ snapshot }: { snapshot: CompactTerminalSnapshot }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const summary = collapsedSummary(snapshot);
  return (
    <section
      className={`leo-compact-terminal-block leo-compact-terminal-${snapshot.terminalPhase}`}
      data-slot="compact-terminal-block"
      data-phase={snapshot.terminalPhase}
      data-trigger={snapshot.trigger}
      aria-label={`Compact ${snapshot.trigger} run ${snapshot.runId} ended ${snapshot.terminalPhase}`}
    >
      <button
        type="button"
        className="leo-compact-terminal-toggle"
        data-slot="compact-terminal-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {summary}
      </button>
      {expanded ? <ExpandedBody snapshot={snapshot} /> : null}
    </section>
  );
}

function collapsedSummary(s: CompactTerminalSnapshot): string {
  const dur = formatDuration(s.durationMs);
  if (s.terminalPhase === 'done') {
    const pre = s.preTokens ?? 0;
    const post = s.postTokens ?? 0;
    return `Compacted ${fmtK(pre)} → ${fmtK(post)} tokens (${s.trigger}) · ${dur}`;
  }
  if (s.terminalPhase === 'cancelled') {
    return `Compact cancelled (${s.trigger}) · ${dur}`;
  }
  const code = s.error?.code ?? 'unknown';
  const label = ERROR_LABEL[code] ?? code;
  return `Compact failed: ${label} (${s.trigger}) · ${dur}`;
}

function ExpandedBody({ snapshot: s }: { snapshot: CompactTerminalSnapshot }): JSX.Element {
  return (
    <div className="leo-compact-terminal-body" data-slot="compact-terminal-body">
      <dl>
        <dt>Run id</dt>
        <dd>{s.runId}</dd>
        <dt>Trigger</dt>
        <dd>{s.trigger}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(s.durationMs)}</dd>
        {s.preTokens !== null ? (
          <>
            <dt>Pre tokens</dt>
            <dd>{fmtK(s.preTokens)}</dd>
          </>
        ) : null}
        {s.postTokens !== null ? (
          <>
            <dt>Post tokens</dt>
            <dd>{fmtK(s.postTokens)}</dd>
          </>
        ) : null}
        {s.inputTokens !== null ? (
          <>
            <dt>Compaction input</dt>
            <dd>{fmtK(s.inputTokens)}</dd>
          </>
        ) : null}
        {s.outputTokens !== null ? (
          <>
            <dt>Compaction output</dt>
            <dd>{fmtK(s.outputTokens)}</dd>
          </>
        ) : null}
        {s.attachmentCount !== null ? (
          <>
            <dt>Reattached</dt>
            <dd>
              {s.attachmentCount} item{s.attachmentCount === 1 ? '' : 's'}
            </dd>
          </>
        ) : null}
        {s.customInstructions !== null && s.customInstructions.length > 0 ? (
          <>
            <dt>Custom instructions</dt>
            <dd>{s.customInstructions}</dd>
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

function fmtK(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const CompactTerminalBlock = memo(CompactTerminalBlockImpl);

registerWidget(COMPACT_TERMINAL_KIND, CompactTerminalBlock);
