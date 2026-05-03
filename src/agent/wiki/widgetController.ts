import type { WikiOp } from '@/agent/wiki/mutexTypes';
import {
  buildWikiTerminalSnapshot,
  type WikiTerminalSnapshot,
} from '@/agent/wiki/terminalSnapshot';
import {
  isTerminal,
  makeInitialViewModel,
  type WikiViewModel,
} from '@/agent/wiki/widgetState';

export interface WikiWidgetActions {
  answerClarification?(text: string): void;
  resolveDuplicate?(decision: 'skip' | 'reprocess' | 'replace'): void;
  applyLintConfirm?(payload: {
    readonly accepted: readonly string[];
    readonly rejected: readonly string[];
    readonly applySchema: boolean;
  }): void;
  cancel?(): void;
}

export interface WikiWidgetControllerOptions {
  readonly runId: string;
  readonly threadId: string;
  readonly op: WikiOp;
  readonly actions?: WikiWidgetActions;
  /**
   * Optional initial view model — used when rehydrating after plugin reload to
   * force the widget into `phase='error', error.code='reload'`.
   */
  readonly initialViewModel?: WikiViewModel;
}

export type WikiWidgetListener = (vm: WikiViewModel) => void;

export class WikiWidgetController {
  private vm: WikiViewModel;
  private readonly listeners = new Set<WikiWidgetListener>();
  private actions: WikiWidgetActions;
  private disposed = false;

  constructor(opts: WikiWidgetControllerOptions) {
    this.vm =
      opts.initialViewModel ??
      makeInitialViewModel({ runId: opts.runId, threadId: opts.threadId, op: opts.op });
    this.actions = opts.actions ?? {};
  }

  static reloadRehydrate(opts: {
    runId: string;
    threadId: string;
    op: WikiOp;
  }): WikiWidgetController {
    const base = makeInitialViewModel(opts);
    return new WikiWidgetController({
      ...opts,
      initialViewModel: {
        ...base,
        phase: 'error',
        error: { code: 'reload', message: 'Run discarded by plugin reload' },
      },
    });
  }

  viewModel(): WikiViewModel {
    return this.vm;
  }

  subscribe(listener: WikiWidgetListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Apply a partial state update. Subgraph drivers (F11/F18) call this; the
   * widget framework itself never mutates state. Emits to listeners only when
   * the patched view differs from the current one (shallow ref check).
   */
  update(patch: Partial<WikiViewModel>): void {
    if (this.disposed) return;
    const next: WikiViewModel = { ...this.vm, ...patch };
    this.vm = next;
    for (const l of this.listeners) {
      try {
        l(next);
      } catch {
        /* listener failures isolated */
      }
    }
  }

  setPhase(phase: WikiViewModel['phase'], extra: Partial<WikiViewModel> = {}): void {
    const now = Date.now();
    const startedAt =
      this.vm.startedAt === null && phase !== 'idle' ? now : this.vm.startedAt;
    const endedAt = isTerminal(phase) ? now : this.vm.endedAt;
    this.update({ ...extra, phase, startedAt, endedAt });
  }

  recordError(code: string, message: string): void {
    this.setPhase('error', { error: { code, message } });
  }

  toTerminalSnapshot(): WikiTerminalSnapshot {
    return buildWikiTerminalSnapshot({ view: this.vm });
  }

  // Action forwarding — lookup at call time so undefined actions are no-ops.
  answerClarification(text: string): void {
    this.actions.answerClarification?.(text);
  }
  resolveDuplicate(decision: 'skip' | 'reprocess' | 'replace'): void {
    this.actions.resolveDuplicate?.(decision);
  }
  applyLintConfirm(payload: {
    readonly accepted: readonly string[];
    readonly rejected: readonly string[];
    readonly applySchema: boolean;
  }): void {
    this.actions.applyLintConfirm?.(payload);
  }
  cancel(): void {
    this.actions.cancel?.();
  }

  setActions(actions: WikiWidgetActions): void {
    this.actions = { ...this.actions, ...actions };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }
}
