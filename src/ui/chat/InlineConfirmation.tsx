import { useEffect, useRef, useSyncExternalStore } from 'react';
import type {
  ConfirmationController,
  ConfirmationDecision,
  PendingConfirmation,
} from '@/agent/confirmationController';
import { prettifyArgs } from '@/agent/confirmationController';

export interface InlineConfirmationSource {
  readonly current: () => PendingConfirmation | null;
  readonly subscribe: (cb: () => void) => () => void;
  readonly resolve: (decision: ConfirmationDecision) => void;
}

export interface InlineConfirmationProps {
  readonly source?: InlineConfirmationSource;
  readonly hidden?: boolean;
}

export function makeInlineConfirmationSource(
  controller: ConfirmationController,
): InlineConfirmationSource {
  return {
    current: () => controller.current(),
    subscribe: (cb) => controller.subscribe(() => cb()),
    resolve: (decision) => controller.resolve(decision),
  };
}

const EMPTY_SOURCE: InlineConfirmationSource = {
  current: () => null,
  subscribe: () => () => undefined,
  resolve: () => undefined,
};

export function InlineConfirmation(props: InlineConfirmationProps): JSX.Element {
  const source = props.source ?? EMPTY_SOURCE;
  const pending = useSyncExternalStore<PendingConfirmation | null>(
    source.subscribe,
    source.current,
    source.current,
  );
  const allowOnceRef = useRef<HTMLButtonElement | null>(null);
  const allowThreadRef = useRef<HTMLButtonElement | null>(null);
  const denyRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (pending === null) return;
    allowOnceRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (pending === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        source.resolve('deny');
        return;
      }
      if (e.key !== 'Tab') return;
      const order = [allowOnceRef.current, allowThreadRef.current, denyRef.current].filter(
        (el): el is HTMLButtonElement => el !== null,
      );
      if (order.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = order.indexOf(active as HTMLButtonElement);
      const dir = e.shiftKey ? -1 : 1;
      const nextIdx = (idx + dir + order.length) % order.length;
      e.preventDefault();
      order[nextIdx]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, source]);

  if (pending === null) {
    return (
      <div
        className="leo-inline-confirmation"
        role="dialog"
        aria-modal="true"
        aria-label="confirmation"
        data-region="confirmation"
        data-visual-state="idle"
        hidden={props.hidden ?? true}
      />
    );
  }

  const { request } = pending;
  const visualState = request.category === 'read' ? 'idle' : 'awaiting-confirmation';
  const pretty = request.argsPretty;

  return (
    <div
      className={`leo-inline-confirmation leo-confirmation-${request.category}`}
      // NOSONAR S6819 — inline chat-flow modal; native <dialog> default styling conflicts with chat-list layout
      role="dialog"
      aria-modal="true"
      aria-label={`confirm tool ${request.toolId}`}
      aria-live="assertive"
      data-region="confirmation"
      data-visual-state={visualState}
      data-tool-id={request.toolId}
    >
      <header className="leo-confirmation-header" data-slot="confirmation-header">
        <strong data-slot="confirmation-tool-name">{request.toolId}</strong>
        <span data-slot="confirmation-category">{request.category}</span>
      </header>
      <pre className="leo-confirmation-args" data-slot="confirmation-args">
        {pretty}
      </pre>
      <div className="leo-confirmation-actions" data-slot="confirmation-actions">
        <button
          ref={allowOnceRef}
          type="button"
          data-slot="confirmation-allow-once"
          onClick={() => source.resolve('allow-once')}
        >
          Allow once
        </button>
        <button
          ref={allowThreadRef}
          type="button"
          data-slot="confirmation-allow-thread"
          onClick={() => source.resolve('allow-thread')}
        >
          Allow for thread
        </button>
        <button
          ref={denyRef}
          type="button"
          data-slot="confirmation-deny"
          onClick={() => source.resolve('deny')}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

export function buildConfirmationRequest(input: {
  toolId: string;
  thread: string;
  argsJson: string;
  category: 'read' | 'write';
}): {
  toolId: string;
  thread: string;
  argsJson: string;
  argsPretty: string;
  category: 'read' | 'write';
} {
  return {
    ...input,
    argsPretty: prettifyArgs(input.argsJson),
  };
}
