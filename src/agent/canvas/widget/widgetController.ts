import type { CanvasOp } from '@/agent/canvas/mutex';
import type { ProviderKind } from '@/settings/settingsStore';
import type { ProviderModel } from '@/providers/types';
import type { LayoutHint } from '@/agent/canvas/schemas';
import type { EditAction } from '@/agent/canvas/state';
import { validateVaultRelativePath } from '@/agent/canvas/canvasJson';
import {
  DEFAULT_CANVAS_PALETTE_ID,
  resolvePaletteId,
  type CanvasPaletteId,
} from '@/agent/canvas/layouts/colorPalette';
import {
  isTerminalCanvasPhase,
  makeInitialCanvasViewModel,
  type CanvasConfigDraft,
  type CanvasViewModel,
} from './widgetState';

export interface CanvasConfigOverride {
  readonly providerId: ProviderKind;
  readonly model: string;
  readonly preset: LayoutHint;
  readonly path: string;
  readonly paletteId: CanvasPaletteId;
}

export interface CanvasPickerDeps {
  readonly listModelsForProvider: (
    providerId: ProviderKind,
    signal: AbortSignal,
  ) => Promise<readonly ProviderModel[]>;
  readonly requiresApiKey: (providerId: ProviderKind) => boolean;
  readonly hasApiKey: (providerId: ProviderKind) => boolean;
}

export interface CanvasConfigInit {
  readonly providers: readonly ProviderKind[];
  readonly defaultProviderId: ProviderKind;
  readonly defaultModel: string;
  readonly defaultPreset: LayoutHint;
  readonly defaultPath: string;
  readonly defaultPaletteId?: CanvasPaletteId;
  readonly originalAsk: string;
}

export interface CanvasWidgetActions {
  answerClarification?(text: string): void;
  resolvePreviewing?(action: EditAction): void;
  cancel?(): void;
  openPreview?(path: string): void;
}

export interface CanvasWidgetControllerOptions {
  readonly runId: string;
  readonly threadId: string;
  readonly op: CanvasOp;
  readonly targetPath: string;
  readonly originalAsk: string;
  readonly actions?: CanvasWidgetActions;
  readonly initialViewModel?: CanvasViewModel;
}

export type CanvasWidgetListener = (vm: CanvasViewModel) => void;

export class CanvasWidgetController {
  private vm: CanvasViewModel;
  private readonly listeners = new Set<CanvasWidgetListener>();
  private actions: CanvasWidgetActions;
  private disposed = false;

  private picker: CanvasPickerDeps | null = null;
  private pickerResolve: ((v: CanvasConfigOverride | null) => void) | null = null;
  private readonly modelsCache = new Map<ProviderKind, readonly ProviderModel[]>();
  private modelsAbort: AbortController | null = null;

  constructor(opts: CanvasWidgetControllerOptions) {
    this.vm =
      opts.initialViewModel ??
      makeInitialCanvasViewModel({
        runId: opts.runId,
        threadId: opts.threadId,
        op: opts.op,
        targetPath: opts.targetPath,
        originalAsk: opts.originalAsk,
      });
    this.actions = opts.actions ?? {};
  }

  static reloadRehydrate(opts: {
    runId: string;
    threadId: string;
    op: CanvasOp;
    targetPath: string;
    originalAsk: string;
  }): CanvasWidgetController {
    const base = makeInitialCanvasViewModel(opts);
    return new CanvasWidgetController({
      ...opts,
      initialViewModel: {
        ...base,
        phase: 'error',
        error: { code: 'reload', message: 'Run discarded by plugin reload' },
      },
    });
  }

  viewModel(): CanvasViewModel {
    return this.vm;
  }

  subscribe(listener: CanvasWidgetListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  update(patch: Partial<CanvasViewModel>): void {
    if (this.disposed) return;
    const next: CanvasViewModel = { ...this.vm, ...patch };
    this.vm = next;
    for (const l of this.listeners) {
      try {
        l(next);
      } catch {
        /* listener failures isolated */
      }
    }
  }

  setPhase(phase: CanvasViewModel['phase'], extra: Partial<CanvasViewModel> = {}): void {
    const now = Date.now();
    const startedAt =
      this.vm.startedAt === null && phase !== 'awaiting_config' ? now : this.vm.startedAt;
    const endedAt = isTerminalCanvasPhase(phase) ? now : this.vm.endedAt;
    this.update({ ...extra, phase, startedAt, endedAt });
  }

  recordError(code: string, message: string): void {
    this.setPhase('error', { error: { code, message } });
  }

  setEditInstruction(text: string): void {
    this.update({ editInstruction: text });
  }

  answerClarification(text: string): void {
    this.actions.answerClarification?.(text);
  }

  approve(): void {
    this.actions.resolvePreviewing?.({ kind: 'approve' });
  }

  edit(): void {
    const instruction = this.vm.editInstruction ?? '';
    if (instruction.trim().length === 0) return;
    this.actions.resolvePreviewing?.({ kind: 'edit', instruction });
  }

  openPreview(): void {
    const path = this.vm.previewPath;
    if (path === undefined) return;
    this.actions.openPreview?.(path);
  }

  cancel(): void {
    this.actions.resolvePreviewing?.({ kind: 'cancel' });
    this.actions.cancel?.();
  }

  setActions(actions: CanvasWidgetActions): void {
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

  startConfigPhase(
    picker: CanvasPickerDeps,
    init: CanvasConfigInit,
  ): Promise<CanvasConfigOverride | null> {
    if (this.disposed) return Promise.resolve(null);
    this.picker = picker;
    const apiKeyMissing =
      picker.requiresApiKey(init.defaultProviderId) && !picker.hasApiKey(init.defaultProviderId);
    const defaultPaletteId = resolvePaletteId(init.defaultPaletteId ?? DEFAULT_CANVAS_PALETTE_ID);
    const draft: CanvasConfigDraft = {
      providers: init.providers,
      draftProviderId: init.defaultProviderId,
      draftModel: init.defaultModel,
      draftPreset: init.defaultPreset,
      draftPath: init.defaultPath,
      draftPaletteId: defaultPaletteId,
      models: { state: 'idle' },
      defaultProviderId: init.defaultProviderId,
      defaultModel: init.defaultModel,
      defaultPreset: init.defaultPreset,
      defaultPath: init.defaultPath,
      defaultPaletteId,
      apiKeyMissing,
      validationError: null,
      originalAsk: init.originalAsk,
    };
    this.setPhase('awaiting_config', { config: draft });
    void this.loadModels(init.defaultProviderId);
    return new Promise<CanvasConfigOverride | null>((resolve) => {
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

  onSelectPreset(preset: LayoutHint): void {
    const cfg = this.vm.config;
    if (cfg === undefined) return;
    this.update({ config: { ...cfg, draftPreset: preset, validationError: null } });
  }

  onSelectPalette(paletteId: string): void {
    const cfg = this.vm.config;
    if (cfg === undefined) return;
    const resolved = resolvePaletteId(paletteId);
    this.update({ config: { ...cfg, draftPaletteId: resolved, validationError: null } });
  }

  onSetPath(path: string): void {
    const cfg = this.vm.config;
    if (cfg === undefined) return;
    this.update({ config: { ...cfg, draftPath: path, validationError: null } });
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
    const pathResult = validateVaultRelativePath(cfg.draftPath);
    if (!pathResult.ok) {
      this.update({ config: { ...cfg, validationError: pathResult.error.message } });
      return;
    }
    this.pickerResolve = null;
    this.modelsAbort?.abort();
    this.modelsAbort = null;
    resolve({
      providerId: cfg.draftProviderId,
      model: cfg.draftModel,
      preset: cfg.draftPreset,
      path: pathResult.value,
      paletteId: cfg.draftPaletteId,
    });
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
    if (cfg?.draftProviderId === providerId) {
      this.update({ config: { ...cfg, models: { state: 'loading' } } });
    }
    try {
      const items = await this.picker.listModelsForProvider(providerId, ac.signal);
      if (ac.signal.aborted || this.disposed) return;
      this.modelsCache.set(providerId, items);
      const cur = this.vm.config;
      if (cur?.draftProviderId !== providerId) return;
      const draftModel =
        items.length > 0 ? (items.find((m) => m.id === cur.draftModel)?.id ?? items[0]!.id) : '';
      this.update({
        config: { ...cur, models: { state: 'ok', items }, draftModel },
      });
    } catch (err) {
      if (ac.signal.aborted || this.disposed) return;
      const message = err instanceof Error ? err.message : String(err);
      const cur = this.vm.config;
      if (cur?.draftProviderId !== providerId) return;
      this.update({ config: { ...cur, models: { state: 'error', error: message } } });
    }
  }
}
