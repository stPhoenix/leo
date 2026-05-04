import { useSyncExternalStore } from 'react';
import type {
  AcceptRejectController,
  AcceptRejectDecision,
  PendingAcceptReject,
} from '@/agent/acceptRejectController';

export interface AcceptRejectSource {
  readonly current: () => PendingAcceptReject | null;
  readonly subscribe: (cb: () => void) => () => void;
  readonly resolve: (decision: AcceptRejectDecision) => void;
}

export function makeAcceptRejectSource(controller: AcceptRejectController): AcceptRejectSource {
  return {
    current: () => controller.current(),
    subscribe: (cb) => controller.subscribe(() => cb()),
    resolve: (decision) => controller.resolve(decision),
  };
}

const EMPTY_SOURCE: AcceptRejectSource = {
  current: () => null,
  subscribe: () => () => undefined,
  resolve: () => undefined,
};

export interface InlineDialogProps {
  readonly source?: AcceptRejectSource;
  readonly hidden?: boolean;
}

export function InlineDialog(props: InlineDialogProps): JSX.Element {
  const source = props.source ?? EMPTY_SOURCE;
  const pending = useSyncExternalStore<PendingAcceptReject | null>(
    source.subscribe,
    source.current,
    source.current,
  );
  if (pending === null) {
    return (
      <div
        className="leo-inline-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="dialog"
        data-region="dialog"
        hidden={props.hidden ?? true}
      />
    );
  }
  const { proposal } = pending;
  return (
    <div
      className="leo-inline-dialog leo-accept-reject"
      // NOSONAR S6819 — inline chat-flow modal; native <dialog> default styling conflicts with chat-list layout
      role="dialog"
      aria-modal="true"
      aria-label={`review ${proposal.toolId} edit`}
      data-region="dialog"
      data-tool-id={proposal.toolId}
      data-routed-via={proposal.routedVia}
    >
      <header className="leo-accept-reject-header" data-slot="accept-reject-header">
        <strong>{proposal.toolId}</strong>
        <span>{proposal.path}</span>
        {proposal.intent === 'edit' ? (
          <span>
            L{proposal.lineStart}–L{proposal.lineEnd}
          </span>
        ) : (
          <span>{proposal.intent}</span>
        )}
      </header>
      <div className="leo-accept-reject-actions" data-slot="accept-reject-actions">
        <button
          type="button"
          data-slot="accept-reject-accept"
          aria-label="Accept edit"
          onClick={() => source.resolve('accept')}
        >
          Accept
        </button>
        <button
          type="button"
          data-slot="accept-reject-reject"
          aria-label="Reject edit and revert"
          onClick={() => source.resolve('reject')}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
