import { useSyncExternalStore } from 'react';
import type { ToolUseBlock } from '@/chat/types';
import type { RunStateSnapshot } from '@/chat/runStateStore';
import { statusOf } from '@/chat/runStateStore';
import { useBlink } from '../hooks/useBlink';

export type ToolUseStatus = 'queued' | 'running' | 'success' | 'errored' | 'rejected' | 'canceled';

export interface RunStateSource {
  readonly getSnapshot: () => RunStateSnapshot;
  readonly subscribe: (cb: () => void) => () => void;
  readonly subscribeToolUse?: (id: string, cb: () => void) => () => void;
}

export function useToolUseStatus(
  source: RunStateSource | undefined,
  id: string,
): ToolUseStatus | null {
  const subscribe = (cb: () => void): (() => void) => {
    if (source === undefined) return () => undefined;
    if (source.subscribeToolUse !== undefined) return source.subscribeToolUse(id, cb);
    return source.subscribe(cb);
  };
  const get = (): ToolUseStatus => {
    if (source === undefined) return 'queued';
    return statusOf(source.getSnapshot(), id);
  };
  const status = useSyncExternalStore(subscribe, get, get);
  return source === undefined ? null : status;
}

export function resolveStatus(fromStore: ToolUseStatus | null, block: ToolUseBlock): ToolUseStatus {
  if (block.decision === 'deny') return 'rejected';
  if (fromStore !== null) return fromStore;
  return 'queued';
}

export const STATUS_LABEL: Readonly<Record<ToolUseStatus, string>> = {
  queued: 'queued',
  running: 'running',
  success: 'succeeded',
  errored: 'failed',
  rejected: 'rejected',
  canceled: 'canceled',
};

export interface StatusGlyphProps {
  readonly status: ToolUseStatus;
  readonly blink?: boolean;
  readonly blinkIntervalMs?: number;
}

export function StatusGlyph(props: StatusGlyphProps): JSX.Element {
  const { status } = props;
  const isRunning = props.blink ?? status === 'running';
  const visible = useBlink(isRunning, { intervalMs: props.blinkIntervalMs ?? 500 });
  const showDot = !isRunning || visible;
  return (
    <span
      className={`leo-status-glyph leo-status-glyph-${status}${isRunning ? ' is-running' : ''}`}
      data-slot="status-glyph"
      data-status={status}
      data-blink={isRunning ? 'true' : 'false'}
      role="img"
      aria-label={STATUS_LABEL[status]}
    >
      <span aria-hidden="true" data-slot="status-glyph-dot">
        {showDot ? '●' : ' '}
      </span>
    </span>
  );
}
