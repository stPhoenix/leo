import { memo, useSyncExternalStore } from 'react';
import type { ProgressEvent } from '@/chat/runStateStore';
import type { RunStateSource } from './toolUseStatus';
import { AgentProgressTree } from './AgentProgressTree';

export interface ProgressLinesProps {
  readonly toolUseId: string;
  readonly runState: RunStateSource;
  readonly maxVisible?: number;
}

const DEFAULT_MAX = 5;

function useProgress(source: RunStateSource, id: string): readonly ProgressEvent[] {
  const subscribe = (cb: () => void): (() => void) => {
    if (source.subscribeToolUse !== undefined) return source.subscribeToolUse(id, cb);
    return source.subscribe(cb);
  };
  const get = (): readonly ProgressEvent[] =>
    source.getSnapshot().progressByToolUseId.get(id) ?? EMPTY;
  return useSyncExternalStore(subscribe, get, get);
}

const EMPTY: readonly ProgressEvent[] = [];

function ProgressLinesImpl(props: ProgressLinesProps): JSX.Element | null {
  const events = useProgress(props.runState, props.toolUseId);
  if (events.length === 0) return null;

  const agentEvents = events.filter((e) => e.kind === 'agent');
  const otherEvents = events.filter((e) => e.kind !== 'agent');
  const max = props.maxVisible ?? DEFAULT_MAX;
  const visible = otherEvents.slice(-max);
  const hidden = otherEvents.length - visible.length;

  return (
    <div
      className="leo-progress-lines"
      data-slot="progress-lines"
      data-tool-use-id={props.toolUseId}
    >
      {visible.map((ev, i) => (
        <div
          key={`${i}:${ev.kind}`}
          className={`leo-progress-line leo-progress-line-${ev.kind}`}
          data-kind={ev.kind}
        >
          └─ {formatProgress(ev)}
        </div>
      ))}
      {hidden > 0 ? (
        <div className="leo-progress-line leo-progress-overflow" data-slot="progress-overflow">
          …+{hidden} more
        </div>
      ) : null}
      {agentEvents.length > 0 ? <AgentProgressTree events={agentEvents} /> : null}
    </div>
  );
}

export function formatProgress(ev: ProgressEvent): string {
  if (ev.kind === 'bash') {
    const out = ev.stdout ?? ev.stderr ?? '';
    const tail = out.slice(-120);
    if (ev.exitCode !== undefined) return `bash exit=${ev.exitCode} · ${tail}`.trim();
    return tail.length > 0 ? tail : 'running…';
  }
  if (ev.kind === 'web_search') {
    return `${ev.query} · ${ev.resultsSoFar} results`;
  }
  if (ev.kind === 'task_output') {
    return `${ev.taskId} · ${ev.status}`;
  }
  if (ev.kind === 'mcp') {
    return `${ev.serverName} · ${ev.methodCall}`;
  }
  if (ev.kind === 'skill') {
    return `${ev.skillName} · ${ev.status}`;
  }
  return '…';
}

export const ProgressLines = memo(ProgressLinesImpl);
