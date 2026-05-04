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
  type LintFindingPatchStatus,
  type LintFindingSummary,
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

export interface LintConfirmActionPayload {
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
  readonly applySchema: boolean;
  readonly notes?: readonly { readonly id: string; readonly note: string }[];
}

export interface WikiWidgetActions {
  answerClarification?(text: string): void;
  resolveDuplicate?(decision: 'skip' | 'reprocess' | 'replace'): void;
  applyLintConfirm?(payload: LintConfirmActionPayload): void;
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
  applyLintConfirm(payload: LintConfirmActionPayload): void {
    this.actions.applyLintConfirm?.(payload);
  }

  currentFindings(): readonly LintFindingSummary[] {
    return this.vm.findings ?? [];
  }

  setFindingNote(id: string, note: string): void {
    this.patchFinding(id, (f) => ({ ...f, note }));
  }

  setFindingDecision(id: string, accepted: boolean | null): void {
    this.patchFinding(id, (f) => ({ ...f, accepted }));
  }

  setFindingPatchStatus(
    id: string,
    status: LintFindingPatchStatus | undefined,
    error?: string,
  ): void {
    this.patchFinding(id, (f) => {
      const next: LintFindingSummary = { ...f };
      if (status === undefined) {
        delete (next as { patchStatus?: LintFindingPatchStatus }).patchStatus;
      } else {
        (next as { patchStatus?: LintFindingPatchStatus }).patchStatus = status;
      }
      if (error === undefined) {
        delete (next as { patchError?: string }).patchError;
      } else {
        (next as { patchError?: string }).patchError = error;
      }
      return next;
    });
  }

  applyLintConfirmFromState(applySchema: boolean): void {
    const findings = this.vm.findings ?? [];
    const accepted: string[] = [];
    const rejected: string[] = [];
    const notes: { id: string; note: string }[] = [];
    let applySchemaDerived = applySchema;
    for (const f of findings) {
      if (f.accepted === true) accepted.push(f.id);
      else if (f.accepted === false) rejected.push(f.id);
      if (f.note !== undefined && f.note.trim().length > 0) {
        notes.push({ id: f.id, note: f.note });
      }
      if (f.action === 'schema-drift' && f.accepted === true) {
        applySchemaDerived = true;
      }
    }
    this.applyLintConfirm({
      accepted,
      rejected,
      applySchema: applySchemaDerived,
      notes,
    });
  }

  private patchFinding(id: string, mutator: (f: LintFindingSummary) => LintFindingSummary): void {
    if (this.disposed) return;
    const findings = this.vm.findings;
    if (findings === undefined) return;
    let changed = false;
    const next = findings.map((f) => {
      if (f.id !== id) return f;
      const updated = mutator(f);
      if (updated !== f) changed = true;
      return updated;
    });
    if (!changed) return;
    this.update({ findings: next });
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
