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
  readonly firstEventTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxAttempts?: number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly probeIntervalMs?: number;
  readonly connection?: ConnectionState;
  readonly setIntervalImpl?: typeof setInterval;
  readonly clearIntervalImpl?: typeof clearInterval;
}

const DEFAULTS = {
  firstEventTimeoutMs: 300_000,
  idleTimeoutMs: 120_000,
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
  private firstEventTimeoutMs: number;
  private idleTimeoutMs: number;

  constructor(private readonly opts: ProviderManagerOptions) {
    this.connection = opts.connection ?? new ConnectionState();
    this.setIntervalImpl = opts.setIntervalImpl ?? setInterval;
    this.clearIntervalImpl = opts.clearIntervalImpl ?? clearInterval;
    this.activeProvider = opts.provider;
    this.firstEventTimeoutMs = opts.firstEventTimeoutMs ?? DEFAULTS.firstEventTimeoutMs;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULTS.idleTimeoutMs;
  }

  setTimeouts(opts: { firstEventMs?: number; idleMs?: number }): void {
    if (opts.firstEventMs !== undefined && opts.firstEventMs > 0) {
      this.firstEventTimeoutMs = opts.firstEventMs;
    }
    if (opts.idleMs !== undefined && opts.idleMs > 0) {
      this.idleTimeoutMs = opts.idleMs;
    }
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

  // Hybrid hand-rolled loop: outer retry + inner idle-bump. LangChain
  // `Runnable.withRetry()` cannot replace the outer loop because it hardcodes
  // `factor:2 / minTimeout:1000` (see `@langchain/core/utils/p-retry`) — the
  // configurable `baseBackoffMs / maxBackoffMs` knobs would be lost. The inner
  // idle-bump cannot use `AbortSignal.timeout(idleMs)` because that primitive
  // is one-shot and cannot be extended on each event (NFR-PROV-03 watchdog).
  private async *attemptWithRetry(
    req: ProviderChatRequest,
    callerSignal: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    const max = this.opts.maxAttempts ?? DEFAULTS.maxAttempts;
    for (let attempt = 0; attempt < max; attempt++) {
      if (callerSignal.aborted) return;
      const watchdog = this.setupIdleWatchdog(callerSignal);
      this.opts.logger?.info('provider.request', { attempt: attempt + 1, model: req.model });
      const iter = this.activeProvider.stream(req, watchdog.attemptSignal)[Symbol.asyncIterator]();
      const startedRef = { value: false };
      try {
        const completed = yield* this.consumeAttemptStream(iter, watchdog, startedRef);
        if (completed) {
          this.connection.markReachable();
          return;
        }
      } catch (err) {
        const decision = this.handleAttemptError({
          err,
          callerSignal,
          watchdog,
          started: startedRef.value,
          attempt,
          max,
        });
        if (decision.kind === 'cancelled') return;
        if (decision.kind === 'fatal') {
          yield { type: 'error', error: decision.error };
          return;
        }
        try {
          await delay(decision.waitMs, callerSignal);
        } catch {
          return;
        }
      } finally {
        watchdog.clearTimer();
        if (iter.return !== undefined) {
          void iter.return().catch(() => undefined);
        }
      }
    }
  }

  private setupIdleWatchdog(callerSignal: AbortSignal): {
    readonly idleCtl: AbortController;
    readonly attemptSignal: AbortSignal;
    bumpTimer: () => void;
    clearTimer: () => void;
  } {
    const idleCtl = new AbortController();
    const attemptSignal = AbortSignal.any([callerSignal, idleCtl.signal]);
    let timer = setTimeout(
      () => idleCtl.abort(new ProviderTimeoutError()),
      this.firstEventTimeoutMs,
    );
    const idleMs = this.idleTimeoutMs;
    return {
      idleCtl,
      attemptSignal,
      bumpTimer: () => {
        clearTimeout(timer);
        timer = setTimeout(() => idleCtl.abort(new ProviderTimeoutError()), idleMs);
      },
      clearTimer: () => clearTimeout(timer),
    };
  }

  private async *consumeAttemptStream(
    iter: AsyncIterator<StreamEvent>,
    watchdog: { attemptSignal: AbortSignal; bumpTimer: () => void },
    startedRef: { value: boolean },
  ): AsyncGenerator<StreamEvent, boolean> {
    for (;;) {
      const next = await rejectOnAbort(iter.next(), watchdog.attemptSignal);
      if (next.done === true) {
        yield { type: 'done' };
        return true;
      }
      const ev = next.value;
      watchdog.bumpTimer();
      if (ev.type === 'block_start' || ev.type === 'block_delta' || ev.type === 'message_delta') {
        startedRef.value = true;
      }
      if (ev.type === 'message_delta' && ev.usage !== undefined) {
        this.opts.logger?.info('provider.usage', {
          input: ev.usage.input ?? 0,
          output: ev.usage.output ?? 0,
        });
      }
      yield ev;
      if (ev.type === 'done') return true;
    }
  }

  private handleAttemptError(args: {
    readonly err: unknown;
    readonly callerSignal: AbortSignal;
    readonly watchdog: { idleCtl: AbortController };
    readonly started: boolean;
    readonly attempt: number;
    readonly max: number;
  }): { kind: 'cancelled' } | { kind: 'fatal'; error: Error } | { kind: 'retry'; waitMs: number } {
    const { err, callerSignal, watchdog, started, attempt, max } = args;
    if (callerSignal.aborted) return { kind: 'cancelled' };
    const timedOut =
      watchdog.idleCtl.signal.aborted &&
      watchdog.idleCtl.signal.reason instanceof ProviderTimeoutError;
    const surfaced = timedOut ? (watchdog.idleCtl.signal.reason as Error) : toError(err);
    const retryable = !timedOut && !started && err instanceof ProviderConnectError;
    if (!retryable) {
      this.opts.logger?.error('provider.failure', {
        stage: started ? 'mid-stream' : 'pre-stream',
        timedOut,
        error: surfaced.message,
      });
      return { kind: 'fatal', error: surfaced };
    }
    const isLast = attempt === max - 1;
    if (isLast) {
      this.markUnreachable(surfaced);
      return { kind: 'fatal', error: surfaced };
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
    return { kind: 'retry', waitMs: wait };
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

function abortReason(signal: AbortSignal): Error {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  return new Error('aborted');
}

// Resolves with `p`, rejects if `signal` aborts first. The platform's
// `AbortSignal.any` composes signals but does not bridge a signal to a
// promise rejection — provider streams' iterators may not honour the
// passed signal (e.g. ChatOpenAI hangs after fetch abort), so we race
// the iterator against the signal here.
function rejectOnAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
