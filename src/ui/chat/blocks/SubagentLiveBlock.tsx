import { memo, useSyncExternalStore } from 'react';
import { lookupTaskLiveController } from '@/agent/task/liveControllerRegistry';
import { TaskWidgetController } from '@/agent/task/widgetController';
import type { TaskErrorCode, TaskPhase, TaskViewModel } from '@/agent/task/widgetState';
import type { WidgetComponentProps } from '../widgets/registry';

interface SubagentLiveProps {
  readonly runId: string;
  readonly threadId: string;
  readonly prompt: string;
}

const PHASE_LABEL: Record<TaskPhase, string> = {
  preparing: 'preparing',
  running: 'running',
  summarizing: 'summarizing',
  done: 'done',
  cancelled: 'cancelled',
  error: 'error',
};

const ERROR_LABEL: Record<TaskErrorCode, string> = {
  cancelled: 'Cancelled',
  timeout: 'Timed out',
  no_summary: 'No final answer produced',
  graph_throw: 'Subagent threw',
  reload: 'Discarded by reload',
  busy: 'Too many concurrent tasks',
  denied: 'Denied by user',
};

function SubagentLiveBlockImpl({ props }: WidgetComponentProps): JSX.Element | null {
  const raw = props as Partial<SubagentLiveProps> | null;
  if (raw === null || typeof raw !== 'object') return null;
  const { runId, threadId, prompt } = raw;
  if (typeof runId !== 'string' || typeof threadId !== 'string' || typeof prompt !== 'string') {
    return null;
  }
  const live = lookupTaskLiveController(runId);
  if (live !== null && live instanceof TaskWidgetController) {
    return <SubagentWidget controller={live} />;
  }
  const synthetic = TaskWidgetController.reloadRehydrate({ runId, threadId, prompt });
  return <SubagentWidget controller={synthetic} />;
}

export function SubagentWidget({ controller }: { controller: TaskWidgetController }): JSX.Element {
  const vm = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.viewModel(),
    () => controller.viewModel(),
  );
  return <SubagentWidgetView vm={vm} />;
}

function SubagentWidgetView({ vm }: { vm: TaskViewModel }): JSX.Element {
  return (
    <section
      className={`leo-root leo-subagent-widget leo-subagent-${vm.phase}`}
      data-slot="subagent-widget"
      data-phase={vm.phase}
      data-runid={vm.runId}
      aria-label={`Subagent run ${vm.runId} (phase: ${vm.phase})`}
    >
      <header className="leo-subagent-header">
        <span className="leo-subagent-title">
          Subagent <span className="leo-subagent-runid">· {vm.runId}</span>
        </span>
        <span className="leo-subagent-phase" data-phase-label>
          {PHASE_LABEL[vm.phase]}
        </span>
      </header>
      <p className="leo-subagent-prompt" data-slot="subagent-prompt">
        {truncate(vm.prompt, 200)}
      </p>
      <ul className="leo-subagent-stats" data-slot="subagent-stats">
        <li>
          Tool calls: <strong>{vm.toolCallsCount}</strong>
        </li>
        {vm.lastToolId !== null ? (
          <li>
            Last tool: <code>{vm.lastToolId}</code>
          </li>
        ) : null}
        {vm.startedAt !== null ? (
          <li>Duration: {formatDuration(vm.startedAt, vm.endedAt)}</li>
        ) : null}
      </ul>
      {vm.phase === 'done' && vm.summary !== null ? (
        <p className="leo-subagent-summary" data-slot="subagent-summary">
          {truncate(vm.summary, 240)}
        </p>
      ) : null}
      {vm.error !== null ? (
        <p className="leo-subagent-error" data-slot="subagent-error">
          <strong>{ERROR_LABEL[vm.error.code]}</strong>: {vm.error.message}
        </p>
      ) : null}
    </section>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function formatDuration(start: number | null, end: number | null): string {
  if (start === null) return '—';
  const ref = end ?? Date.now();
  if (ref < start) return '—';
  const ms = ref - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const SubagentLiveBlock = memo(SubagentLiveBlockImpl);
