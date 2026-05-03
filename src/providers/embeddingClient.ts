import { OpenAIEmbeddings } from '@langchain/openai';
import type { Logger } from '@/platform/Logger';
import type { ConnectionState } from './connectionState';
import { ProviderConnectError, ProviderTimeoutError } from './types';
import { delay } from '@/util/delay';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface EmbeddingClientOptions {
  readonly endpoint: () => string;
  readonly model: () => string;
  readonly apiKey?: () => string;
  readonly connection?: ConnectionState;
  readonly fetch?: FetchLike;
  readonly logger?: Logger;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly embedDocuments?: (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
}

const DEFAULTS = {
  timeoutMs: 120_000,
  maxAttempts: 4,
  baseBackoffMs: 500,
  maxBackoffMs: 4_000,
};

export const EMBED_BATCH_SIZE = 32 as const;

export class EmbeddingClient {
  private readonly embedDocsImpl: (texts: string[], signal?: AbortSignal) => Promise<number[][]>;

  constructor(private readonly opts: EmbeddingClientOptions) {
    this.embedDocsImpl = opts.embedDocuments ?? this.defaultEmbedDocs.bind(this);
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

    // Outer retry loop is hand-rolled because LangChain `Runnable.withRetry()`
    // hardcodes `minTimeout: 1000ms` and `factor: 2` (see
    // `@langchain/core/utils/p-retry`). Tests + ad-hoc back-off tuning
    // (`baseBackoffMs`) need finer control than the framework exposes.
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
    const timeoutMs = this.opts.timeoutMs ?? DEFAULTS.timeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const composed: AbortSignal =
      signal !== undefined ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      return await this.embedDocsImpl([...texts], composed);
    } catch (err) {
      if (
        composed.aborted &&
        composed.reason instanceof DOMException &&
        composed.reason.name === 'TimeoutError'
      ) {
        throw new ProviderTimeoutError();
      }
      if (err instanceof ProviderConnectError || err instanceof ProviderTimeoutError) throw err;
      throw new ProviderConnectError(errMessage(err), { cause: err });
    }
  }

  private async defaultEmbedDocs(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const baseURL = `${this.opts.endpoint().replace(/\/+$/, '')}/v1`;
    const apiKey = this.opts.apiKey?.() ?? 'placeholder';
    const embeddings = new OpenAIEmbeddings({
      model: this.opts.model(),
      apiKey,
      encodingFormat: 'float',
      configuration: {
        baseURL,
        dangerouslyAllowBrowser: true,
      },
    });
    if (signal?.aborted === true) throw signal.reason ?? new Error('aborted');
    return embeddings.embedDocuments(texts);
  }
}

function backoffMs(attempt: number, base: number, max: number): number {
  return Math.min(base * 2 ** attempt, max);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
