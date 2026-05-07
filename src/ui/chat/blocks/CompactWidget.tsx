import { useSyncExternalStore } from 'react';
import type { CompactWidgetController } from '@/agent/compact/widgetController';
import type { CompactErrorCode, CompactPhase, CompactViewModel } from '@/agent/compact/widgetState';

const ERROR_LABEL: Record<CompactErrorCode, string> = {
  no_stream: 'No streaming response',
  no_summary: 'Could not parse summary',
  prompt_too_long: 'Prompt too long',
  circuit_broken: 'Disabled this session',
  aborted: 'Aborted',
  empty_history: 'Nothing to compact',
  reload: 'Discarded by reload',
  unknown: 'Unknown error',
};

const PHASE_LABEL: Record<CompactPhase, string> = {
  idle: 'preparing',
  preparing: 'preparing',
  summarizing: 'summarizing',
  building_attachments: 'building attachments',
  done: 'done',
  cancelled: 'cancelled',
  error: 'error',
};

export interface CompactWidgetProps {
  readonly controller: CompactWidgetController;
}

export function CompactWidget({ controller }: CompactWidgetProps): JSX.Element {
  const vm = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.viewModel(),
    () => controller.viewModel(),
  );
  return <CompactWidgetView vm={vm} />;
}

function CompactWidgetView({ vm }: { vm: CompactViewModel }): JSX.Element {
  return (
    <section
      className={`leo-root leo-compact-widget leo-compact-${vm.trigger}`}
      data-slot="compact-widget"
      data-phase={vm.phase}
      data-trigger={vm.trigger}
      data-runid={vm.runId}
      aria-label={`Compact ${vm.trigger} run ${vm.runId} (phase: ${vm.phase})`}
    >
      <header className="leo-compact-header">
        <span className="leo-compact-title">
          Compact <span className="leo-compact-trigger">({vm.trigger})</span>
          <span className="leo-compact-runid"> · {vm.runId}</span>
        </span>
        <span className="leo-compact-phase" data-phase-label>
          {PHASE_LABEL[vm.phase]}
        </span>
      </header>
      <PhaseBody vm={vm} />
      {vm.error !== null ? (
        <p className="leo-compact-error" data-slot="compact-error">
          <strong>{ERROR_LABEL[vm.error.code]}</strong>: {vm.error.message}
        </p>
      ) : null}
    </section>
  );
}

function PhaseBody({ vm }: { vm: CompactViewModel }): JSX.Element | null {
  switch (vm.phase) {
    case 'idle':
    case 'preparing':
      return (
        <p className="leo-compact-status-line">
          Preparing summarization{vm.preTokens !== null ? ` of ${fmtK(vm.preTokens)} tokens` : ''}…
        </p>
      );
    case 'summarizing':
      return (
        <p className="leo-compact-status-line">
          Summarizing
          {vm.preTokens !== null ? ` ${fmtK(vm.preTokens)} tokens` : ''} via provider…
        </p>
      );
    case 'building_attachments':
      return <p className="leo-compact-status-line">Reattaching pinned files & skills…</p>;
    case 'done':
      return <DoneBody vm={vm} />;
    case 'cancelled':
      return (
        <p className="leo-compact-status-line">
          Cancelled
          {vm.preTokens !== null ? ` (was ${fmtK(vm.preTokens)} tokens)` : ''}.
        </p>
      );
    case 'error':
      return null;
  }
}

function DoneBody({ vm }: { vm: CompactViewModel }): JSX.Element {
  const dur = formatDuration(vm.startedAt, vm.endedAt);
  const pre = vm.preTokens ?? 0;
  const post = vm.postTokens ?? 0;
  const saved = pre - post;
  const pct = pre > 0 ? Math.max(0, Math.round((saved / pre) * 100)) : 0;
  return (
    <ul className="leo-compact-summary" data-slot="compact-summary">
      <li>
        Compacted <strong>{fmtK(pre)}</strong> → <strong>{fmtK(post)}</strong> tokens
        {pre > 0 ? ` (−${pct}%)` : ''}
      </li>
      {vm.attachmentCount !== null ? (
        <li>
          Reattached {vm.attachmentCount} item{vm.attachmentCount === 1 ? '' : 's'}
        </li>
      ) : null}
      <li>Duration: {dur}</li>
    </ul>
  );
}

function fmtK(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function formatDuration(start: number | null, end: number | null): string {
  if (start === null || end === null || end < start) return '—';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
