import type { ChatMessageStore } from './messageStore';
import type { StreamEvent } from '@/agent/streamEvents';

export type StreamingPhase = 'idle' | 'streaming' | 'cancelling' | 'cancelled' | 'done' | 'error';

export interface StreamingAnnouncer {
  (message: string): void;
}

export interface StreamingSchedulers {
  readonly raf: (cb: FrameRequestCallback) => number;
  readonly caf: (handle: number) => void;
  readonly now?: () => number;
}

export interface StreamingTurnControllerDeps {
  readonly messageStore: ChatMessageStore;
  readonly announce: StreamingAnnouncer;
  readonly onPhaseChange?: (phase: StreamingPhase) => void;
  readonly nowIso?: () => string;
  readonly schedulers?: StreamingSchedulers;
}

interface ActiveTurn {
  readonly assistantId: string;
  readonly controller: AbortController;
  toolCount: number;
  phase: StreamingPhase;
  pending: string;
  rafHandle: number | null;
  finalised: boolean;
}

const defaultSchedulers = (): StreamingSchedulers => {
  const g = globalThis as {
    requestAnimationFrame?: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame?: (h: number) => void;
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  };
  if (
    typeof g.requestAnimationFrame === 'function' &&
    typeof g.cancelAnimationFrame === 'function'
  ) {
    return {
      raf: (cb) => g.requestAnimationFrame!(cb),
      caf: (h) => g.cancelAnimationFrame!(h),
    };
  }
  return {
    raf: (cb) => g.setTimeout(() => cb(Date.now()), 16) as unknown as number,
    caf: (h) => g.clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
  };
};

export class StreamingTurnController {
  private active: ActiveTurn | null = null;
  private readonly schedulers: StreamingSchedulers;

  constructor(private readonly deps: StreamingTurnControllerDeps) {
    this.schedulers = deps.schedulers ?? defaultSchedulers();
  }

  get phase(): StreamingPhase {
    return this.active?.phase ?? 'idle';
  }

  get toolCount(): number {
    return this.active?.toolCount ?? 0;
  }

  get signal(): AbortSignal | null {
    return this.active?.controller.signal ?? null;
  }

  startTurn(assistantId: string): AbortSignal {
    if (this.active !== null) this.cleanupActive('cancelled');
    const now = this.deps.nowIso?.() ?? new Date().toISOString();
    this.deps.messageStore.append({
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: now,
      status: 'streaming',
    });
    const controller = new AbortController();
    this.active = {
      assistantId,
      controller,
      toolCount: 0,
      phase: 'streaming',
      pending: '',
      rafHandle: null,
      finalised: false,
    };
    this.deps.onPhaseChange?.('streaming');
    this.deps.announce('streaming started');
    return controller.signal;
  }

  consume(event: StreamEvent): void {
    const turn = this.active;
    if (turn === null) return;
    if (turn.phase === 'cancelled' || turn.phase === 'done' || turn.phase === 'error') return;

    if (event.type === 'token') {
      if (turn.phase === 'cancelling') return;
      turn.pending += event.text;
      this.ensureRafScheduled();
      return;
    }
    if (event.type === 'usage') {
      return;
    }
    if (event.type === 'done') {
      this.flushPending();
      if (turn.phase !== 'cancelling') {
        this.finalise('done');
      } else {
        this.finalise('cancelled');
      }
      return;
    }
    if (event.type === 'error') {
      this.flushPending();
      this.finaliseError(event.error);
      return;
    }
  }

  async consumeIterable(iter: AsyncIterable<StreamEvent>): Promise<void> {
    try {
      for await (const ev of iter) {
        this.consume(ev);
        if (this.active === null) return;
        if (this.active.phase === 'cancelled' || this.active.phase === 'error') return;
      }
      if (this.active !== null && !this.active.finalised) {
        this.consume({ type: 'done' });
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.active !== null) {
        this.flushPending();
        if (this.active.phase === 'cancelling' || this.active.controller.signal.aborted) {
          this.finalise('cancelled');
        } else {
          this.finaliseError(error);
        }
      }
    }
  }

  recordToolCompleted(): void {
    if (this.active === null) return;
    this.active.toolCount += 1;
  }

  stop(): void {
    const turn = this.active;
    if (turn === null) return;
    if (turn.phase !== 'streaming') return;
    turn.phase = 'cancelling';
    this.deps.onPhaseChange?.('cancelling');
    turn.controller.abort();
  }

  dispose(): void {
    if (this.active === null) return;
    if (this.active.phase === 'streaming' || this.active.phase === 'cancelling') {
      this.active.controller.abort();
    }
    if (this.active.rafHandle !== null) {
      this.schedulers.caf(this.active.rafHandle);
      this.active.rafHandle = null;
    }
    this.active = null;
    this.deps.onPhaseChange?.('idle');
  }

  private cleanupActive(reason: 'cancelled'): void {
    const turn = this.active;
    if (turn === null) return;
    turn.controller.abort();
    if (turn.rafHandle !== null) {
      this.schedulers.caf(turn.rafHandle);
      turn.rafHandle = null;
    }
    this.finalise(reason);
  }

  private ensureRafScheduled(): void {
    const turn = this.active;
    if (turn === null) return;
    if (turn.rafHandle !== null) return;
    turn.rafHandle = this.schedulers.raf(() => {
      if (this.active !== turn) return;
      turn.rafHandle = null;
      this.flushPending();
    });
  }

  private flushPending(): void {
    const turn = this.active;
    if (turn === null) return;
    const text = turn.pending;
    if (text.length === 0) return;
    turn.pending = '';
    this.deps.messageStore.update(turn.assistantId, (prev) => ({
      ...prev,
      content: prev.content + text,
    }));
  }

  private finalise(kind: 'done' | 'cancelled'): void {
    const turn = this.active;
    if (turn === null || turn.finalised) return;
    turn.finalised = true;
    if (turn.rafHandle !== null) {
      this.schedulers.caf(turn.rafHandle);
      turn.rafHandle = null;
    }
    const nextStatus: 'done' | 'cancelled' = kind;
    this.deps.messageStore.update(turn.assistantId, (prev) => ({ ...prev, status: nextStatus }));
    if (kind === 'cancelled') {
      const n = turn.toolCount;
      const now = this.deps.nowIso?.() ?? new Date().toISOString();
      this.deps.messageStore.append({
        id: `${turn.assistantId}:banner`,
        role: 'banner',
        content: `cancelled after ${n} ${n === 1 ? 'tool' : 'tools'}`,
        createdAt: now,
        banner: { kind: 'cancelled', toolCount: n },
      });
      this.deps.announce(`cancelled after ${n} ${n === 1 ? 'tool' : 'tools'}`);
      turn.phase = 'cancelled';
      this.deps.onPhaseChange?.('cancelled');
    } else {
      this.deps.announce('streaming stopped');
      turn.phase = 'done';
      this.deps.onPhaseChange?.('done');
    }
    this.active = null;
    this.deps.onPhaseChange?.('idle');
  }

  private finaliseError(err: Error): void {
    const turn = this.active;
    if (turn === null || turn.finalised) return;
    turn.finalised = true;
    if (turn.rafHandle !== null) {
      this.schedulers.caf(turn.rafHandle);
      turn.rafHandle = null;
    }
    this.deps.messageStore.update(turn.assistantId, (prev) => ({ ...prev, status: 'error' }));
    const now = this.deps.nowIso?.() ?? new Date().toISOString();
    const msg = err.message.length > 0 ? err.message : 'stream error';
    this.deps.messageStore.append({
      id: `${turn.assistantId}:banner`,
      role: 'banner',
      content: `stream error: ${msg}`,
      createdAt: now,
      banner: { kind: 'error', message: msg },
    });
    this.deps.announce(`stream error: ${msg}`);
    turn.phase = 'error';
    this.deps.onPhaseChange?.('error');
    this.active = null;
    this.deps.onPhaseChange?.('idle');
  }
}
