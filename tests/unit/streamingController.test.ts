import { describe, expect, it, vi } from 'vitest';
import { StreamingTurnController, type StreamingPhase } from '@/chat/streamingController';
import { ChatMessageStore } from '@/chat/messageStore';
import type { StreamEvent } from '@/providers/types';

interface ManualRaf {
  schedulers: { raf: (cb: FrameRequestCallback) => number; caf: (h: number) => void };
  flush: () => void;
  cancelled: number[];
  pending: Map<number, FrameRequestCallback>;
}

function makeManualRaf(): ManualRaf {
  let id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  return {
    schedulers: {
      raf: (cb) => {
        id += 1;
        pending.set(id, cb);
        return id;
      },
      caf: (h) => {
        if (pending.delete(h)) {
          cancelled.push(h);
        }
      },
    },
    flush: () => {
      const entries = Array.from(pending.entries());
      pending.clear();
      for (const [, cb] of entries) cb(performance.now());
    },
    cancelled,
    pending,
  };
}

function makeController(overrides?: {
  announce?: (s: string) => void;
  onPhase?: (p: StreamingPhase) => void;
  raf?: ManualRaf;
  nowIso?: () => string;
}) {
  const store = new ChatMessageStore();
  const raf = overrides?.raf ?? makeManualRaf();
  const announce = overrides?.announce ?? (() => undefined);
  const controller = new StreamingTurnController({
    messageStore: store,
    announce,
    onPhaseChange: overrides?.onPhase,
    nowIso: overrides?.nowIso,
    schedulers: raf.schedulers,
  });
  return { store, raf, controller, announce };
}

describe('StreamingTurnController — token append order + keyed reconciliation (AC1, FR-CHAT-04)', () => {
  it('appends tokens to the tail assistant bubble in arrival order and only flushes on rAF', () => {
    const { store, raf, controller } = makeController();
    controller.startTurn('a1');
    controller.consume({ type: 'token', text: 'Hello, ' } satisfies StreamEvent);
    controller.consume({ type: 'token', text: 'world' });
    controller.consume({ type: 'token', text: '!' });

    expect(store.getSnapshot().find((m) => m.id === 'a1')?.content).toBe('');
    expect(raf.pending.size).toBe(1);
    raf.flush();
    expect(store.getSnapshot().find((m) => m.id === 'a1')?.content).toBe('Hello, world!');
  });

  it('leaves earlier completed messages unchanged while streaming the tail', () => {
    const { store, raf, controller } = makeController();
    store.set([
      { id: 'u0', role: 'user', content: 'hi', createdAt: '2026-04-21T10:00:00Z' },
      {
        id: 'a0',
        role: 'assistant',
        content: 'earlier',
        createdAt: '2026-04-21T10:00:01Z',
        status: 'done',
      },
    ]);
    controller.startTurn('a1');
    controller.consume({ type: 'token', text: 'new' });
    raf.flush();
    const snap = store.getSnapshot();
    expect(snap.find((m) => m.id === 'a0')?.content).toBe('earlier');
    expect(snap.find((m) => m.id === 'a1')?.content).toBe('new');
  });
});

describe('StreamingTurnController — rAF batching under bursts (AC3, NFR-PERF-05)', () => {
  it('batches a burst of 100 token events into a single rAF flush', () => {
    const { store, raf, controller } = makeController();
    controller.startTurn('a1');
    for (let i = 0; i < 100; i++) {
      controller.consume({ type: 'token', text: 'x' });
    }
    expect(raf.pending.size).toBe(1);
    raf.flush();
    expect(store.getSnapshot().find((m) => m.id === 'a1')?.content).toBe('x'.repeat(100));
  });

  it('reschedules rAF on the next burst after a flush', () => {
    const { raf, controller } = makeController();
    controller.startTurn('a1');
    controller.consume({ type: 'token', text: 'a' });
    raf.flush();
    expect(raf.pending.size).toBe(0);
    controller.consume({ type: 'token', text: 'b' });
    expect(raf.pending.size).toBe(1);
  });
});

describe('StreamingTurnController — stop aborts shared controller (AC4, FR-CHAT-05)', () => {
  it('stop() aborts the per-turn AbortController and suppresses further token appends', () => {
    const { store, raf, controller } = makeController();
    const signal = controller.startTurn('a1');
    expect(signal.aborted).toBe(false);
    controller.consume({ type: 'token', text: 'partial' });
    controller.stop();
    expect(signal.aborted).toBe(true);
    controller.consume({ type: 'token', text: 'late' });
    raf.flush();
    expect(store.getSnapshot().find((m) => m.id === 'a1')?.content).toBe('partial');
  });

  it('treats provider terminal `done` after stop as cancellation (emits the banner)', () => {
    const { store, raf, controller } = makeController();
    controller.startTurn('a1');
    controller.consume({ type: 'token', text: 'partial' });
    controller.stop();
    controller.consume({ type: 'done' });
    raf.flush();
    const banner = store.getSnapshot().find((m) => m.role === 'banner');
    expect(banner?.banner?.kind).toBe('cancelled');
    expect(banner?.content).toBe('cancelled after 0 tools');
  });
});

describe('StreamingTurnController — "cancelled after N tools" indicator (AC5, FR-CHAT-05, FR-UI-06)', () => {
  it('includes the tool counter with proper pluralisation', () => {
    const { store, controller } = makeController();
    controller.startTurn('a1');
    controller.recordToolCompleted();
    controller.recordToolCompleted();
    controller.stop();
    controller.consume({ type: 'done' });
    const banner = store.getSnapshot().find((m) => m.role === 'banner');
    expect(banner?.content).toBe('cancelled after 2 tools');
    expect(banner?.banner?.toolCount).toBe(2);
  });

  it('singular form when exactly one tool ran', () => {
    const { store, controller } = makeController();
    controller.startTurn('a1');
    controller.recordToolCompleted();
    controller.stop();
    controller.consume({ type: 'done' });
    const banner = store.getSnapshot().find((m) => m.role === 'banner');
    expect(banner?.content).toBe('cancelled after 1 tool');
  });
});

describe('StreamingTurnController — assertive live region messages (AC6, NFR-USE-08)', () => {
  it('announces start, cancellation, and error transitions', () => {
    const announce = vi.fn();
    const { controller } = makeController({ announce });
    controller.startTurn('a1');
    expect(announce).toHaveBeenCalledWith('streaming started');
    controller.stop();
    controller.consume({ type: 'done' });
    expect(announce).toHaveBeenCalledWith('cancelled after 0 tools');

    announce.mockClear();
    controller.startTurn('a2');
    controller.consume({ type: 'error', error: new Error('connection reset') });
    expect(announce).toHaveBeenCalledWith('stream error: connection reset');
  });

  it('announces "streaming stopped" on natural done', () => {
    const announce = vi.fn();
    const { controller } = makeController({ announce });
    controller.startTurn('a1');
    controller.consume({ type: 'done' });
    expect(announce).toHaveBeenCalledWith('streaming stopped');
  });
});

describe('StreamingTurnController — phase transitions (AC6)', () => {
  it('emits phase change events for streaming → cancelling → cancelled → idle', () => {
    const phases: StreamingPhase[] = [];
    const { controller } = makeController({ onPhase: (p) => phases.push(p) });
    controller.startTurn('a1');
    controller.stop();
    controller.consume({ type: 'done' });
    expect(phases).toEqual(['streaming', 'cancelling', 'cancelled', 'idle']);
  });

  it('emits phase change events for streaming → done → idle on natural completion', () => {
    const phases: StreamingPhase[] = [];
    const { controller } = makeController({ onPhase: (p) => phases.push(p) });
    controller.startTurn('a1');
    controller.consume({ type: 'done' });
    expect(phases).toEqual(['streaming', 'done', 'idle']);
  });

  it('emits phase change events for streaming → error → idle', () => {
    const phases: StreamingPhase[] = [];
    const { controller } = makeController({ onPhase: (p) => phases.push(p) });
    controller.startTurn('a1');
    controller.consume({ type: 'error', error: new Error('boom') });
    expect(phases).toEqual(['streaming', 'error', 'idle']);
  });
});

describe('StreamingTurnController — teardown aborts + cancels rAF (AC7, FR-CHAT-04/05)', () => {
  it('dispose() aborts and cancels any pending rAF handle', () => {
    const raf = makeManualRaf();
    const { controller } = makeController({ raf });
    const signal = controller.startTurn('a1');
    controller.consume({ type: 'token', text: 'x' });
    expect(raf.pending.size).toBe(1);
    controller.dispose();
    expect(signal.aborted).toBe(true);
    expect(raf.pending.size).toBe(0);
    expect(raf.cancelled.length).toBe(1);
  });

  it('dispose() while idle is a no-op', () => {
    const raf = makeManualRaf();
    const { controller } = makeController({ raf });
    expect(() => controller.dispose()).not.toThrow();
    expect(raf.pending.size).toBe(0);
  });
});

describe('StreamingTurnController — consumeIterable (integration with provider AsyncIterable)', () => {
  it('flushes all tokens and finalises `done` on natural stream end', async () => {
    const raf = makeManualRaf();
    const { store, controller } = makeController({ raf });
    controller.startTurn('a1');
    const events: StreamEvent[] = [
      { type: 'token', text: 'A' },
      { type: 'token', text: 'B' },
      { type: 'token', text: 'C' },
      { type: 'done' },
    ];
    async function* iter(): AsyncIterable<StreamEvent> {
      for (const e of events) yield e;
    }
    await controller.consumeIterable(iter());
    // `done` flushes pending before finalising
    expect(store.getSnapshot().find((m) => m.id === 'a1')?.content).toBe('ABC');
    expect(store.getSnapshot().find((m) => m.id === 'a1')?.status).toBe('done');
  });

  it('converts a thrown stream error into the error banner + phase', async () => {
    const { store, controller } = makeController();
    controller.startTurn('a1');
    async function* iter(): AsyncIterable<StreamEvent> {
      yield { type: 'token', text: 'part' };
      throw new Error('pipe closed');
    }
    await controller.consumeIterable(iter());
    const snap = store.getSnapshot();
    expect(snap.find((m) => m.id === 'a1')?.status).toBe('error');
    const banner = snap.find((m) => m.role === 'banner');
    expect(banner?.content).toBe('stream error: pipe closed');
  });

  it('when abort is raised mid-stream treats the exit as cancellation', async () => {
    const { store, controller } = makeController();
    const signal = controller.startTurn('a1');
    async function* iter(): AsyncIterable<StreamEvent> {
      yield { type: 'token', text: 'part' };
      controller.stop();
      const reason = (signal as AbortSignal & { reason?: unknown }).reason;
      throw reason instanceof Error ? reason : new Error('aborted');
    }
    await controller.consumeIterable(iter());
    const banner = store.getSnapshot().find((m) => m.role === 'banner');
    expect(banner?.banner?.kind).toBe('cancelled');
  });
});
