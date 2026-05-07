import { describe, expect, it, vi } from 'vitest';
import { CanvasOrchestrator, type CanvasPickerWiring } from '@/agent/canvas/orchestrator';
import type { CanvasSubgraphDeps, RunHandle, StartCanvasInput } from '@/agent/canvas/subgraph';
import type { CanvasTerminalState } from '@/agent/canvas/state';
import type { StartCanvasResult } from '@/agent/canvas/subgraph';
import type {
  CanvasConfigOverride,
  CanvasPickerDeps,
} from '@/agent/canvas/widget/widgetController';

function fakeTerminal(): CanvasTerminalState {
  return {
    phase: 'done',
    runId: 'run-1',
    path: 'canvases/x.canvas',
    op: 'create',
    durationMs: 10,
    paletteId: 'coolVivid',
  };
}

function fakeSubgraph(result: StartCanvasResult): CanvasSubgraphDeps {
  return { _start: () => result } as unknown as CanvasSubgraphDeps;
}

describe('CanvasOrchestrator', () => {
  it('exposes liveHandles after start succeeds', async () => {
    let resolveTerminal: (v: CanvasTerminalState) => void = () => undefined;
    const terminal = new Promise<CanvasTerminalState>((r) => {
      resolveTerminal = r;
    });
    const handle: RunHandle = {
      runId: 'run-1',
      op: 'create',
      threadId: 't1',
      originalAsk: 'ask',
      targetPath: 'canvases/x.canvas',
      abort: vi.fn(),
      terminal,
      subscribe: () => () => undefined,
    };
    const startResult: StartCanvasResult = { ok: true, handle };
    const o = new CanvasOrchestrator({ subgraph: fakeSubgraph(startResult) });
    const startCanvasModule = await import('@/agent/canvas/subgraph');
    vi.spyOn(startCanvasModule, 'startCanvasRun').mockReturnValue(startResult);

    const result = await o.start({ threadId: 't1', op: 'create', originalAsk: 'ask' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(o.findHandle('run-1')).toBe(handle);
      resolveTerminal(fakeTerminal());
      await result.terminal;
      expect(o.findHandle('run-1')).toBeNull();
    }
    vi.restoreAllMocks();
  });

  it('returns busy when subgraph reports busy', async () => {
    const startResult: StartCanvasResult = {
      ok: false,
      busy: { activeRunId: 'other', activeOp: 'create' },
    };
    const startCanvasModule = await import('@/agent/canvas/subgraph');
    vi.spyOn(startCanvasModule, 'startCanvasRun').mockReturnValue(startResult);

    const o = new CanvasOrchestrator({ subgraph: fakeSubgraph(startResult) });
    const result = await o.start({ threadId: 't1', op: 'create', originalAsk: 'ask' });
    expect(result.ok).toBe(false);
    if (!result.ok && 'busy' in result) {
      expect(result.busy.activeRunId).toBe('other');
    }
    vi.restoreAllMocks();
  });

  it('picker cancellation returns cancelledByPicker without starting subgraph', async () => {
    const startCanvasModule = await import('@/agent/canvas/subgraph');
    const widgetControllerModule = await import('@/agent/canvas/widget/widgetController');
    vi.spyOn(
      widgetControllerModule.CanvasWidgetController.prototype,
      'startConfigPhase',
    ).mockResolvedValue(null);
    const startSpy = vi.spyOn(startCanvasModule, 'startCanvasRun');

    const pickerDeps: CanvasPickerDeps = {
      listModelsForProvider: async () => [],
      requiresApiKey: () => false,
      hasApiKey: () => true,
    };
    const applyOverride = vi.fn((sub: CanvasSubgraphDeps) => sub);
    const picker: CanvasPickerWiring = {
      deps: pickerDeps,
      buildInit: ({ originalAsk, targetPath }) => ({
        providers: ['lmstudio'],
        defaultProviderId: 'lmstudio',
        defaultModel: 'm',
        defaultPreset: 'auto',
        defaultPath: targetPath,
        originalAsk,
      }),
      applyOverride,
    };
    const o = new CanvasOrchestrator({
      subgraph: fakeSubgraph({ ok: false, busy: { activeRunId: 'x', activeOp: 'create' } }),
      picker,
    });
    const result = await o.start({ threadId: 't1', op: 'create', originalAsk: 'ask' });
    expect(result.ok).toBe(false);
    if (!result.ok && 'cancelledByPicker' in result) {
      expect(result.cancelledByPicker).toBe(true);
    } else {
      throw new Error('expected cancelledByPicker variant');
    }
    expect(applyOverride).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('picker resolves override → applyOverride invoked, subgraph started with overridden path/preset', async () => {
    const startCanvasModule = await import('@/agent/canvas/subgraph');
    const widgetControllerModule = await import('@/agent/canvas/widget/widgetController');
    const override: CanvasConfigOverride = {
      providerId: 'lmstudio',
      model: 'override-model',
      preset: 'force',
      path: 'canvases/from-picker.canvas',
      paletteId: 'rainbow',
    };
    vi.spyOn(
      widgetControllerModule.CanvasWidgetController.prototype,
      'startConfigPhase',
    ).mockResolvedValue(override);

    let capturedSubgraph: CanvasSubgraphDeps | null = null;
    let capturedInput: StartCanvasInput | null = null;
    let resolveTerminal: (v: CanvasTerminalState) => void = () => undefined;
    const terminal = new Promise<CanvasTerminalState>((r) => {
      resolveTerminal = r;
    });
    const handle: RunHandle = {
      runId: 'picker-run',
      op: 'create',
      threadId: 't1',
      originalAsk: 'ask',
      targetPath: override.path,
      abort: vi.fn(),
      terminal,
      subscribe: () => () => undefined,
    };
    vi.spyOn(startCanvasModule, 'startCanvasRun').mockImplementation(
      (sub: CanvasSubgraphDeps, inp: StartCanvasInput) => {
        capturedSubgraph = sub;
        capturedInput = inp;
        return { ok: true, handle };
      },
    );

    const pickerDeps: CanvasPickerDeps = {
      listModelsForProvider: async () => [],
      requiresApiKey: () => false,
      hasApiKey: () => true,
    };
    const applyOverride = vi.fn(
      (sub: CanvasSubgraphDeps, ov: CanvasConfigOverride): CanvasSubgraphDeps => {
        return { ...sub, model: () => ov.model } as CanvasSubgraphDeps;
      },
    );
    const o = new CanvasOrchestrator({
      subgraph: fakeSubgraph({ ok: true, handle }),
      picker: {
        deps: pickerDeps,
        buildInit: ({ originalAsk, targetPath }) => ({
          providers: ['lmstudio'],
          defaultProviderId: 'lmstudio',
          defaultModel: 'default',
          defaultPreset: 'auto',
          defaultPath: targetPath,
          originalAsk,
        }),
        applyOverride,
      },
    });

    const result = await o.start({ threadId: 't1', op: 'create', originalAsk: 'ask' });
    expect(result.ok).toBe(true);
    expect(applyOverride).toHaveBeenCalledTimes(1);
    expect(capturedSubgraph).not.toBeNull();
    expect(capturedSubgraph!.model()).toBe('override-model');
    expect(capturedInput!.targetPath).toBe(override.path);
    expect(capturedInput!.layoutAlgo).toBe('force');
    resolveTerminal(fakeTerminal());
    if (result.ok) await result.terminal;
    vi.restoreAllMocks();
  });

  it('persistSnapshot called with terminal snapshot on success', async () => {
    const handle: RunHandle = {
      runId: 'run-2',
      op: 'create',
      threadId: 't1',
      originalAsk: 'ask',
      targetPath: 'canvases/x.canvas',
      abort: vi.fn(),
      terminal: Promise.resolve(fakeTerminal()),
      subscribe: () => () => undefined,
    };
    const startResult: StartCanvasResult = { ok: true, handle };
    const startCanvasModule = await import('@/agent/canvas/subgraph');
    vi.spyOn(startCanvasModule, 'startCanvasRun').mockReturnValue(startResult);

    const persistSnapshot = vi.fn();
    const o = new CanvasOrchestrator({
      subgraph: fakeSubgraph(startResult),
      persistSnapshot,
    });
    const result = await o.start({ threadId: 't1', op: 'create', originalAsk: 'ask' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      await result.terminal;
      await Promise.resolve();
      await Promise.resolve();
      expect(persistSnapshot).toHaveBeenCalledTimes(1);
    }
    vi.restoreAllMocks();
  });
});
