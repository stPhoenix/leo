import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {
  PendingPlanApproval,
  PlanApprovalController,
  PlanApprovalOutcome,
} from '@/agent/planApprovalController';

export type PlanMarkdownRenderFn = (container: HTMLElement, plan: string) => (() => void) | void;

export interface PlanApprovalSource {
  readonly current: () => PendingPlanApproval | null;
  readonly subscribe: (cb: () => void) => () => void;
  readonly resolve: (outcome: PlanApprovalOutcome) => void;
}

export function makePlanApprovalSource(controller: PlanApprovalController): PlanApprovalSource {
  return {
    current: () => controller.current(),
    subscribe: (cb) => controller.subscribe(() => cb()),
    resolve: (outcome) => controller.resolve(outcome),
  };
}

const EMPTY_SOURCE: PlanApprovalSource = {
  current: () => null,
  subscribe: () => () => undefined,
  resolve: () => undefined,
};

export interface PlanApprovalDialogProps {
  readonly source?: PlanApprovalSource;
  readonly renderMarkdown?: PlanMarkdownRenderFn;
  readonly hidden?: boolean;
}

type DialogState = { readonly phase: 'view' } | { readonly phase: 'edit'; readonly draft: string };

export function PlanApprovalDialog(props: PlanApprovalDialogProps): JSX.Element {
  const source = props.source ?? EMPTY_SOURCE;
  const pending = useSyncExternalStore<PendingPlanApproval | null>(
    source.subscribe,
    source.current,
    source.current,
  );
  const [state, setState] = useState<DialogState>({ phase: 'view' });
  const approveRef = useRef<HTMLButtonElement | null>(null);
  const editRef = useRef<HTMLButtonElement | null>(null);
  const rejectRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const markdownContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (pending === null) {
      setState({ phase: 'view' });
    }
  }, [pending]);

  useEffect(() => {
    if (pending === null) return;
    if (state.phase === 'view') {
      approveRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [pending, state.phase]);

  useEffect(() => {
    if (pending === null) return;
    if (state.phase !== 'view') return;
    const render = props.renderMarkdown;
    const container = markdownContainerRef.current;
    if (render === undefined || container === null) return;
    container.innerHTML = '';
    const cleanup = render(container, pending.request.plan);
    return () => {
      if (typeof cleanup === 'function') cleanup();
      container.innerHTML = '';
    };
  }, [pending, state.phase, props.renderMarkdown]);

  useEffect(() => {
    if (pending === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (state.phase === 'edit') {
          setState({ phase: 'view' });
          return;
        }
        source.resolve({ type: 'reject' });
        return;
      }
      if (e.key !== 'Tab') return;
      const order: ReadonlyArray<HTMLElement | null> =
        state.phase === 'view'
          ? [approveRef.current, editRef.current, rejectRef.current]
          : [textareaRef.current, confirmRef.current, cancelRef.current];
      const elements = order.filter((el): el is HTMLElement => el !== null);
      if (elements.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = elements.indexOf(active as HTMLElement);
      const dir = e.shiftKey ? -1 : 1;
      const nextIdx = (idx + dir + elements.length) % elements.length;
      e.preventDefault();
      elements[nextIdx]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, state, source]);

  if (pending === null) {
    return (
      <div
        className="leo-plan-approval"
        role="dialog"
        aria-modal="true"
        aria-label="plan approval"
        data-region="plan-approval"
        hidden={props.hidden ?? true}
      />
    );
  }
  const { plan } = pending.request;
  if (state.phase === 'view') {
    return (
      <div
        className="leo-plan-approval leo-plan-approval-view"
        role="dialog"
        aria-modal="true"
        aria-label="Plan approval"
        aria-live="assertive"
        data-region="plan-approval"
        data-phase="view"
      >
        <header className="leo-plan-approval-header" data-slot="plan-approval-header">
          <strong>Plan approval required</strong>
        </header>
        <div
          className="leo-plan-approval-body"
          data-slot="plan-approval-body"
          ref={markdownContainerRef}
        >
          {props.renderMarkdown === undefined ? (
            <pre data-slot="plan-approval-plan">{plan}</pre>
          ) : null}
        </div>
        <div className="leo-plan-approval-actions" data-slot="plan-approval-actions">
          <button
            ref={approveRef}
            type="button"
            data-slot="plan-approval-approve"
            onClick={() => source.resolve({ type: 'approve', planWasEdited: false, plan })}
          >
            Approve
          </button>
          <button
            ref={editRef}
            type="button"
            data-slot="plan-approval-edit"
            onClick={() => setState({ phase: 'edit', draft: plan })}
          >
            Edit
          </button>
          <button
            ref={rejectRef}
            type="button"
            data-slot="plan-approval-reject"
            onClick={() => source.resolve({ type: 'reject' })}
          >
            Reject
          </button>
        </div>
      </div>
    );
  }
  return (
    <div
      className="leo-plan-approval leo-plan-approval-edit"
      role="dialog"
      aria-modal="true"
      aria-label="Edit plan"
      data-region="plan-approval"
      data-phase="edit"
    >
      <header className="leo-plan-approval-header" data-slot="plan-approval-header">
        <strong>Edit plan</strong>
      </header>
      <textarea
        ref={textareaRef}
        className="leo-plan-approval-textarea"
        data-slot="plan-approval-textarea"
        value={state.draft}
        onChange={(e) => setState({ phase: 'edit', draft: e.target.value })}
      />
      <div className="leo-plan-approval-actions" data-slot="plan-approval-actions">
        <button
          ref={confirmRef}
          type="button"
          data-slot="plan-approval-confirm"
          onClick={() => source.resolve({ type: 'edit', planWasEdited: true, plan: state.draft })}
        >
          Confirm
        </button>
        <button
          ref={cancelRef}
          type="button"
          data-slot="plan-approval-cancel"
          onClick={() => setState({ phase: 'view' })}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
