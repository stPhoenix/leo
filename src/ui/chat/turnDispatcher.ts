import type { ChatMessageStore } from '@/chat/messageStore';
import type { ChatMessageRecord } from '@/chat/types';
import type { StreamingTurnController } from '@/chat/streamingController';
import type { StreamEvent } from '@/agent/streamEvents';
import { computeTokenUsage } from '@/chat/tokenUsage';

export interface TurnDispatcherStarter {
  (prompt: string, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface TurnDispatcherOptions {
  readonly messageStore: ChatMessageStore;
  readonly controller: StreamingTurnController;
  readonly starter?: TurnDispatcherStarter;
  readonly nowIso?: () => string;
  readonly idPrefixUser?: string;
  readonly idPrefixAssistant?: string;
}

interface PendingTurn {
  readonly userId: string;
  readonly assistantId: string;
  readonly text: string;
}

export class TurnDispatcher {
  private readonly pending: PendingTurn[] = [];
  private readonly listeners = new Set<() => void>();
  private counter = 0;
  private pumping = false;
  private disposed = false;

  constructor(private readonly deps: TurnDispatcherOptions) {}

  submit(text: string, opts: { appendUserRecord?: boolean } = {}): void {
    if (this.disposed) return;
    if (text.length === 0) return;
    this.counter += 1;
    const userId = `${this.deps.idPrefixUser ?? 'u-'}${this.counter}`;
    const assistantId = `${this.deps.idPrefixAssistant ?? 'a-'}${this.counter}`;
    const now = this.nowIso();
    if (opts.appendUserRecord !== false) {
      const userRecord: ChatMessageRecord = {
        id: userId,
        role: 'user',
        content: text,
        createdAt: now,
      };
      this.deps.messageStore.append(userRecord);
    }
    this.pending.push({ userId, assistantId, text });
    this.notify();
    void this.pump();
  }

  queueLength(): number {
    return this.pending.length;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return (): void => {
      this.listeners.delete(cb);
    };
  }

  clear(): void {
    if (this.disposed) return;
    if (this.pending.length === 0) return;
    this.pending.length = 0;
    this.notify();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.length = 0;
    this.notify();
    this.listeners.clear();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.disposed && this.pending.length > 0) {
        const turn = this.pending.shift();
        if (turn === undefined) break;
        this.notify();
        const signal = this.deps.controller.startTurn(turn.assistantId);
        const starter = this.deps.starter;
        if (starter === undefined) {
          this.commitUsage(turn, 0, undefined, undefined);
          this.deps.controller.consume({ type: 'done' });
          continue;
        }
        const tracked = this.trackUsage(turn, starter(turn.text, signal));
        try {
          await this.deps.controller.consumeIterable(tracked);
        } catch {
          /* controller handles error finalisation; trackUsage's finally already committed */
        }
      }
    } finally {
      this.pumping = false;
      this.notify();
    }
  }

  private async *trackUsage(
    turn: PendingTurn,
    iter: AsyncIterable<StreamEvent>,
  ): AsyncIterable<StreamEvent> {
    let providerInput: number | undefined;
    let providerOutput: number | undefined;
    let outputChars = 0;
    try {
      for await (const ev of iter) {
        if (ev.type === 'token') outputChars += ev.text.length;
        if (ev.type === 'usage') {
          providerInput = ev.input;
          providerOutput = ev.output;
        }
        yield ev;
      }
    } finally {
      this.commitUsage(turn, outputChars, providerInput, providerOutput);
    }
  }

  private commitUsage(
    turn: PendingTurn,
    outputChars: number,
    providerInput: number | undefined,
    providerOutput: number | undefined,
  ): void {
    const usage = computeTokenUsage({
      promptChars: turn.text.length,
      outputChars,
      ...(providerInput !== undefined ? { providerInput } : {}),
      ...(providerOutput !== undefined ? { providerOutput } : {}),
    });
    this.deps.messageStore.update(turn.assistantId, (prev) => ({ ...prev, tokens: usage }));
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private nowIso(): string {
    return this.deps.nowIso?.() ?? new Date().toISOString();
  }
}
