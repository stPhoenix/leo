import { buildCompactTerminalSnapshot, type CompactTerminalSnapshot } from './terminalSnapshot';
import {
  isTerminalCompactPhase,
  makeInitialCompactViewModel,
  type CompactError,
  type CompactErrorCode,
  type CompactPhase,
  type CompactTrigger,
  type CompactViewModel,
} from './widgetState';

export interface CompactWidgetControllerOptions {
  readonly runId: string;
  readonly threadId: string;
  readonly trigger: CompactTrigger;
  readonly customInstructions?: string;
  readonly initialViewModel?: CompactViewModel;
}

export type CompactWidgetListener = (vm: CompactViewModel) => void;

export class CompactWidgetController {
  private vm: CompactViewModel;
  private readonly listeners = new Set<CompactWidgetListener>();
  private disposed = false;

  constructor(opts: CompactWidgetControllerOptions) {
    this.vm =
      opts.initialViewModel ??
      makeInitialCompactViewModel({
        runId: opts.runId,
        threadId: opts.threadId,
        trigger: opts.trigger,
        ...(opts.customInstructions !== undefined
          ? { customInstructions: opts.customInstructions }
          : {}),
      });
  }

  static reloadRehydrate(opts: {
    runId: string;
    threadId: string;
    trigger: CompactTrigger;
  }): CompactWidgetController {
    const base = makeInitialCompactViewModel(opts);
    return new CompactWidgetController({
      ...opts,
      initialViewModel: {
        ...base,
        phase: 'error',
        error: { code: 'reload', message: 'Compact run discarded by plugin reload' },
      },
    });
  }

  viewModel(): CompactViewModel {
    return this.vm;
  }

  subscribe(listener: CompactWidgetListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  update(patch: Partial<CompactViewModel>): void {
    if (this.disposed) return;
    const next: CompactViewModel = { ...this.vm, ...patch };
    this.vm = next;
    for (const l of this.listeners) {
      try {
        l(next);
      } catch {
        /* listener failures isolated */
      }
    }
  }

  setPhase(phase: CompactPhase, extra: Partial<CompactViewModel> = {}): void {
    const now = Date.now();
    const startedAt = this.vm.startedAt === null && phase !== 'idle' ? now : this.vm.startedAt;
    const endedAt = isTerminalCompactPhase(phase) ? now : this.vm.endedAt;
    this.update({ ...extra, phase, startedAt, endedAt });
  }

  recordError(code: CompactErrorCode, message: string): void {
    const err: CompactError = { code, message };
    this.setPhase('error', { error: err });
  }

  toTerminalSnapshot(): CompactTerminalSnapshot {
    return buildCompactTerminalSnapshot({ view: this.vm });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }
}
