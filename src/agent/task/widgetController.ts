import { buildTaskTerminalSnapshot, type TaskTerminalSnapshot } from './terminalSnapshot';
import {
  isTerminalTaskPhase,
  makeInitialTaskViewModel,
  type TaskError,
  type TaskErrorCode,
  type TaskPhase,
  type TaskViewModel,
} from './widgetState';

export interface TaskWidgetControllerOptions {
  readonly runId: string;
  readonly threadId: string;
  readonly prompt: string;
  readonly initialViewModel?: TaskViewModel;
}

export type TaskWidgetListener = (vm: TaskViewModel) => void;

export class TaskWidgetController {
  private vm: TaskViewModel;
  private readonly listeners = new Set<TaskWidgetListener>();
  private disposed = false;

  constructor(opts: TaskWidgetControllerOptions) {
    this.vm =
      opts.initialViewModel ??
      makeInitialTaskViewModel({
        runId: opts.runId,
        threadId: opts.threadId,
        prompt: opts.prompt,
      });
  }

  static reloadRehydrate(opts: {
    runId: string;
    threadId: string;
    prompt: string;
  }): TaskWidgetController {
    const base = makeInitialTaskViewModel(opts);
    return new TaskWidgetController({
      ...opts,
      initialViewModel: {
        ...base,
        phase: 'error',
        error: { code: 'reload', message: 'Task subagent run discarded by plugin reload' },
      },
    });
  }

  viewModel(): TaskViewModel {
    return this.vm;
  }

  subscribe(listener: TaskWidgetListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  update(patch: Partial<TaskViewModel>): void {
    if (this.disposed) return;
    const next: TaskViewModel = { ...this.vm, ...patch };
    this.vm = next;
    for (const l of this.listeners) {
      try {
        l(next);
      } catch {
        /* listener failures isolated */
      }
    }
  }

  setPhase(phase: TaskPhase, extra: Partial<TaskViewModel> = {}): void {
    const now = Date.now();
    const startedAt = this.vm.startedAt === null && phase !== 'preparing' ? now : this.vm.startedAt;
    const endedAt = isTerminalTaskPhase(phase) ? now : this.vm.endedAt;
    this.update({ ...extra, phase, startedAt, endedAt });
  }

  setDeadline(deadlineMs: number | null): void {
    this.update({ deadlineMs });
  }

  noteToolCall(toolId: string): void {
    this.update({
      toolCallsCount: this.vm.toolCallsCount + 1,
      lastToolId: toolId,
    });
  }

  recordError(code: TaskErrorCode, message: string): void {
    const err: TaskError = { code, message };
    this.setPhase('error', { error: err });
  }

  toTerminalSnapshot(): TaskTerminalSnapshot {
    return buildTaskTerminalSnapshot({ view: this.vm });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }
}
