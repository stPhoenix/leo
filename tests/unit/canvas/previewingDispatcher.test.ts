import { describe, expect, it } from 'vitest';
import { CanvasPreviewingDispatcher } from '@/agent/canvas/previewingDispatcher';
import type { CanvasState } from '@/agent/canvas/state';

function fakeState(runId: string): CanvasState {
  return { runId } as unknown as CanvasState;
}

describe('CanvasPreviewingDispatcher', () => {
  it('resolves awaitDecision via resolve()', async () => {
    const d = new CanvasPreviewingDispatcher();
    const promise = d.awaitDecision(fakeState('r1'));
    const ok = d.resolve('r1', { kind: 'approve' });
    expect(ok).toBe(true);
    expect(await promise).toEqual({ kind: 'approve' });
  });

  it('resolve returns false for unknown runId', () => {
    const d = new CanvasPreviewingDispatcher();
    expect(d.resolve('nope', { kind: 'cancel' })).toBe(false);
  });

  it('hasPending tracks pending awaits', () => {
    const d = new CanvasPreviewingDispatcher();
    expect(d.hasPending('r1')).toBe(false);
    void d.awaitDecision(fakeState('r1'));
    expect(d.hasPending('r1')).toBe(true);
    d.resolve('r1', { kind: 'cancel' });
    expect(d.hasPending('r1')).toBe(false);
  });

  it('clear cancels all pending awaits', async () => {
    const d = new CanvasPreviewingDispatcher();
    const p1 = d.awaitDecision(fakeState('r1'));
    const p2 = d.awaitDecision(fakeState('r2'));
    d.clear();
    expect(await p1).toEqual({ kind: 'cancel' });
    expect(await p2).toEqual({ kind: 'cancel' });
  });
});
