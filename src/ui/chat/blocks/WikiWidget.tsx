import { useState, useSyncExternalStore } from 'react';
import type { WikiWidgetController } from '@/agent/wiki/widgetController';
import type { LintFindingSummary, WikiViewModel } from '@/agent/wiki/widgetState';

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
    case 'awaiting_config':
      return <ConfigBody vm={vm} controller={controller} />;
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
      return vm.op === 'lint' ? <LintWritingBody vm={vm} /> : <ProgressBody vm={vm} kind="write" />;
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
  const onAcceptAll = (): void => {
    for (const f of findings) controller.setFindingDecision(f.id, true);
    controller.applyLintConfirmFromState(vm.schemaPatchPending === true);
  };
  const onRejectAll = (): void => {
    for (const f of findings) controller.setFindingDecision(f.id, false);
    controller.applyLintConfirmFromState(false);
  };
  const onApply = (): void => controller.applyLintConfirmFromState(vm.schemaPatchPending === true);
  return (
    <div className="leo-wiki-confirm" data-slot="wiki-confirm">
      <p className="leo-wiki-confirm-summary">
        {findings.length} finding{findings.length === 1 ? '' : 's'} ready for review.
      </p>
      <ul className="leo-wiki-finding-list" data-slot="wiki-confirm-list">
        {findings.map((f) => (
          <FindingRow key={f.id} finding={f} controller={controller} />
        ))}
      </ul>
      {vm.schemaPatchPending === true ? (
        <p className="leo-wiki-confirm-schema">
          <em>SCHEMA.md patch included — confirm explicitly to apply.</em>
        </p>
      ) : null}
      <div className="leo-wiki-confirm-actions">
        <button type="button" onClick={onAcceptAll} data-slot="wiki-confirm-accept-all">
          Accept all
        </button>
        <button type="button" onClick={onRejectAll} data-slot="wiki-confirm-reject-all">
          Reject all
        </button>
        <button type="button" onClick={onApply} data-slot="wiki-confirm-apply">
          Apply
        </button>
      </div>
    </div>
  );
}

interface FindingRowProps {
  readonly finding: LintFindingSummary;
  readonly controller: WikiWidgetController;
}

function FindingRow({ finding, controller }: FindingRowProps): JSX.Element {
  const [noteOpen, setNoteOpen] = useState<boolean>((finding.note ?? '').length > 0);
  const isSchemaDrift = finding.action === 'schema-drift';
  return (
    <li
      className="leo-wiki-finding-row"
      data-severity={finding.severity}
      data-accepted={String(finding.accepted)}
      data-slot="wiki-finding-row"
    >
      <div className="leo-wiki-finding-head">
        <strong>{finding.action}</strong>
        {finding.page.length > 0 ? (
          <>
            {' · '}
            <code>{finding.page}</code>
          </>
        ) : null}
      </div>
      <p className="leo-wiki-finding-rationale">{finding.rationale}</p>
      {isSchemaDrift ? (
        <p className="leo-wiki-finding-schema-note" data-slot="wiki-finding-schema-note">
          schema patch — applied via SCHEMA panel
        </p>
      ) : null}
      <div className="leo-wiki-finding-actions">
        <button
          type="button"
          onClick={() => controller.setFindingDecision(finding.id, true)}
          data-slot="wiki-finding-accept"
          aria-pressed={finding.accepted === true}
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => controller.setFindingDecision(finding.id, false)}
          data-slot="wiki-finding-discard"
          aria-pressed={finding.accepted === false}
        >
          Discard
        </button>
        <button
          type="button"
          onClick={() => setNoteOpen((s) => !s)}
          data-slot="wiki-finding-note-toggle"
          aria-expanded={noteOpen}
        >
          Add note
        </button>
      </div>
      {noteOpen ? (
        <textarea
          className="leo-wiki-finding-note"
          rows={2}
          aria-label={`Note for ${finding.action}`}
          defaultValue={finding.note ?? ''}
          onChange={(e) => controller.setFindingNote(finding.id, e.target.value)}
          data-slot="wiki-finding-note"
        />
      ) : null}
    </li>
  );
}

function LintWritingBody({ vm }: { vm: WikiViewModel }): JSX.Element {
  const findings = vm.findings ?? [];
  return (
    <div className="leo-wiki-lint-writing" data-slot="wiki-lint-writing">
      <p className="leo-wiki-progress-line">
        Applied: {vm.findingsApplied ?? 0} · Failed: {vm.findingsFailed ?? 0} · Pages edited:{' '}
        {vm.pagesEdited ?? 0}
      </p>
      <ul className="leo-wiki-finding-list">
        {findings.map((f) => {
          const status = f.patchStatus ?? 'pending';
          return (
            <li
              key={f.id}
              className="leo-wiki-finding-row"
              data-severity={f.severity}
              data-slot="wiki-lint-write-row"
            >
              <div className="leo-wiki-finding-head">
                <strong>{f.action}</strong>
                {f.page.length > 0 ? (
                  <>
                    {' · '}
                    <code>{f.page}</code>
                  </>
                ) : null}
              </div>
              <span
                className="leo-wiki-finding-badge"
                data-status={status}
                data-slot="wiki-finding-badge"
              >
                {writingBadgeText(status, f.patchError)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function writingBadgeText(
  status: NonNullable<LintFindingSummary['patchStatus']>,
  err?: string,
): string {
  switch (status) {
    case 'pending':
      return 'queued';
    case 'proposing':
      return 'proposing patch…';
    case 'applying':
      return 'applying…';
    case 'applied':
      return 'applied';
    case 'skipped':
      return 'skipped';
    case 'failed':
      return err !== undefined && err.length > 0 ? `failed: ${err}` : 'failed';
  }
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

function ConfigBody({ vm, controller }: ViewProps): JSX.Element {
  const cfg = vm.config;
  if (cfg === undefined) {
    return <p className="leo-wiki-status-line">Loading run config…</p>;
  }
  const onProvider = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    controller.onSelectProvider(e.target.value as typeof cfg.draftProviderId);
  };
  const onModel = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    controller.onSelectModel(e.target.value);
  };
  const startDisabled =
    cfg.apiKeyMissing ||
    cfg.models.state !== 'ok' ||
    (cfg.models.state === 'ok' && cfg.models.items.length === 0) ||
    cfg.draftModel.length === 0;
  return (
    <div className="leo-wiki-config" data-slot="wiki-config">
      <p className="leo-wiki-config-ask" data-slot="wiki-config-ask">
        <strong>Ask:</strong> {cfg.originalAsk}
      </p>
      <p className="leo-wiki-config-sources" data-slot="wiki-config-sources">
        <strong>Source:</strong> {cfg.sourcesSummary}
      </p>
      <label className="leo-wiki-config-row">
        <span>Provider</span>
        <select
          value={cfg.draftProviderId}
          onChange={onProvider}
          data-slot="wiki-config-provider"
          aria-label="Provider"
        >
          {cfg.providers.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <span className="leo-wiki-config-default">default: {cfg.defaultProviderId}</span>
      </label>
      <label className="leo-wiki-config-row">
        <span>Model</span>
        {cfg.models.state === 'loading' ? (
          <span className="leo-wiki-config-loading" data-slot="wiki-config-models-loading">
            Loading models…
          </span>
        ) : cfg.models.state === 'error' ? (
          <span className="leo-wiki-config-error" data-slot="wiki-config-models-error">
            {cfg.models.error}
            <button
              type="button"
              onClick={() => controller.onRetryLoadModels()}
              data-slot="wiki-config-models-retry"
            >
              Retry
            </button>
          </span>
        ) : cfg.models.state === 'ok' && cfg.models.items.length > 0 ? (
          <select
            value={cfg.draftModel}
            onChange={onModel}
            data-slot="wiki-config-model"
            aria-label="Model"
          >
            {cfg.models.items.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        ) : (
          <span className="leo-wiki-config-empty">No models discovered.</span>
        )}
        <span className="leo-wiki-config-default">default: {cfg.defaultModel}</span>
      </label>
      {cfg.apiKeyMissing ? (
        <p className="leo-wiki-config-apikey" data-slot="wiki-config-apikey">
          API key required for this provider — set it in Settings, then retry.
        </p>
      ) : null}
      {cfg.validationError !== null ? (
        <p className="leo-wiki-config-validation" data-slot="wiki-config-validation">
          {cfg.validationError}
        </p>
      ) : null}
      <div className="leo-wiki-config-actions">
        <button
          type="button"
          onClick={() => controller.onConfirm()}
          disabled={startDisabled}
          data-slot="wiki-config-start"
        >
          Start
        </button>
        <button type="button" onClick={() => controller.onCancel()} data-slot="wiki-config-cancel">
          Cancel
        </button>
      </div>
    </div>
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
  const findings = vm.findings ?? [];
  const accepted = findings.filter((f) => f.accepted === true).length;
  const rejected = findings.filter((f) => f.accepted === false).length;
  const applied = vm.findingsApplied ?? 0;
  const failed = vm.findingsFailed ?? 0;
  const pagesEdited = vm.pagesEdited ?? 0;
  const showZeroAppliedWarning = accepted > 0 && pagesEdited === 0;
  return (
    <div className="leo-wiki-terminal" data-slot="wiki-terminal-summary">
      <ul className="leo-wiki-terminal-counts">
        <li>Findings: {findings.length}</li>
        <li>
          Accepted: {accepted} · Discarded: {rejected}
        </li>
        <li>
          Applied: {applied} · Failed: {failed} · Pages edited: {pagesEdited}
        </li>
        <li>Schema patch: {vm.schemaEditedConfirmed === true ? 'yes' : 'no'}</li>
      </ul>
      {showZeroAppliedWarning ? (
        <p className="leo-wiki-warning" data-slot="lint-zero-applied-warning" role="alert">
          No pages were edited despite {accepted} accepted finding{accepted === 1 ? '' : 's'}. See
          per-finding statuses for details.
        </p>
      ) : null}
      {findings.length > 0 ? (
        <ul className="leo-wiki-finding-list" data-slot="wiki-terminal-findings">
          {findings.map((f) => {
            const status = f.patchStatus ?? (f.accepted === true ? 'pending' : 'skipped');
            return (
              <li key={f.id} className="leo-wiki-finding-row" data-severity={f.severity}>
                <div className="leo-wiki-finding-head">
                  <strong>{f.action}</strong>
                  {f.page.length > 0 ? (
                    <>
                      {' · '}
                      <code>{f.page}</code>
                    </>
                  ) : null}
                </div>
                <span className="leo-wiki-finding-badge" data-status={status}>
                  {writingBadgeText(status, f.patchError)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
