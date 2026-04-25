import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ToolUseBlock, ConfirmationDecisionTag } from '@/chat/types';
import type { PermissionRequest } from '@/chat/runStateStore';
import type { RunStateSource } from './toolUseStatus';

export interface InlinePermissionPromptProps {
  readonly block: ToolUseBlock;
  readonly runState: RunStateSource;
  readonly onResolve: (decision: ConfirmationDecisionTag) => void;
}

function usePermissionRequest(source: RunStateSource, id: string): PermissionRequest | null {
  const subscribe = (cb: () => void): (() => void) => {
    if (source.subscribeToolUse !== undefined) return source.subscribeToolUse(id, cb);
    return source.subscribe(cb);
  };
  const get = (): PermissionRequest | null =>
    source.getSnapshot().permissionRequests.get(id) ?? null;
  return useSyncExternalStore(subscribe, get, get);
}

export function InlinePermissionPrompt(props: InlinePermissionPromptProps): JSX.Element | null {
  const pending = usePermissionRequest(props.runState, props.block.id);
  const allowOnceRef = useRef<HTMLButtonElement | null>(null);
  const allowThreadRef = useRef<HTMLButtonElement | null>(null);
  const denyRef = useRef<HTMLButtonElement | null>(null);

  // Historical answered state: render decision pill, no buttons.
  const decision = props.block.decision;

  useEffect(() => {
    if (pending === null) return;
    allowOnceRef.current?.focus();
  }, [pending !== null]);

  useEffect(() => {
    if (pending === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onResolve('deny');
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
  }, [pending !== null, props.onResolve]);

  if (pending === null && decision === undefined) return null;

  if (pending === null && decision !== undefined) {
    return (
      <div
        className={`leo-inline-permission leo-inline-permission-${decision}`}
        data-slot="permission-historical"
        data-decision={decision}
        role="status"
      >
        <span data-slot="permission-pill">{decisionLabel(decision)}</span>
      </div>
    );
  }

  return (
    <div
      className={`leo-inline-permission leo-inline-permission-${pending!.category}`}
      role="dialog"
      aria-modal="true"
      aria-label={`confirm tool ${pending!.toolId}`}
      aria-live="assertive"
      data-slot="permission-pending"
      data-tool-id={pending!.toolId}
      data-category={pending!.category}
    >
      <header className="leo-inline-permission-header">
        ⚠ Allow <strong>{props.block.name}</strong>?
      </header>
      <div className="leo-inline-permission-actions">
        <button
          ref={allowOnceRef}
          type="button"
          data-slot="permission-allow-once"
          onClick={() => props.onResolve('allow-once')}
        >
          Allow once
        </button>
        <button
          ref={allowThreadRef}
          type="button"
          data-slot="permission-allow-thread"
          onClick={() => props.onResolve('allow-thread')}
        >
          Allow for thread
        </button>
        <button
          ref={denyRef}
          type="button"
          data-slot="permission-deny"
          onClick={() => props.onResolve('deny')}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function decisionLabel(d: ConfirmationDecisionTag): string {
  if (d === 'allow-once') return 'Allowed once';
  if (d === 'allow-thread') return 'Allowed for thread';
  return 'Denied';
}
