import type { WikiOp } from '@/agent/wiki/mutexTypes';
import type { ProviderKind } from '@/settings/settingsStore';
import type { ProviderModel } from '@/providers/types';
import type { ProviderOverride } from '@/agent/wiki/ingest/types';
import {
  buildWikiTerminalSnapshot,
  type WikiTerminalSnapshot,
} from '@/agent/wiki/terminalSnapshot';
import {
  isTerminal,
  makeInitialViewModel,
  type WikiConfigDraft,
  type WikiViewModel,
} from '@/agent/wiki/widgetState';

export interface WikiPickerDeps {
  readonly listModelsForProvider: (
    providerId: ProviderKind,
    signal: AbortSignal,
  ) => Promise<readonly ProviderModel[]>;
  readonly requiresApiKey: (providerId: ProviderKind) => boolean;
  readonly hasApiKey: (providerId: ProviderKind) => boolean;
}

export interface WikiConfigInit {
  readonly providers: readonly ProviderKind[];
  readonly defaultProviderId: ProviderKind;
  readonly defaultModel: string;
  readonly originalAsk: string;
  readonly sourcesSummary: string;
}

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

  // Picker state — only set while phase === 'awaiting_config'.
  private picker: WikiPickerDeps | null = null;
  private pickerResolve: ((v: ProviderOverride | null) => void) | null = null;
  private modelsCache = new Map<ProviderKind, readonly ProviderModel[]>();
  private modelsAbort: AbortController | null = null;

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
    const startedAt = this.vm.startedAt === null && phase !== 'idle' ? now : this.vm.startedAt;
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
    this.modelsAbort?.abort();
    this.modelsAbort = null;
    this.pickerResolve?.(null);
    this.pickerResolve = null;
    this.picker = null;
    this.listeners.clear();
  }

  /**
   * Begin the awaiting_config phase. Resolves when the user confirms (with
   * override) or cancels (null). The picker drives async model-list loads via
   * `picker`. Disposing the controller resolves the promise with `null`.
   */
  startConfigPhase(picker: WikiPickerDeps, init: WikiConfigInit): Promise<ProviderOverride | null> {
    if (this.disposed) return Promise.resolve(null);
    this.picker = picker;
    const apiKeyMissing =
      picker.requiresApiKey(init.defaultProviderId) && !picker.hasApiKey(init.defaultProviderId);
    const draft: WikiConfigDraft = {
      providers: init.providers,
      draftProviderId: init.defaultProviderId,
      draftModel: init.defaultModel,
      models: { state: 'idle' },
      defaultProviderId: init.defaultProviderId,
      defaultModel: init.defaultModel,
      apiKeyMissing,
      validationError: null,
      originalAsk: init.originalAsk,
      sourcesSummary: init.sourcesSummary,
    };
    this.setPhase('awaiting_config', { config: draft });
    void this.loadModels(init.defaultProviderId);
    return new Promise<ProviderOverride | null>((resolve) => {
      this.pickerResolve = resolve;
    });
  }

  onSelectProvider(providerId: ProviderKind): void {
    const cfg = this.vm.config;
    if (cfg === undefined || this.picker === null) return;
    const apiKeyMissing =
      this.picker.requiresApiKey(providerId) && !this.picker.hasApiKey(providerId);
    const cached = this.modelsCache.get(providerId);
    const nextDraftModel =
      cached !== undefined && cached.length > 0
        ? (cached.find((m) => m.id === cfg.draftModel)?.id ?? cached[0]!.id)
        : '';
    this.update({
      config: {
        ...cfg,
        draftProviderId: providerId,
        draftModel: nextDraftModel,
        apiKeyMissing,
        models: cached !== undefined ? { state: 'ok', items: cached } : { state: 'idle' },
        validationError: null,
      },
    });
    if (cached === undefined) void this.loadModels(providerId);
  }

  onSelectModel(model: string): void {
    const cfg = this.vm.config;
    if (cfg === undefined) return;
    this.update({ config: { ...cfg, draftModel: model, validationError: null } });
  }

  onRetryLoadModels(): void {
    const cfg = this.vm.config;
    if (cfg === undefined) return;
    void this.loadModels(cfg.draftProviderId);
  }

  onConfirm(): void {
    const cfg = this.vm.config;
    const resolve = this.pickerResolve;
    if (cfg === undefined || resolve === null) return;
    if (cfg.apiKeyMissing) {
      this.update({ config: { ...cfg, validationError: 'API key required for this provider' } });
      return;
    }
    if (cfg.draftModel.length === 0) {
      this.update({ config: { ...cfg, validationError: 'Pick a model to continue' } });
      return;
    }
    this.pickerResolve = null;
    this.modelsAbort?.abort();
    this.modelsAbort = null;
    resolve({ providerId: cfg.draftProviderId, model: cfg.draftModel });
  }

  onCancel(): void {
    const resolve = this.pickerResolve;
    this.pickerResolve = null;
    this.modelsAbort?.abort();
    this.modelsAbort = null;
    if (resolve !== null) resolve(null);
    this.actions.cancel?.();
  }

  private async loadModels(providerId: ProviderKind): Promise<void> {
    if (this.picker === null) return;
    this.modelsAbort?.abort();
    const ac = new AbortController();
    this.modelsAbort = ac;
    const cfg = this.vm.config;
    if (cfg !== undefined && cfg.draftProviderId === providerId) {
      this.update({ config: { ...cfg, models: { state: 'loading' } } });
    }
    try {
      const items = await this.picker.listModelsForProvider(providerId, ac.signal);
      if (ac.signal.aborted || this.disposed) return;
      this.modelsCache.set(providerId, items);
      const cur = this.vm.config;
      if (cur === undefined || cur.draftProviderId !== providerId) return;
      const draftModel =
        items.length > 0 ? (items.find((m) => m.id === cur.draftModel)?.id ?? items[0]!.id) : '';
      this.update({
        config: { ...cur, models: { state: 'ok', items }, draftModel },
      });
    } catch (err) {
      if (ac.signal.aborted || this.disposed) return;
      const message = err instanceof Error ? err.message : String(err);
      const cur = this.vm.config;
      if (cur === undefined || cur.draftProviderId !== providerId) return;
      this.update({ config: { ...cur, models: { state: 'error', error: message } } });
    }
  }
}
