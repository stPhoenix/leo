import { describe, expect, it, vi } from 'vitest';
import { createCanvasStatusCommand } from '@/ui/canvasStatusCommand';
import type { CanvasStatus } from '@/agent/canvas/canvasStatus';

const empty: CanvasStatus = { activeRuns: [], recentSidecars: [], sidecarDirError: null };

describe('createCanvasStatusCommand', () => {
  it('invokes collect → render', async () => {
    const collect = vi.fn(async () => empty);
    const render = vi.fn();
    const onError = vi.fn();
    const cmd = createCanvasStatusCommand({ collect, render, onError });
    await cmd.invoke();
    expect(collect).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(empty);
    expect(onError).not.toHaveBeenCalled();
  });

  it('routes errors to onError', async () => {
    const collect = vi.fn(async () => {
      throw new Error('boom');
    });
    const render = vi.fn();
    const onError = vi.fn();
    const cmd = createCanvasStatusCommand({ collect, render, onError });
    await cmd.invoke();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
  });

  it('cancel aborts in-flight collect signal', async () => {
    let observedSignal: AbortSignal | null = null;
    const collect = vi.fn(async (signal: AbortSignal) => {
      observedSignal = signal;
      await new Promise((r) => setTimeout(r, 50));
      return empty;
    });
    const render = vi.fn();
    const onError = vi.fn();
    const cmd = createCanvasStatusCommand({ collect, render, onError });
    const p = cmd.invoke();
    cmd.cancel();
    await p;
    expect(observedSignal!.aborted).toBe(true);
    expect(render).not.toHaveBeenCalled();
  });
});
