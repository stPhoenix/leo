import { memo } from 'react';
import type { ProgressEvent } from '@/chat/runStateStore';

export interface AgentSnapshot {
  readonly agentId: string;
  readonly agentType: string;
  readonly toolUseCount: number;
  readonly tokens?: number;
  readonly lastToolInfo?: string;
  readonly isResolved?: boolean;
  readonly isError?: boolean;
}

export interface AgentProgressTreeProps {
  readonly events: readonly ProgressEvent[];
}

export function aggregateAgentProgress(
  events: readonly ProgressEvent[],
): ReadonlyMap<string, AgentSnapshot> {
  const out = new Map<string, AgentSnapshot>();
  for (const ev of events) {
    if (ev.kind !== 'agent') continue;
    out.set(ev.agentId, {
      agentId: ev.agentId,
      agentType: ev.agentType,
      toolUseCount: ev.toolUseCount,
      ...(ev.tokens !== undefined ? { tokens: ev.tokens } : {}),
      ...(ev.lastToolInfo !== undefined ? { lastToolInfo: ev.lastToolInfo } : {}),
      ...(ev.isResolved !== undefined ? { isResolved: ev.isResolved } : {}),
      ...(ev.isError !== undefined ? { isError: ev.isError } : {}),
    });
  }
  return out;
}

function AgentProgressTreeImpl(props: AgentProgressTreeProps): JSX.Element | null {
  const snapshots = Array.from(aggregateAgentProgress(props.events).values());
  if (snapshots.length === 0) return null;
  return (
    <div className="leo-agent-tree" data-slot="agent-tree">
      {snapshots.map((s, i) => {
        const isLast = i === snapshots.length - 1;
        const connector = isLast ? '└─' : '├─';
        const tokens = s.tokens !== undefined ? `${s.tokens} tokens` : '0 tokens';
        let last: string;
        if (s.isResolved) {
          last = s.isError ? 'Done (error)' : 'Done';
        } else {
          last = s.lastToolInfo ?? 'Initializing…';
        }
        return (
          <div
            key={s.agentId}
            className="leo-agent-row"
            data-slot="agent-row"
            data-agent-id={s.agentId}
            data-resolved={s.isResolved ? 'true' : 'false'}
          >
            <div data-slot="agent-line">
              {connector} {s.agentType} · {s.toolUseCount} tools · {tokens}
            </div>
            <div data-slot="agent-sub" className="leo-agent-sub">
              &nbsp;&nbsp; └─ {last}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const AgentProgressTree = memo(AgentProgressTreeImpl);
