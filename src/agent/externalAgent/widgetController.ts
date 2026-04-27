import type { AdapterRegistry } from './adapterRegistry';
import type { SlotManager } from './slotManager';
import type { RunHandle } from './subgraph';
import type { ExternalAgentState, LogEvent } from './state';

export const TIMEOUT_MIN_MS = 1_000;
export const TIMEOUT_MAX_MS = 24 * 3600 * 1000;
export const REFINE_BUDGET_MIN = 1;
export const REFINE_BUDGET_MAX = 10;

export interface AdapterOption {
  readonly id: string;
  readonly label: string;
  readonly defaultTimeoutMs: number;
}

export interface WidgetEventLog {
  readonly level: LogEvent['level'];
  readonly msg: string;
  readonly ts: number;
}

interface BaseViewModel {
  readonly runId: string;
  readonly threadId: string;
  readonly originalAsk: string;
  readonly adapters: readonly AdapterOption[];
  readonly draftAdapterId: string | null;
  readonly draftTimeoutMs: number;
  readonly draftRefineBudget: number;
  readonly clarifyingQuestion: string | null;
  readonly logEvents: readonly WidgetEventLog[];
  readonly validationError: string | null;
}

export type WidgetViewModel = BaseViewModel & {
  readonly phase:
    | 'preparing'
    | 'awaiting_clarify'
    | 'ready'
    | 'running'
    | 'writing'
    | 'done'
    | 'cancelled'
    | 'error';
  readonly refinedPrompt: string | null;
  readonly textBuffer: string;
  readonly resultFolder: string | null;
  readonly writtenFiles: readonly string[];
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
};

export type WidgetListener = (vm: WidgetViewModel) => void;

export interface WidgetControllerDeps {
  readonly runId: string;
  readonly threadId: string;
  readonly slots: SlotManager;
  readonly registry: AdapterRegistry;
  /**
   * Lookup the live `RunHandle` for `runId`. Returns null if the run is not
   * present in this process (e.g. plugin reload, or run already terminated
   * and disposed). When null, the controller starts in the `error` phase
   * with `code='reload'`.
   */
  readonly findHandle: (runId: string) => RunHandle | null;
}

const DEFAULT_BUDGET = 3;
const DEFAULT_TIMEOUT_MS = 60_000;

export class ExternalAgentWidgetController {
  private readonly deps: WidgetControllerDeps;
  private readonly listeners = new Set<WidgetListener>();
  private currentVm: WidgetViewModel;
  private readonly handle: RunHandle | null;
  private unsubscribeHandle: (() => void) | null = null;
  private disposed = false;
  private draftAdapterId: string | null = null;
  private draftTimeoutMs: number = DEFAULT_TIMEOUT_MS;
  private draftRefineBudget: number = DEFAULT_BUDGET;
  private validationError: string | null = null;

  constructor(deps: WidgetControllerDeps) {
    this.deps = deps;
    this.handle = deps.findHandle(deps.runId);
    if (this.handle === null) {
      this.currentVm = this.buildReloadErrorVm();
      return;
    }
    const initial = this.handle.state();
    this.draftAdapterId = initial.selectedAdapterId;
    this.draftTimeoutMs = initial.timeoutMs > 0 ? initial.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.draftRefineBudget = initial.refineBudget > 0 ? initial.refineBudget : DEFAULT_BUDGET;
    this.currentVm = this.project(initial);
    this.unsubscribeHandle = this.handle.subscribe((next) => this.onState(next));
  }

  viewModel(): WidgetViewModel {
    return this.currentVm;
  }

  subscribe(listener: WidgetListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeHandle?.();
    this.unsubscribeHandle = null;
    this.listeners.clear();
  }

  // --- action handlers ---

  onSelectAdapter(id: string): void {
    if (this.disposed) return;
    if (!this.deps.registry.isEnabled(id)) {
      this.setValidationError(`Adapter not enabled: ${id}`);
      return;
    }
    this.draftAdapterId = id;
    this.clearValidationAndPush();
  }

  onSetTimeout(ms: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(ms) || !Number.isInteger(ms)) {
      this.setValidationError(`timeoutMs must be an integer`);
      return;
    }
    if (ms < TIMEOUT_MIN_MS || ms > TIMEOUT_MAX_MS) {
      this.setValidationError(`timeoutMs out of range [${TIMEOUT_MIN_MS}, ${TIMEOUT_MAX_MS}]`);
      return;
    }
    this.draftTimeoutMs = ms;
    this.clearValidationAndPush();
  }

  onSetBudget(n: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      this.setValidationError(`refineBudget must be an integer`);
      return;
    }
    if (n < REFINE_BUDGET_MIN || n > REFINE_BUDGET_MAX) {
      this.setValidationError(
        `refineBudget out of range [${REFINE_BUDGET_MIN}, ${REFINE_BUDGET_MAX}]`,
      );
      return;
    }
    this.draftRefineBudget = n;
    this.clearValidationAndPush();
  }

  onAnswerClarification(answer: string): void {
    if (this.disposed) return;
    this.handle?.resumeClarify({ answer });
  }

  onSend(refinedPrompt?: string): void {
    if (this.disposed) return;
    if (this.handle === null) return;
    if (this.draftAdapterId === null) {
      this.setValidationError('No adapter selected');
      return;
    }
    if (!this.deps.registry.isEnabled(this.draftAdapterId)) {
      this.setValidationError(`Adapter not enabled: ${this.draftAdapterId}`);
      return;
    }
    this.handle.applyReadyAction({
      type: 'send',
      adapterId: this.draftAdapterId,
      timeoutMs: this.draftTimeoutMs,
      refineBudget: this.draftRefineBudget,
      ...(refinedPrompt !== undefined ? { editedPrompt: refinedPrompt } : {}),
    });
  }

  onEdit(newDraft: string): void {
    if (this.disposed) return;
    if (this.handle === null) return;
    this.handle.applyReadyAction({ type: 'edit', editedPrompt: newDraft });
  }

  onCancel(): void {
    if (this.disposed) return;
    if (this.handle === null) return;
    if (this.handle.state().phase === 'ready') {
      this.handle.applyReadyAction({ type: 'cancel' });
    } else {
      this.handle.cancel();
    }
  }

  // --- internals ---

  private onState(state: ExternalAgentState): void {
    if (this.disposed) return;
    this.currentVm = this.project(state);
    for (const l of this.listeners) {
      try {
        l(this.currentVm);
      } catch {
        /* listener errors are swallowed */
      }
    }
  }

  private project(state: ExternalAgentState): WidgetViewModel {
    const adapters: AdapterOption[] = this.deps.registry
      .list()
      .filter((a) => this.deps.registry.isEnabled(a.id))
      .map((a) => ({
        id: a.id,
        label: a.label,
        defaultTimeoutMs: a.defaultTimeoutMs,
      }));
    return {
      runId: state.runId,
      threadId: state.threadId,
      phase: state.phase,
      originalAsk: state.originalAsk,
      adapters,
      draftAdapterId: this.draftAdapterId,
      draftTimeoutMs: this.draftTimeoutMs,
      draftRefineBudget: this.draftRefineBudget,
      clarifyingQuestion: state.clarifyingQuestion,
      logEvents: state.logEvents.map((e) => ({ level: e.level, msg: e.msg, ts: e.ts })),
      validationError: this.validationError,
      refinedPrompt: state.refinedPrompt,
      textBuffer: state.textBuffer,
      resultFolder: state.resultFolder,
      writtenFiles: state.writtenFiles,
      error: state.error,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
    };
  }

  private buildReloadErrorVm(): WidgetViewModel {
    const adapters: AdapterOption[] = this.deps.registry
      .list()
      .filter((a) => this.deps.registry.isEnabled(a.id))
      .map((a) => ({ id: a.id, label: a.label, defaultTimeoutMs: a.defaultTimeoutMs }));
    return {
      runId: this.deps.runId,
      threadId: this.deps.threadId,
      phase: 'error',
      originalAsk: '',
      adapters,
      draftAdapterId: null,
      draftTimeoutMs: DEFAULT_TIMEOUT_MS,
      draftRefineBudget: DEFAULT_BUDGET,
      clarifyingQuestion: null,
      logEvents: [],
      validationError: null,
      refinedPrompt: null,
      textBuffer: '',
      resultFolder: null,
      writtenFiles: [],
      error: { code: 'reload', message: 'Plugin reloaded during run' },
      startedAt: null,
      endedAt: null,
    };
  }

  private setValidationError(msg: string): void {
    this.validationError = msg;
    if (this.handle === null) {
      this.currentVm = { ...this.currentVm, validationError: msg };
    } else {
      this.currentVm = this.project(this.handle.state());
    }
    for (const l of this.listeners) {
      try {
        l(this.currentVm);
      } catch {
        /* */
      }
    }
  }

  private clearValidationAndPush(): void {
    this.validationError = null;
    if (this.handle === null) {
      this.currentVm = { ...this.currentVm, validationError: null };
    } else {
      this.currentVm = this.project(this.handle.state());
    }
    for (const l of this.listeners) {
      try {
        l(this.currentVm);
      } catch {
        /* */
      }
    }
  }
}
