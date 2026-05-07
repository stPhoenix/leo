import type { ChatMessageStore } from '@/chat/messageStore';
import type { ChatMessageRecord, ContentBlock } from '@/chat/types';
import type { StreamingTurnController } from '@/chat/streamingController';
import type { StreamEvent } from '@/agent/streamEvents';
import { computeTokenUsage } from '@/chat/tokenUsage';

export interface TurnStarterOptions {
  readonly initialAllowedTools?: readonly string[];
}

export interface TurnDispatcherStarter {
  (
    prompt: string,
    signal: AbortSignal,
    blocks?: readonly ContentBlock[],
    options?: TurnStarterOptions,
  ): AsyncIterable<StreamEvent>;
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
  readonly blocks?: readonly ContentBlock[];
  readonly initialAllowedTools?: readonly string[];
}

export class TurnDispatcher {
  private readonly pending: PendingTurn[] = [];
  private readonly listeners = new Set<() => void>();
  private counter = 0;
  private pumping = false;
  private disposed = false;

  constructor(private readonly deps: TurnDispatcherOptions) {}

  submit(
    text: string,
    opts: {
      appendUserRecord?: boolean;
      blocks?: readonly ContentBlock[];
      slashCommand?: { readonly typed: string; readonly command: string };
      initialAllowedTools?: readonly string[];
    } = {},
  ): void {
    if (this.disposed) return;
    if (text.length === 0 && (opts.blocks === undefined || opts.blocks.length === 0)) return;
    this.counter += 1;
    const userId = `${this.deps.idPrefixUser ?? 'u-'}${this.counter}`;
    const assistantId = `${this.deps.idPrefixAssistant ?? 'a-'}${this.counter}`;
    const now = this.nowIso();
    const displayContent = opts.slashCommand?.typed ?? text;
    const composedBlocks: readonly ContentBlock[] | undefined =
      opts.slashCommand !== undefined
        ? [
            {
              type: 'slash_expanded',
              command: opts.slashCommand.command,
              typed: opts.slashCommand.typed,
              expandedBody: text,
            },
            ...(opts.blocks ?? []),
          ]
        : opts.blocks;
    if (opts.appendUserRecord !== false) {
      const userRecord: ChatMessageRecord = {
        id: userId,
        role: 'user',
        content: displayContent,
        createdAt: now,
        ...(composedBlocks !== undefined && composedBlocks.length > 0
          ? { blocks: composedBlocks }
          : {}),
      };
      this.deps.messageStore.append(userRecord);
    }
    this.pending.push({
      userId,
      assistantId,
      text,
      ...(opts.blocks !== undefined && opts.blocks.length > 0 ? { blocks: opts.blocks } : {}),
      ...(opts.initialAllowedTools !== undefined && opts.initialAllowedTools.length > 0
        ? { initialAllowedTools: opts.initialAllowedTools }
        : {}),
    });
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
          this.commitUsage(turn, 0, {});
          this.deps.controller.consume({ type: 'done' });
          continue;
        }
        const starterOptions: TurnStarterOptions =
          turn.initialAllowedTools !== undefined && turn.initialAllowedTools.length > 0
            ? { initialAllowedTools: turn.initialAllowedTools }
            : {};
        const hasOptions = starterOptions.initialAllowedTools !== undefined;
        const hasBlocks = turn.blocks !== undefined && turn.blocks.length > 0;
        const stream = hasBlocks
          ? starter(turn.text, signal, turn.blocks, hasOptions ? starterOptions : undefined)
          : hasOptions
            ? starter(turn.text, signal, undefined, starterOptions)
            : starter(turn.text, signal);
        const tracked = this.trackUsage(turn, stream);
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
    let providerReasoning: number | undefined;
    let providerCacheCreation: number | undefined;
    let providerCacheRead: number | undefined;
    let outputChars = 0;
    const captureUsage = (u: {
      input?: number;
      output?: number;
      reasoning?: number;
      cacheCreation?: number;
      cacheRead?: number;
    }): void => {
      if (typeof u.input === 'number') providerInput = u.input;
      if (typeof u.output === 'number') providerOutput = u.output;
      if (typeof u.reasoning === 'number') providerReasoning = u.reasoning;
      if (typeof u.cacheCreation === 'number') providerCacheCreation = u.cacheCreation;
      if (typeof u.cacheRead === 'number') providerCacheRead = u.cacheRead;
    };
    try {
      for await (const ev of iter) {
        if (ev.type === 'token') outputChars += ev.text.length;
        if (ev.type === 'usage') {
          captureUsage(ev);
        }
        if (ev.type === 'message_delta' && ev.usage !== undefined) {
          captureUsage(ev.usage);
        }
        yield ev;
      }
    } finally {
      this.commitUsage(turn, outputChars, {
        ...(providerInput !== undefined ? { providerInput } : {}),
        ...(providerOutput !== undefined ? { providerOutput } : {}),
        ...(providerReasoning !== undefined ? { providerReasoning } : {}),
        ...(providerCacheCreation !== undefined ? { providerCacheCreation } : {}),
        ...(providerCacheRead !== undefined ? { providerCacheRead } : {}),
      });
    }
  }

  private commitUsage(
    turn: PendingTurn,
    outputChars: number,
    extras: {
      providerInput?: number;
      providerOutput?: number;
      providerReasoning?: number;
      providerCacheCreation?: number;
      providerCacheRead?: number;
    },
  ): void {
    const usage = computeTokenUsage({
      promptChars: turn.text.length,
      outputChars,
      ...extras,
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
