import { memo, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  lookupTaskLiveController,
  type TaskLiveHandleLike,
} from '@/agent/task/liveControllerRegistry';
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

const EXTEND_STEP_MS = 5 * 60_000;
const EXTENDABLE_PHASES: ReadonlySet<TaskPhase> = new Set(['preparing', 'running', 'summarizing']);

function SubagentLiveBlockImpl({ props }: WidgetComponentProps): JSX.Element | null {
  const raw = props as Partial<SubagentLiveProps> | null;
  if (raw === null || typeof raw !== 'object') return null;
  const { runId, threadId, prompt } = raw;
  if (typeof runId !== 'string' || typeof threadId !== 'string' || typeof prompt !== 'string') {
    return null;
  }
  const entry = lookupTaskLiveController(runId);
  if (entry !== null && entry.controller instanceof TaskWidgetController) {
    return <SubagentWidget controller={entry.controller} handle={entry.handle} />;
  }
  const synthetic = TaskWidgetController.reloadRehydrate({ runId, threadId, prompt });
  return <SubagentWidget controller={synthetic} handle={null} />;
}

export function SubagentWidget({
  controller,
  handle,
}: {
  controller: TaskWidgetController;
  handle: TaskLiveHandleLike | null;
}): JSX.Element {
  const vm = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.viewModel(),
    () => controller.viewModel(),
  );
  return <SubagentWidgetView vm={vm} handle={handle} />;
}

function SubagentWidgetView({
  vm,
  handle,
}: {
  vm: TaskViewModel;
  handle: TaskLiveHandleLike | null;
}): JSX.Element {
  const canExtend = handle !== null && EXTENDABLE_PHASES.has(vm.phase) && vm.deadlineMs !== null;
  const [capReached, setCapReached] = useState(false);

  const onExtend = useCallback(() => {
    if (handle === null) return;
    const res = handle.extendTimeout(EXTEND_STEP_MS);
    if (!res.ok && res.reason === 'cap_reached') {
      setCapReached(true);
    }
  }, [handle]);

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
        {canExtend ? <TimeoutCountdown deadlineMs={vm.deadlineMs as number} /> : null}
        {canExtend ? (
          <button
            type="button"
            className="leo-subagent-extend"
            data-slot="subagent-extend"
            onClick={onExtend}
            disabled={capReached}
            title={capReached ? 'Max 30 min reached' : 'Extend timeout by 5 minutes'}
          >
            +5m
          </button>
        ) : null}
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

function TimeoutCountdown({ deadlineMs }: { deadlineMs: number }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return (): void => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, deadlineMs - now);
  return (
    <span className="leo-subagent-timeout" data-slot="subagent-timeout">
      timeout in {formatRemaining(remainingMs)}
    </span>
  );
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min}m` : `${min}m${sec}s`;
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
