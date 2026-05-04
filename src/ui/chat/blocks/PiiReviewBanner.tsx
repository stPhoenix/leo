import type { PiiDecision } from '@/agent/externalAgent/applyPiiDecisions';
import type { PiiFinding, PiiKind } from '@/agent/externalAgent/piiDetectAgent';

export type PiiReviewStatus = 'idle' | 'scanning' | 'ready' | 'error';

export interface PiiReviewBannerProps {
  readonly status: PiiReviewStatus;
  readonly findings: readonly PiiFinding[];
  readonly decisions: ReadonlyMap<string, PiiDecision>;
  readonly errorMessage?: string;
  readonly onDecide: (id: string, decision: PiiDecision) => void;
  readonly onApplyAll: () => void;
  readonly onIgnoreAll: () => void;
  readonly onRetry?: () => void;
}

const KIND_LABELS: Readonly<Record<PiiKind, string>> = {
  email: 'Email',
  phone: 'Phone number',
  governmentId: 'Government ID',
  paymentCard: 'Payment card',
  apiKey: 'API key',
  jwt: 'JWT',
  iban: 'IBAN',
  ipAddress: 'IP address',
  urlWithAuth: 'URL with credentials',
  other: 'Sensitive content',
};

export function PiiReviewBanner(props: PiiReviewBannerProps): JSX.Element | null {
  const { status, findings, decisions } = props;

  if (status === 'idle') return null;
  if (status === 'ready' && findings.length === 0) return null;

  const pendingCount = findings.reduce((n, f) => (decisions.get(f.id) === 'ignore' ? n : n + 1), 0);

  return (
    <section
      className="leo-root leo-pii-review"
      role="status"
      aria-live="polite"
      data-slot="pii-review"
      data-status={status}
    >
      {status === 'scanning' ? (
        <p className="leo-pii-status leo-pii-scanning" data-slot="pii-scanning">
          <span className="leo-pii-spinner" aria-hidden="true" /> Checking for sensitive content…
        </p>
      ) : null}
      {status === 'error' ? (
        <div className="leo-pii-status leo-pii-error" data-slot="pii-error">
          <span className="leo-pii-icon" aria-hidden="true">
            ⚠
          </span>
          <span className="leo-pii-error-msg">
            Detection failed{props.errorMessage !== undefined ? `: ${props.errorMessage}` : ''}
          </span>
          {props.onRetry !== undefined ? (
            <button
              type="button"
              className="leo-pii-btn leo-pii-btn-retry"
              aria-label="Retry PII detection"
              onClick={props.onRetry}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {status === 'ready' && findings.length > 0 ? (
        <>
          <header className="leo-pii-header">
            <span className="leo-pii-icon" aria-hidden="true">
              ⚠
            </span>
            <span className="leo-pii-title">
              Sensitive content detected — {pendingCount} pending of {findings.length}
            </span>
          </header>
          <ul className="leo-pii-list" data-slot="pii-findings">
            {findings.map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                decision={decisions.get(f.id)}
                onDecide={props.onDecide}
              />
            ))}
          </ul>
          <footer className="leo-pii-footer">
            <button
              type="button"
              className="leo-pii-btn"
              aria-label="Apply suggested decisions to all findings"
              onClick={props.onApplyAll}
              disabled={pendingCount === 0}
            >
              Apply suggested to all
            </button>
            <button
              type="button"
              className="leo-pii-btn"
              aria-label="Ignore all findings"
              onClick={props.onIgnoreAll}
              disabled={pendingCount === 0}
            >
              Ignore all
            </button>
          </footer>
        </>
      ) : null}
    </section>
  );
}

interface FindingRowProps {
  readonly finding: PiiFinding;
  readonly decision: PiiDecision | undefined;
  readonly onDecide: (id: string, decision: PiiDecision) => void;
}

function FindingRow({ finding, decision, onDecide }: FindingRowProps): JSX.Element {
  return (
    <li
      className="leo-pii-row"
      data-slot="pii-finding"
      data-kind={finding.kind}
      data-decision={decision ?? 'pending'}
    >
      <div className="leo-pii-row-info">
        <span className="leo-pii-kind">{KIND_LABELS[finding.kind]}</span>
        <span className="leo-pii-sample" aria-label="Sample">
          {finding.sample}
        </span>
        {finding.note !== undefined ? <span className="leo-pii-note">{finding.note}</span> : null}
      </div>
      <div className="leo-pii-row-actions" aria-label="Decision">
        <button
          type="button"
          className="leo-pii-btn leo-pii-btn-mask"
          aria-label="Mask this finding"
          aria-pressed={decision === 'mask'}
          onClick={() => onDecide(finding.id, 'mask')}
        >
          Mask
        </button>
        <button
          type="button"
          className="leo-pii-btn leo-pii-btn-remove"
          aria-label="Remove this finding"
          aria-pressed={decision === 'remove'}
          onClick={() => onDecide(finding.id, 'remove')}
        >
          Remove
        </button>
        <button
          type="button"
          className="leo-pii-btn leo-pii-btn-ignore"
          aria-label="Ignore this finding"
          aria-pressed={decision === 'ignore'}
          onClick={() => onDecide(finding.id, 'ignore')}
        >
          Ignore
        </button>
      </div>
    </li>
  );
}
