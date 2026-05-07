import { describe, expect, it } from 'vitest';
import {
  CanvasWidgetController,
  type CanvasConfigOverride,
  type CanvasPickerDeps,
} from '@/agent/canvas/widget/widgetController';

function makeController(): CanvasWidgetController {
  return new CanvasWidgetController({
    runId: 'r1',
    threadId: 't1',
    op: 'create',
    targetPath: 'canvases/x.canvas',
    originalAsk: 'ask',
  });
}

const stubPicker: CanvasPickerDeps = {
  listModelsForProvider: async () => [{ id: 'm1' }, { id: 'm2' }],
  requiresApiKey: () => false,
  hasApiKey: () => true,
};

describe('CanvasWidgetController', () => {
  it('initial view model uses awaiting_config phase', () => {
    const c = makeController();
    expect(c.viewModel().phase).toBe('awaiting_config');
    expect(c.viewModel().targetPath).toBe('canvases/x.canvas');
  });

  it('subscribe receives updates after update()', () => {
    const c = makeController();
    const seen: string[] = [];
    c.subscribe((vm) => seen.push(vm.phase));
    c.setPhase('preparing');
    expect(seen).toEqual(['preparing']);
  });

  it('startConfigPhase resolves with override on confirm (default palette)', async () => {
    const c = makeController();
    const promise = c.startConfigPhase(stubPicker, {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'm1',
      defaultPreset: 'auto',
      defaultPath: 'canvases/x.canvas',
      originalAsk: 'ask',
    });
    await new Promise((r) => setTimeout(r, 0));
    c.onConfirm();
    const result = await promise;
    expect(result).toEqual<CanvasConfigOverride>({
      providerId: 'lmstudio',
      model: 'm1',
      preset: 'auto',
      path: 'canvases/x.canvas',
      paletteId: 'coolVivid',
    });
  });

  it('onSelectPalette updates the draft and override carries the chosen id', async () => {
    const c = makeController();
    const promise = c.startConfigPhase(stubPicker, {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'm1',
      defaultPreset: 'auto',
      defaultPath: 'canvases/x.canvas',
      originalAsk: 'ask',
    });
    await new Promise((r) => setTimeout(r, 0));
    c.onSelectPalette('rainbow');
    expect(c.viewModel().config?.draftPaletteId).toBe('rainbow');
    c.onConfirm();
    const result = await promise;
    expect(result?.paletteId).toBe('rainbow');
  });

  it('onSelectPalette ignores unknown ids (falls back to default)', async () => {
    const c = makeController();
    void c.startConfigPhase(stubPicker, {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'm1',
      defaultPreset: 'auto',
      defaultPath: 'canvases/x.canvas',
      originalAsk: 'ask',
    });
    await new Promise((r) => setTimeout(r, 0));
    c.onSelectPalette('not-a-real-palette');
    expect(c.viewModel().config?.draftPaletteId).toBe('coolVivid');
  });

  it('respects defaultPaletteId from init', async () => {
    const c = makeController();
    void c.startConfigPhase(stubPicker, {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'm1',
      defaultPreset: 'auto',
      defaultPath: 'canvases/x.canvas',
      defaultPaletteId: 'sunset',
      originalAsk: 'ask',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(c.viewModel().config?.draftPaletteId).toBe('sunset');
    expect(c.viewModel().config?.defaultPaletteId).toBe('sunset');
  });

  it('onConfirm rejects invalid path', () => {
    const c = makeController();
    void c.startConfigPhase(stubPicker, {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'm1',
      defaultPreset: 'auto',
      defaultPath: 'canvases/x.canvas',
      originalAsk: 'ask',
    });
    c.onSetPath('foo.txt');
    c.onConfirm();
    expect(c.viewModel().config?.validationError).toMatch(/canvas_path_extension/);
  });

  it('approve/edit/cancel forward to actions', () => {
    const calls: string[] = [];
    const c = new CanvasWidgetController({
      runId: 'r1',
      threadId: 't1',
      op: 'create',
      targetPath: 'canvases/x.canvas',
      originalAsk: 'ask',
      actions: {
        resolvePreviewing: (action) => calls.push(action.kind),
        cancel: () => calls.push('cancel-action'),
      },
    });
    c.approve();
    c.setEditInstruction('tweak labels');
    c.edit();
    c.cancel();
    expect(calls).toEqual(['approve', 'edit', 'cancel', 'cancel-action']);
  });

  it('reloadRehydrate produces error.code=reload', () => {
    const c = CanvasWidgetController.reloadRehydrate({
      runId: 'r1',
      threadId: 't1',
      op: 'create',
      targetPath: 'canvases/x.canvas',
      originalAsk: 'ask',
    });
    expect(c.viewModel().phase).toBe('error');
    expect(c.viewModel().error?.code).toBe('reload');
  });

  it('dispose resolves pending startConfigPhase with null', async () => {
    const c = makeController();
    const promise = c.startConfigPhase(stubPicker, {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'm1',
      defaultPreset: 'auto',
      defaultPath: 'canvases/x.canvas',
      originalAsk: 'ask',
    });
    c.dispose();
    expect(await promise).toBeNull();
  });
});
