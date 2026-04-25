import type { ChatMessageStore } from './messageStore';
import type {
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  RedactedThinkingBlock,
} from './types';
import type { StreamEvent, ContentBlockStart } from '@/agent/streamEvents';

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
  readonly onParseError?: (info: { toolUseIndex: number; raw: string; error: string }) => void;
  readonly onEvent?: (event: StreamEvent) => void;
}

interface ActiveTurn {
  readonly assistantId: string;
  readonly controller: AbortController;
  toolCount: number;
  phase: StreamingPhase;
  rafHandle: number | null;
  finalised: boolean;
  blocks: ContentBlock[];
  jsonBuffers: Map<number, string>;
  pendingTextByIndex: Map<number, string>;
  pendingThinkingByIndex: Map<number, string>;
  pendingSignatureByIndex: Map<number, string>;
  lastEventAt: number;
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

  get lastEventAt(): number | null {
    return this.active?.lastEventAt ?? null;
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
      blocks: [],
    });
    const controller = new AbortController();
    this.active = {
      assistantId,
      controller,
      toolCount: 0,
      phase: 'streaming',
      rafHandle: null,
      finalised: false,
      blocks: [],
      jsonBuffers: new Map(),
      pendingTextByIndex: new Map(),
      pendingThinkingByIndex: new Map(),
      pendingSignatureByIndex: new Map(),
      lastEventAt: this.nowMs(),
    };
    this.deps.onPhaseChange?.('streaming');
    this.deps.announce('streaming started');
    return controller.signal;
  }

  consume(event: StreamEvent): void {
    const turn = this.active;
    if (turn === null) return;
    if (turn.phase === 'cancelled' || turn.phase === 'done' || turn.phase === 'error') return;
    turn.lastEventAt = this.nowMs();
    this.deps.onEvent?.(event);

    if (event.type === 'block_start') {
      this.applyBlockStart(turn, event.index, event.block);
      return;
    }
    if (event.type === 'block_delta') {
      const d = event.delta;
      if (turn.phase === 'cancelling') return;
      if (d.type === 'text_delta') {
        const prev = turn.pendingTextByIndex.get(event.index) ?? '';
        turn.pendingTextByIndex.set(event.index, prev + d.text);
      } else if (d.type === 'thinking_delta') {
        const prev = turn.pendingThinkingByIndex.get(event.index) ?? '';
        turn.pendingThinkingByIndex.set(event.index, prev + d.thinking);
      } else if (d.type === 'signature_delta') {
        turn.pendingSignatureByIndex.set(event.index, d.signature);
      } else if (d.type === 'input_json_delta') {
        const prev = turn.jsonBuffers.get(event.index) ?? '';
        turn.jsonBuffers.set(event.index, prev + d.partial_json);
      } else if (d.type === 'tool_result_delta') {
        const prev = turn.pendingTextByIndex.get(event.index) ?? '';
        turn.pendingTextByIndex.set(event.index, prev + d.text);
      }
      this.ensureRafScheduled();
      return;
    }
    if (event.type === 'block_stop') {
      this.applyBlockStop(turn, event.index);
      return;
    }
    if (event.type === 'message_delta') {
      // usage merge — never overwrite a non-zero input/output with a zero
      return;
    }
    if (event.type === 'progress') {
      // F08 hooks runStateStore externally via deps.onEvent
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
    const text = new Map(turn.pendingTextByIndex);
    const thinking = new Map(turn.pendingThinkingByIndex);
    const signature = new Map(turn.pendingSignatureByIndex);
    turn.pendingTextByIndex.clear();
    turn.pendingThinkingByIndex.clear();
    turn.pendingSignatureByIndex.clear();
    if (text.size === 0 && thinking.size === 0 && signature.size === 0) return;

    this.deps.messageStore.update(turn.assistantId, (prev) => {
      const blocks = prev.blocks ?? [];
      const nextBlocks = blocks.slice();
      let assistantTextAppend = '';
      const ensure = (idx: number, fallback: ContentBlock): ContentBlock => {
        while (nextBlocks.length <= idx) nextBlocks.push({ type: 'text', text: '' });
        const existing = nextBlocks[idx];
        return existing ?? fallback;
      };
      for (const [idx, append] of text) {
        const existing = ensure(idx, { type: 'text', text: '' });
        if (existing.type === 'text') {
          nextBlocks[idx] = { ...existing, text: existing.text + append };
          assistantTextAppend += append;
        } else if (existing.type === 'tool_result') {
          nextBlocks[idx] = { ...existing, content: existing.content + append };
        } else {
          nextBlocks[idx] = { type: 'text', text: append } as TextBlock;
          assistantTextAppend += append;
        }
      }
      for (const [idx, append] of thinking) {
        const existing = ensure(idx, { type: 'thinking', thinking: '' });
        if (existing.type === 'thinking') {
          nextBlocks[idx] = { ...existing, thinking: existing.thinking + append };
        } else {
          nextBlocks[idx] = { type: 'thinking', thinking: append } as ThinkingBlock;
        }
      }
      for (const [idx, sig] of signature) {
        const existing = ensure(idx, { type: 'thinking', thinking: '' });
        if (existing.type === 'thinking') {
          nextBlocks[idx] = { ...existing, signature: sig };
        } else {
          nextBlocks[idx] = { type: 'thinking', thinking: '', signature: sig } as ThinkingBlock;
        }
      }
      return {
        ...prev,
        blocks: nextBlocks,
        content: assistantTextAppend.length > 0 ? prev.content + assistantTextAppend : prev.content,
      };
    });
  }

  private applyBlockStart(turn: ActiveTurn, index: number, block: ContentBlockStart): void {
    if (block.type === 'text') {
      const text = block.text ?? '';
      this.deps.messageStore.updateBlock(turn.assistantId, index, { type: 'text', text });
    } else if (block.type === 'thinking') {
      const initial: ThinkingBlock = {
        type: 'thinking',
        thinking: block.thinking ?? '',
        ...(block.signature !== undefined ? { signature: block.signature } : {}),
      };
      this.deps.messageStore.updateBlock(turn.assistantId, index, initial);
    } else if (block.type === 'redacted_thinking') {
      const initial: RedactedThinkingBlock = { type: 'redacted_thinking', data: block.data };
      this.deps.messageStore.updateBlock(turn.assistantId, index, initial);
    } else if (block.type === 'tool_use') {
      const initial: ToolUseBlock = {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: {},
      };
      this.deps.messageStore.updateBlock(turn.assistantId, index, initial);
      turn.jsonBuffers.set(index, '');
    } else if (block.type === 'tool_result') {
      const initial: ToolResultBlock = {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: '',
        ...(block.is_error !== undefined ? { is_error: block.is_error } : {}),
      };
      this.deps.messageStore.updateBlock(turn.assistantId, index, initial);
    }
  }

  private applyBlockStop(turn: ActiveTurn, index: number): void {
    this.flushPending();
    if (!turn.jsonBuffers.has(index)) return;
    const raw = turn.jsonBuffers.get(index) ?? '';
    turn.jsonBuffers.delete(index);
    this.deps.messageStore.updateBlock(turn.assistantId, index, (prev) => {
      if (prev?.type !== 'tool_use') return prev as ContentBlock;
      try {
        const parsed = raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
        return { ...prev, input: parsed };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.deps.onParseError?.({ toolUseIndex: index, raw, error: msg });
        return { ...prev, input: {}, raw };
      }
    });
  }

  private nowMs(): number {
    if (this.schedulers.now !== undefined) return this.schedulers.now();
    return Date.now();
  }

  private finalise(kind: 'done' | 'cancelled'): void {
    const turn = this.active;
    if (turn === null || turn.finalised) return;
    turn.finalised = true;
    if (turn.rafHandle !== null) {
      this.schedulers.caf(turn.rafHandle);
      turn.rafHandle = null;
    }
    this.flushPending();
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
