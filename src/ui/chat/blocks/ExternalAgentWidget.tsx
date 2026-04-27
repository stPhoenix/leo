import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import type {
  ExternalAgentWidgetController,
  WidgetViewModel,
} from '@/agent/externalAgent/widgetController';

export interface ExternalAgentWidgetProps {
  readonly controller: ExternalAgentWidgetController;
}

function ExternalAgentWidgetImpl(props: ExternalAgentWidgetProps): JSX.Element {
  const { controller } = props;
  const vm = useSyncExternalStore(
    (cb) => controller.subscribe(() => cb()),
    () => controller.viewModel(),
    () => controller.viewModel(),
  );
  switch (vm.phase) {
    case 'preparing':
      return <PreparingView vm={vm} controller={controller} />;
    case 'awaiting_clarify':
      return <AwaitingClarifyView vm={vm} controller={controller} />;
    case 'ready':
      return <ReadyView vm={vm} controller={controller} />;
    case 'running':
    case 'writing':
      return <RunningView vm={vm} controller={controller} />;
    case 'done':
    case 'cancelled':
    case 'error':
      return <TerminalView vm={vm} />;
  }
}

export const ExternalAgentWidget = memo(ExternalAgentWidgetImpl);

interface SubProps {
  readonly vm: WidgetViewModel;
  readonly controller: ExternalAgentWidgetController;
}

function PreparingView({ vm, controller }: SubProps): JSX.Element {
  return (
    <section
      className="leo-root leo-external-agent leo-ea-preparing"
      data-slot="external-agent"
      data-phase="preparing"
      aria-label="External agent — refining"
    >
      <header className="leo-ea-header">
        <span className="leo-ea-title">External Agent — preparing</span>
        <span className="leo-ea-meta">
          adapter: {vm.draftAdapterId ?? '(none)'} · budget: {vm.draftRefineBudget}
        </span>
      </header>
      <div className="leo-ea-body">
        <div className="leo-ea-section">
          <span className="leo-ea-label">Original ask:</span>
          <pre className="leo-ea-mono leo-ea-original">{vm.originalAsk}</pre>
        </div>
        <ValidationErrorBanner vm={vm} />
      </div>
      <footer className="leo-ea-actions">
        <button
          type="button"
          className="leo-ea-btn"
          aria-label="Cancel external agent run"
          onClick={() => controller.onCancel()}
        >
          Cancel
        </button>
      </footer>
    </section>
  );
}

function AwaitingClarifyView({ vm, controller }: SubProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const send = (): void => {
    const text = draft.trim();
    if (text.length === 0) return;
    controller.onAnswerClarification(text);
    setDraft('');
  };
  return (
    <section
      className="leo-root leo-external-agent leo-ea-clarify"
      data-slot="external-agent"
      data-phase="awaiting_clarify"
      aria-label="External agent — clarifying question"
    >
      <header className="leo-ea-header">
        <span className="leo-ea-title">External Agent — clarifying question</span>
      </header>
      <div className="leo-ea-body">
        <p className="leo-ea-question" data-slot="external-agent-question">
          {vm.clarifyingQuestion ?? '(no question text)'}
        </p>
        <textarea
          className="leo-ea-textarea"
          aria-label="Answer to clarifying question"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
        />
        <ValidationErrorBanner vm={vm} />
      </div>
      <footer className="leo-ea-actions">
        <button
          type="button"
          className="leo-ea-btn"
          aria-label="Cancel external agent run"
          onClick={() => controller.onCancel()}
        >
          Cancel
        </button>
        <button
          type="button"
          className="leo-ea-btn leo-ea-btn-primary"
          aria-label="Send clarifying answer"
          onClick={send}
          disabled={draft.trim().length === 0}
        >
          Send answer
        </button>
      </footer>
    </section>
  );
}

function ReadyView({ vm, controller }: SubProps): JSX.Element {
  const [draft, setDraft] = useState(vm.refinedPrompt ?? '');
  useEffect(() => {
    setDraft(vm.refinedPrompt ?? '');
  }, [vm.refinedPrompt]);
  const isEdited = draft !== (vm.refinedPrompt ?? '');
  return (
    <section
      className="leo-root leo-external-agent leo-ea-ready"
      data-slot="external-agent"
      data-phase="ready"
      aria-label="External agent — ready to send"
    >
      <header className="leo-ea-header">
        <span className="leo-ea-title">External Agent — ready to send</span>
      </header>
      <div className="leo-ea-body">
        <div className="leo-ea-controls">
          <label className="leo-ea-field">
            <span>Adapter</span>
            <select
              className="leo-ea-select"
              aria-label="Select external adapter"
              value={vm.draftAdapterId ?? ''}
              onChange={(e) => controller.onSelectAdapter(e.target.value)}
            >
              {vm.adapters.length === 0 ? <option value="">(no adapters configured)</option> : null}
              {vm.adapters.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="leo-ea-field">
            <span>Timeout (ms)</span>
            <input
              type="number"
              className="leo-ea-input"
              aria-label="Adapter call timeout in milliseconds"
              min={1000}
              step={1000}
              value={vm.draftTimeoutMs}
              onChange={(e) => controller.onSetTimeout(Number(e.target.value))}
            />
          </label>
          <label className="leo-ea-field">
            <span>Refine budget</span>
            <input
              type="number"
              className="leo-ea-input"
              aria-label="Refine clarifying-question budget"
              min={1}
              max={10}
              value={vm.draftRefineBudget}
              onChange={(e) => controller.onSetBudget(Number(e.target.value))}
            />
          </label>
        </div>
        <label className="leo-ea-field leo-ea-field-prompt">
          <span>Refined prompt (editable)</span>
          <textarea
            className="leo-ea-textarea leo-ea-mono"
            aria-label="Refined prompt"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
          />
        </label>
        <ValidationErrorBanner vm={vm} />
      </div>
      <footer className="leo-ea-actions">
        <button
          type="button"
          className="leo-ea-btn"
          aria-label="Cancel external agent run"
          onClick={() => controller.onCancel()}
        >
          Cancel
        </button>
        <button
          type="button"
          className="leo-ea-btn"
          aria-label="Edit refined prompt"
          disabled={!isEdited}
          onClick={() => controller.onEdit(draft)}
        >
          Edit
        </button>
        <button
          type="button"
          className="leo-ea-btn leo-ea-btn-primary"
          aria-label="Send refined prompt to external agent"
          onClick={() => controller.onSend(isEdited ? draft : undefined)}
          disabled={vm.draftAdapterId === null}
        >
          Send
        </button>
      </footer>
    </section>
  );
}

function RunningView({ vm, controller }: SubProps): JSX.Element {
  const elapsed = useElapsed(vm.startedAt);
  const [logOpen, setLogOpen] = useState(false);
  return (
    <section
      className="leo-root leo-external-agent leo-ea-running"
      data-slot="external-agent"
      data-phase={vm.phase}
      aria-label="External agent — running"
    >
      <header className="leo-ea-header">
        <span className="leo-ea-title">External Agent — {vm.draftAdapterId ?? 'unknown'}</span>
        <span className="leo-ea-meta" aria-label="Elapsed time">
          {formatElapsed(elapsed)}
        </span>
      </header>
      <div className="leo-ea-body">
        <div className="leo-ea-section">
          <span className="leo-ea-label">Response (streaming):</span>
          <pre className="leo-ea-mono leo-ea-stream" data-slot="external-agent-stream">
            {vm.textBuffer.length > 0 ? vm.textBuffer : '(awaiting first token…)'}
          </pre>
        </div>
        {vm.logEvents.length > 0 ? (
          <details
            className="leo-ea-log"
            open={logOpen}
            onToggle={(e) => setLogOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary>Event log ({vm.logEvents.length})</summary>
            <ul>
              {vm.logEvents.slice(-200).map((ev, i) => (
                <li key={i} className={`leo-ea-log-row leo-ea-log-${ev.level}`}>
                  <span className="leo-ea-log-level">{ev.level}</span>
                  <span className="leo-ea-log-msg">{ev.msg}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <footer className="leo-ea-actions">
        <button
          type="button"
          className="leo-ea-btn"
          aria-label="Cancel external agent run"
          onClick={() => controller.onCancel()}
        >
          Cancel
        </button>
      </footer>
    </section>
  );
}

interface TerminalProps {
  readonly vm: WidgetViewModel;
}

function TerminalView({ vm }: TerminalProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const icon = vm.phase === 'done' ? '✓' : vm.phase === 'cancelled' ? '✕' : '⚠';
  const adapterLabel = vm.draftAdapterId ?? 'unknown';
  const folder = vm.resultFolder !== null && vm.resultFolder.length > 0 ? vm.resultFolder : null;
  const duration =
    vm.startedAt !== null && vm.endedAt !== null ? formatElapsed(vm.endedAt - vm.startedAt) : '—';
  const isReload = vm.phase === 'error' && vm.error?.code === 'reload';
  return (
    <section
      className="leo-root leo-external-agent leo-ea-terminal"
      data-slot="external-agent"
      data-phase={vm.phase}
      aria-label={`External agent — ${vm.phase}`}
    >
      <button
        type="button"
        className="leo-ea-summary"
        aria-expanded={expanded}
        aria-label={`External agent run ${vm.phase} — toggle details`}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="leo-ea-summary-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="leo-ea-summary-text">
          External Agent · {adapterLabel} · {duration}
          {folder !== null ? ` · ${folder}` : ' · no folder'}
        </span>
      </button>
      {isReload ? (
        <p className="leo-ea-reload-notice" data-slot="external-agent-reload">
          Plugin reloaded during this run — request was lost.
        </p>
      ) : null}
      {expanded ? (
        <div className="leo-ea-expanded" data-slot="external-agent-expanded">
          {vm.refinedPrompt !== null ? (
            <div className="leo-ea-section">
              <span className="leo-ea-label">Final refined prompt:</span>
              <pre className="leo-ea-mono">{vm.refinedPrompt}</pre>
            </div>
          ) : null}
          {vm.textBuffer.length > 0 ? (
            <div className="leo-ea-section">
              <span className="leo-ea-label">Response:</span>
              <pre className="leo-ea-mono">{vm.textBuffer}</pre>
            </div>
          ) : null}
          {vm.error !== null ? (
            <div className="leo-ea-section leo-ea-error">
              <span className="leo-ea-label">Error:</span>
              <pre className="leo-ea-mono">
                [{vm.error.code}] {vm.error.message}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ValidationErrorBanner({ vm }: { vm: WidgetViewModel }): JSX.Element | null {
  if (vm.validationError === null) return null;
  return (
    <p className="leo-ea-validation" role="alert" data-slot="external-agent-validation">
      {vm.validationError}
    </p>
  );
}

function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return (): void => clearInterval(id);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}
