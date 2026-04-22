import type { Logger } from '@/platform/Logger';
import { FifoQueue } from '@/util/fifoQueue';
import { delay } from '@/util/delay';
import { ConnectionState } from './connectionState';
import {
  ProviderConnectError,
  ProviderTimeoutError,
  type Provider,
  type ProviderChatRequest,
  type ProviderModel,
  type StreamEvent,
} from './types';

export interface ProviderManagerOptions {
  readonly provider: Provider;
  readonly logger?: Logger;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly probeIntervalMs?: number;
  readonly connection?: ConnectionState;
  readonly setIntervalImpl?: typeof setInterval;
  readonly clearIntervalImpl?: typeof clearInterval;
}

const DEFAULTS = {
  timeoutMs: 120_000,
  maxAttempts: 4,
  baseBackoffMs: 500,
  maxBackoffMs: 4_000,
  probeIntervalMs: 15_000,
};

export class ProviderManager {
  readonly connection: ConnectionState;
  private readonly queue = new FifoQueue();
  private probeHandle: ReturnType<typeof setInterval> | null = null;
  private readonly setIntervalImpl: typeof setInterval;
  private readonly clearIntervalImpl: typeof clearInterval;
  private activeProvider: Provider;

  constructor(private readonly opts: ProviderManagerOptions) {
    this.connection = opts.connection ?? new ConnectionState();
    this.setIntervalImpl = opts.setIntervalImpl ?? setInterval;
    this.clearIntervalImpl = opts.clearIntervalImpl ?? clearInterval;
    this.activeProvider = opts.provider;
  }

  isReady(): boolean {
    return this.connection.isReachable();
  }

  activeProviderId(): string {
    return this.activeProvider.id;
  }

  setProvider(next: Provider): void {
    this.activeProvider = next;
    this.connection.markReachable();
    this.stopProbe();
    this.opts.logger?.info('provider.swap', { id: next.id });
  }

  async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    return this.activeProvider.listModels(signal);
  }

  stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    return this.runStream(req, signal);
  }

  dispose(): void {
    this.stopProbe();
  }

  private async *runStream(
    req: ProviderChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    if (!this.connection.isReachable()) {
      const error = new ProviderConnectError('provider unreachable');
      yield { type: 'error', error };
      return;
    }
    const release = await this.queue.acquire();
    try {
      yield* this.attemptWithRetry(req, signal);
    } finally {
      release();
    }
  }

  private async *attemptWithRetry(
    req: ProviderChatRequest,
    callerSignal: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    const max = this.opts.maxAttempts ?? DEFAULTS.maxAttempts;
    for (let attempt = 0; attempt < max; attempt++) {
      if (callerSignal.aborted) return;

      const attemptCtl = new AbortController();
      const onCallerAbort = (): void => attemptCtl.abort(callerSignal.reason);
      if (callerSignal.aborted) attemptCtl.abort(callerSignal.reason);
      else callerSignal.addEventListener('abort', onCallerAbort);
      const idleMs = this.opts.timeoutMs ?? DEFAULTS.timeoutMs;
      let timer = setTimeout(() => attemptCtl.abort(new ProviderTimeoutError()), idleMs);
      const bumpTimer = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => attemptCtl.abort(new ProviderTimeoutError()), idleMs);
      };

      let started = false;
      this.opts.logger?.info('provider.request', { attempt: attempt + 1, model: req.model });
      try {
        for await (const ev of this.activeProvider.stream(req, attemptCtl.signal)) {
          bumpTimer();
          if (ev.type === 'token' || ev.type === 'usage') started = true;
          if (ev.type === 'usage') {
            this.opts.logger?.info('provider.usage', { input: ev.input, output: ev.output });
          }
          yield ev;
          if (ev.type === 'done') {
            this.connection.markReachable();
            return;
          }
        }
        this.connection.markReachable();
        yield { type: 'done' };
        return;
      } catch (err) {
        if (callerSignal.aborted) return;
        const timedOut =
          attemptCtl.signal.aborted && attemptCtl.signal.reason instanceof ProviderTimeoutError;
        const surfaced = timedOut ? (attemptCtl.signal.reason as Error) : toError(err);
        const retryable = !timedOut && !started && err instanceof ProviderConnectError;
        if (!retryable) {
          this.opts.logger?.error('provider.failure', {
            stage: started ? 'mid-stream' : 'pre-stream',
            timedOut,
            error: surfaced.message,
          });
          yield { type: 'error', error: surfaced };
          return;
        }
        const isLast = attempt === max - 1;
        if (isLast) {
          this.markUnreachable(surfaced);
          yield { type: 'error', error: surfaced };
          return;
        }
        const wait = backoffMs(
          attempt,
          this.opts.baseBackoffMs ?? DEFAULTS.baseBackoffMs,
          this.opts.maxBackoffMs ?? DEFAULTS.maxBackoffMs,
        );
        this.opts.logger?.warn('provider.retry', {
          attempt: attempt + 1,
          nextDelayMs: wait,
          error: surfaced.message,
        });
        try {
          await delay(wait, callerSignal);
        } catch {
          return;
        }
      } finally {
        clearTimeout(timer);
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  private markUnreachable(err: Error): void {
    this.connection.markUnreachable();
    this.opts.logger?.error(
      'provider.unreachable',
      { error: err.message },
      { userFacing: true, userMessage: 'LM Studio unreachable' },
    );
    this.startProbe();
  }

  private startProbe(): void {
    if (this.probeHandle !== null) return;
    const interval = this.opts.probeIntervalMs ?? DEFAULTS.probeIntervalMs;
    this.probeHandle = this.setIntervalImpl(() => {
      void this.probeOnce();
    }, interval);
  }

  private stopProbe(): void {
    if (this.probeHandle === null) return;
    this.clearIntervalImpl(this.probeHandle);
    this.probeHandle = null;
  }

  private async probeOnce(): Promise<void> {
    try {
      await this.activeProvider.listModels();
      this.opts.logger?.info('provider.reachable', {});
      this.connection.markReachable();
      this.stopProbe();
    } catch {
      /* still down — keep probing */
    }
  }
}

function backoffMs(attempt: number, base: number, max: number): number {
  return Math.min(base * 2 ** attempt, max);
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}
