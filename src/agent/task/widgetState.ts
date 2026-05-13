export type TaskPhase = 'preparing' | 'running' | 'summarizing' | 'done' | 'cancelled' | 'error';

export type TaskErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'no_summary'
  | 'graph_throw'
  | 'reload'
  | 'busy'
  | 'denied';

export interface TaskError {
  readonly code: TaskErrorCode;
  readonly message: string;
}

export interface TaskViewModel {
  readonly runId: string;
  readonly threadId: string;
  readonly prompt: string;
  readonly phase: TaskPhase;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly toolCallsCount: number;
  readonly lastToolId: string | null;
  readonly summary: string | null;
  readonly error: TaskError | null;
}

export const TERMINAL_TASK_PHASES: ReadonlySet<TaskPhase> = new Set(['done', 'cancelled', 'error']);

export function isTerminalTaskPhase(phase: TaskPhase): boolean {
  return TERMINAL_TASK_PHASES.has(phase);
}

export function makeInitialTaskViewModel(input: {
  readonly runId: string;
  readonly threadId: string;
  readonly prompt: string;
}): TaskViewModel {
  return {
    runId: input.runId,
    threadId: input.threadId,
    prompt: input.prompt,
    phase: 'preparing',
    startedAt: null,
    endedAt: null,
    toolCallsCount: 0,
    lastToolId: null,
    summary: null,
    error: null,
  };
}
