import { useSyncExternalStore } from 'react';
import type { WikiWidgetController } from '@/agent/wiki/widgetController';
import type { WikiViewModel } from '@/agent/wiki/widgetState';

export interface WikiWidgetProps {
  readonly controller: WikiWidgetController;
}

export function WikiWidget({ controller }: WikiWidgetProps): JSX.Element {
  const vm = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.viewModel(),
    () => controller.viewModel(),
  );
  return <WikiWidgetView vm={vm} controller={controller} />;
}

interface ViewProps {
  readonly vm: WikiViewModel;
  readonly controller: WikiWidgetController;
}

function WikiWidgetView({ vm, controller }: ViewProps): JSX.Element {
  return (
    <section
      className={`leo-root leo-wiki-widget leo-wiki-${vm.op}`}
      data-slot="wiki-widget"
      data-phase={vm.phase}
      data-op={vm.op}
      data-runid={vm.runId}
      aria-label={`Wiki ${vm.op} run ${vm.runId} (phase: ${vm.phase})`}
    >
      <header className="leo-wiki-header">
        <span className="leo-wiki-title">
          Wiki {vm.op}
          <span className="leo-wiki-runid"> · {vm.runId}</span>
        </span>
        <span className="leo-wiki-phase" data-phase-label>
          {vm.phase}
        </span>
      </header>
      <PhaseBody vm={vm} controller={controller} />
      {vm.error !== null ? (
        <p className="leo-wiki-error" data-slot="wiki-error">
          <strong>Error</strong> ({vm.error.code}): {vm.error.message}
        </p>
      ) : null}
    </section>
  );
}

function PhaseBody({ vm, controller }: ViewProps): JSX.Element | null {
  switch (vm.phase) {
    case 'idle':
      return <p className="leo-wiki-status-line">Preparing run…</p>;
    case 'preparing':
      return <RefineBody vm={vm} />;
    case 'awaiting_clarify':
      return <ClarifyBody vm={vm} controller={controller} />;
    case 'fetching':
      return <ProgressBody vm={vm} kind="fetch" />;
    case 'persisting':
      return (
        <>
          <ProgressBody vm={vm} kind="persist" />
          {vm.duplicatePrompt !== undefined && vm.duplicatePrompt !== null ? (
            <DuplicateBody vm={vm} controller={controller} />
          ) : null}
        </>
      );
    case 'awaiting_duplicate':
      return <DuplicateBody vm={vm} controller={controller} />;
    case 'planning':
      return <PlanBody vm={vm} />;
    case 'extracting':
      return <ProgressBody vm={vm} kind="extract" />;
    case 'reducing':
      return <ProgressBody vm={vm} kind="reduce" />;
    case 'awaiting_confirm':
      return <ConfirmBody vm={vm} controller={controller} />;
    case 'writing':
      return <ProgressBody vm={vm} kind="write" />;
    case 'scanning':
      return <ScanBody vm={vm} />;
    case 'checking':
      return <ProgressBody vm={vm} kind="check" />;
    case 'proposing':
      return (
        <p className="leo-wiki-status-line">
          Proposing patches: {vm.findings?.length ?? 0} findings ranked.
        </p>
      );
    case 'done':
    case 'cancelled':
      return <TerminalSummaryBody vm={vm} />;
    case 'error':
      return null;
  }
}

function RefineBody({ vm }: { vm: WikiViewModel }): JSX.Element {
  const transcript = vm.refineTranscript ?? [];
  return (
    <ol className="leo-wiki-refine" data-slot="wiki-refine">
      {transcript.map((turn, i) => (
        <li key={i} data-role={turn.role}>
          <strong>{turn.role}:</strong> {turn.content}
        </li>
      ))}
      {transcript.length === 0 ? <li className="leo-wiki-empty">Refining scope…</li> : null}
    </ol>
  );
}

function ClarifyBody({ vm, controller }: ViewProps): JSX.Element {
  return (
    <div className="leo-wiki-clarify" data-slot="wiki-clarify">
      <p className="leo-wiki-clarify-q">{vm.clarifyingQuestion ?? 'Clarification requested.'}</p>
      <ClarifyForm controller={controller} />
    </div>
  );
}

function ClarifyForm({ controller }: { controller: WikiWidgetController }): JSX.Element {
  const onSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = e.currentTarget;
    const ta = form.elements.namedItem('answer') as HTMLTextAreaElement | null;
    const value = ta?.value.trim() ?? '';
    if (value.length === 0) return;
    controller.answerClarification(value);
    if (ta !== null) ta.value = '';
  };
  return (
    <form className="leo-wiki-clarify-form" onSubmit={onSubmit}>
      <textarea
        name="answer"
        rows={2}
        aria-label="Clarification answer"
        data-slot="clarify-input"
      />
      <button type="submit" data-slot="clarify-send">
        Send
      </button>
    </form>
  );
}

function ProgressBody({
  vm,
  kind,
}: {
  vm: WikiViewModel;
  kind: 'fetch' | 'persist' | 'extract' | 'reduce' | 'write' | 'check';
}): JSX.Element {
  const progress = pickProgress(vm, kind);
  if (progress === undefined) {
    return <p className="leo-wiki-status-line">Working…</p>;
  }
  const pct = progress.total > 0 ? Math.floor((progress.completed / progress.total) * 100) : 0;
  return (
    <div className="leo-wiki-progress" data-slot={`wiki-progress-${kind}`}>
      <div className="leo-wiki-progress-bar" data-slot="bar">
        <div className="leo-wiki-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="leo-wiki-progress-line">
        {progress.completed} / {progress.total}
        {progress.failed !== undefined && progress.failed > 0 ? ` (${progress.failed} failed)` : ''}
        {progress.current !== undefined ? ` · ${progress.current}` : ''}
      </p>
    </div>
  );
}

function pickProgress(
  vm: WikiViewModel,
  kind: 'fetch' | 'persist' | 'extract' | 'reduce' | 'write' | 'check',
): WikiViewModel['fetchProgress'] {
  switch (kind) {
    case 'fetch':
      return vm.fetchProgress;
    case 'persist':
      return vm.persistProgress;
    case 'extract':
      return vm.extractProgress;
    case 'reduce':
      return vm.reduceProgress;
    case 'write':
      return vm.writeProgress;
    case 'check':
      return vm.checkProgress;
  }
}

function DuplicateBody({ vm, controller }: ViewProps): JSX.Element {
  const dup = vm.duplicatePrompt ?? null;
  return (
    <div className="leo-wiki-duplicate" data-slot="wiki-duplicate">
      <p>
        Duplicate detected for <code>{dup?.sourceRef ?? '(unknown)'}</code>. Existing raw at{' '}
        <code>{dup?.rawPath ?? '?'}</code>.
      </p>
      <div className="leo-wiki-duplicate-actions">
        <button type="button" onClick={() => controller.resolveDuplicate('skip')}>
          Skip
        </button>
        <button type="button" onClick={() => controller.resolveDuplicate('reprocess')}>
          Re-process
        </button>
        <button type="button" onClick={() => controller.resolveDuplicate('replace')}>
          Replace
        </button>
      </div>
    </div>
  );
}

function PlanBody({ vm }: { vm: WikiViewModel }): JSX.Element {
  const plan = vm.plan?.perSource ?? [];
  return (
    <ul className="leo-wiki-plan" data-slot="wiki-plan">
      {plan.map((s) => (
        <li key={s.rawPath}>
          <code>{s.rawPath}</code> → {s.candidatePages.length} candidate
          {s.candidatePages.length === 1 ? '' : 's'}
        </li>
      ))}
      {plan.length === 0 ? <li className="leo-wiki-empty">Planning…</li> : null}
    </ul>
  );
}

function ConfirmBody({ vm, controller }: ViewProps): JSX.Element {
  const findings = vm.findings ?? [];
  const onAcceptAll = (): void =>
    controller.applyLintConfirm({
      accepted: findings.map((f) => f.id),
      rejected: [],
      applySchema: vm.schemaPatchPending === true,
    });
  const onRejectAll = (): void =>
    controller.applyLintConfirm({
      accepted: [],
      rejected: findings.map((f) => f.id),
      applySchema: false,
    });
  return (
    <div className="leo-wiki-confirm" data-slot="wiki-confirm">
      <p className="leo-wiki-confirm-summary">
        {findings.length} finding{findings.length === 1 ? '' : 's'} ready for review.
      </p>
      <ul>
        {findings.map((f) => (
          <li key={f.id} data-severity={f.severity}>
            <strong>{f.action}</strong> · <code>{f.page}</code> — {f.rationale}
          </li>
        ))}
      </ul>
      {vm.schemaPatchPending === true ? (
        <p className="leo-wiki-confirm-schema">
          <em>SCHEMA.md patch included — confirm explicitly to apply.</em>
        </p>
      ) : null}
      <div className="leo-wiki-confirm-actions">
        <button type="button" onClick={onAcceptAll}>
          Accept all
        </button>
        <button type="button" onClick={onRejectAll}>
          Reject all
        </button>
      </div>
    </div>
  );
}

function ScanBody({ vm }: { vm: WikiViewModel }): JSX.Element {
  const s = vm.scanSummary;
  if (s === undefined) return <p className="leo-wiki-status-line">Scanning…</p>;
  return (
    <ul className="leo-wiki-scan" data-slot="wiki-scan">
      <li>Pages: {s.pages}</li>
      <li>Sources: {s.sources}</li>
      <li>Orphan pages: {s.orphanPages}</li>
      <li>Orphan raw: {s.orphanRaw}</li>
    </ul>
  );
}

function TerminalSummaryBody({ vm }: { vm: WikiViewModel }): JSX.Element {
  if (vm.op === 'ingest') {
    return (
      <ul className="leo-wiki-terminal" data-slot="wiki-terminal-summary">
        <li>Pages created: {vm.pagesCreated ?? 0}</li>
        <li>Pages edited: {vm.pagesEdited ?? 0}</li>
        <li>Sources: {(vm.perSourceStatuses ?? []).length}</li>
      </ul>
    );
  }
  return (
    <ul className="leo-wiki-terminal" data-slot="wiki-terminal-summary">
      <li>Findings: {vm.findings?.length ?? 0}</li>
      <li>
        Accepted: {(vm.findings ?? []).filter((f) => f.accepted === true).length} · Rejected:{' '}
        {(vm.findings ?? []).filter((f) => f.accepted === false).length}
      </li>
    </ul>
  );
}
