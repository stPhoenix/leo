import type { Logger } from '@/platform/Logger';
import type { ConnectionState } from './connectionState';
import type { FetchLike } from './lmStudioProvider';
import { ProviderConnectError, ProviderTimeoutError } from './types';
import { delay } from '@/util/delay';

export interface EmbeddingClientOptions {
  readonly endpoint: () => string;
  readonly model: () => string;
  readonly connection?: ConnectionState;
  readonly fetch?: FetchLike;
  readonly logger?: Logger;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

interface EmbeddingsResponse {
  readonly data?: ReadonlyArray<{ readonly embedding?: unknown }>;
}

const DEFAULTS = {
  timeoutMs: 120_000,
  maxAttempts: 4,
  baseBackoffMs: 500,
  maxBackoffMs: 4_000,
};

export const EMBED_BATCH_SIZE = 32 as const;

export class EmbeddingClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: EmbeddingClientOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  async embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    if (this.opts.connection !== undefined && !this.opts.connection.isReachable()) {
      throw new ProviderConnectError('provider unreachable');
    }
    if (texts.length === 0) return [];
    if (texts.length > EMBED_BATCH_SIZE) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        const slice = texts.slice(i, i + EMBED_BATCH_SIZE);
        this.opts.logger?.debug('index.embed.batch', {
          batchStart: i,
          batchSize: slice.length,
        });
        const vectors = await this.embed(slice, signal);
        for (const v of vectors) out.push(v);
      }
      return out;
    }

    const max = this.opts.maxAttempts ?? DEFAULTS.maxAttempts;
    const isAborted = (): boolean => signal !== undefined && signal.aborted;
    let lastErr: unknown;
    for (let attempt = 0; attempt < max; attempt++) {
      if (isAborted()) throw signal?.reason ?? new Error('aborted');
      try {
        const result = await this.embedOnce(texts, signal);
        this.opts.connection?.markReachable();
        return result;
      } catch (err) {
        lastErr = err;
        if (isAborted()) throw signal?.reason ?? new Error('aborted');
        if (attempt === max - 1) {
          this.opts.connection?.markUnreachable();
          this.opts.logger?.error(
            'provider.unreachable',
            { source: 'embedding', error: errMessage(err) },
            { userFacing: true, userMessage: 'LM Studio unreachable' },
          );
          throw err;
        }
        const wait = backoffMs(
          attempt,
          this.opts.baseBackoffMs ?? DEFAULTS.baseBackoffMs,
          this.opts.maxBackoffMs ?? DEFAULTS.maxBackoffMs,
        );
        this.opts.logger?.warn('provider.retry', {
          source: 'embedding',
          attempt: attempt + 1,
          nextDelayMs: wait,
          error: errMessage(err),
        });
        await delay(wait, signal);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async embedOnce(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    const url = `${this.opts.endpoint().replace(/\/+$/, '')}/v1/embeddings`;
    const ctl = new AbortController();
    const onAbort = (): void => ctl.abort(signal?.reason);
    if (signal !== undefined) {
      if (signal.aborted) ctl.abort(signal.reason);
      else signal.addEventListener('abort', onAbort);
    }
    const timeoutMs = this.opts.timeoutMs ?? DEFAULTS.timeoutMs;
    const timer = setTimeout(() => ctl.abort(new ProviderTimeoutError()), timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.opts.model(), input: [...texts] }),
          signal: ctl.signal,
        });
      } catch (err) {
        if (ctl.signal.aborted && ctl.signal.reason instanceof ProviderTimeoutError) {
          throw ctl.signal.reason;
        }
        throw err instanceof ProviderConnectError
          ? err
          : new ProviderConnectError(errMessage(err), { cause: err });
      }
      if (!response.ok) throw new ProviderConnectError(`HTTP ${response.status}`);
      const json = (await response.json()) as EmbeddingsResponse;
      const data = json.data ?? [];
      const out: number[][] = [];
      for (const row of data) {
        if (Array.isArray(row.embedding)) {
          out.push(row.embedding.filter((n): n is number => typeof n === 'number'));
        }
      }
      return out;
    } finally {
      clearTimeout(timer);
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
    }
  }
}

function backoffMs(attempt: number, base: number, max: number): number {
  return Math.min(base * 2 ** attempt, max);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
