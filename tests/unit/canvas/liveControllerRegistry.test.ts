import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANVAS_LIVE_KIND,
  canvasLiveControllerCount,
  clearCanvasLiveControllers,
  lookupCanvasLiveController,
  registerCanvasLiveController,
  releaseCanvasLiveController,
} from '@/agent/canvas/liveControllerRegistry';

afterEach(() => {
  clearCanvasLiveControllers();
});

describe('canvasLiveControllerRegistry', () => {
  it('CANVAS_LIVE_KIND constant', () => {
    expect(CANVAS_LIVE_KIND).toBe('canvas_live');
  });

  it('register/lookup/release roundtrip', () => {
    const stub = { dispose: vi.fn() };
    registerCanvasLiveController('r1', stub);
    expect(canvasLiveControllerCount()).toBe(1);
    expect(lookupCanvasLiveController('r1')).toBe(stub);
    releaseCanvasLiveController('r1');
    expect(canvasLiveControllerCount()).toBe(0);
    expect(stub.dispose).toHaveBeenCalledTimes(1);
  });

  it('release of unknown runId is a no-op', () => {
    expect(() => releaseCanvasLiveController('nope')).not.toThrow();
  });

  it('dispose failures dont propagate', () => {
    const stub = {
      dispose: vi.fn(() => {
        throw new Error('boom');
      }),
    };
    registerCanvasLiveController('r1', stub);
    expect(() => releaseCanvasLiveController('r1')).not.toThrow();
    expect(canvasLiveControllerCount()).toBe(0);
  });
});
