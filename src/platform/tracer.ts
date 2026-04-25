import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Logger } from './Logger';
import type { LeoSettings } from '@/settings/settingsStore';
import type { SafeStorage } from '@/storage/safeStorage';

export const LANGFUSE_PUBLIC_KEY = 'langfuse.publicKey';
export const LANGFUSE_SECRET_KEY = 'langfuse.secretKey';

export interface TraceContext {
  callbacks?: BaseCallbackHandler[];
  metadata: Record<string, unknown>;
  tags: string[];
}

export interface TraceTurnInput {
  readonly sessionId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly tags: readonly string[];
  readonly name?: string;
}

export interface TurnHandle {
  readonly traceContext: TraceContext;
  end(): Promise<void>;
}

interface ResolvedConfig {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly baseUrl: string;
}

interface LangfuseTraceClientLike {
  readonly id: string;
  span(opts: Record<string, unknown>): LangfuseSpanClientLike;
  update?(opts: Record<string, unknown>): unknown;
}

interface LangfuseSpanClientLike {
  readonly id: string;
  end(opts?: Record<string, unknown>): unknown;
  update?(opts: Record<string, unknown>): unknown;
}

interface LangfuseClientLike {
  trace(opts: Record<string, unknown>): LangfuseTraceClientLike;
  flushAsync(): Promise<unknown>;
  shutdownAsync(): Promise<unknown>;
}

interface LangfuseModule {
  Langfuse: new (opts: Record<string, unknown>) => LangfuseClientLike;
  default?: new (opts: Record<string, unknown>) => LangfuseClientLike;
}

interface CallbackHandlerLike extends BaseCallbackHandler {
  flushAsync?: () => Promise<unknown>;
  shutdownAsync?: () => Promise<unknown>;
}

interface CallbackHandlerCtor {
  new (params: Record<string, unknown>): CallbackHandlerLike;
}

interface LangfuseLangchainModule {
  CallbackHandler: CallbackHandlerCtor;
  default?: CallbackHandlerCtor;
}

export interface TracerServiceOptions {
  readonly safeStorage: SafeStorage;
  readonly logger?: Logger;
  readonly loadLangfuse?: (cfg: ResolvedConfig) => Promise<LangfuseClientLike>;
  readonly loadCallbackHandler?: () => Promise<CallbackHandlerCtor>;
}

export class TracerService {
  private client: LangfuseClientLike | null = null;
  private handlerCtor: CallbackHandlerCtor | null = null;
  private resolvedConfig: ResolvedConfig | null = null;
  private readonly threadTraces = new Map<string, LangfuseTraceClientLike>();
  private readonly safeStorage: SafeStorage;
  private readonly logger: Logger | undefined;
  private readonly loadLangfuse: NonNullable<TracerServiceOptions['loadLangfuse']>;
  private readonly loadCallbackHandler: NonNullable<TracerServiceOptions['loadCallbackHandler']>;

  constructor(opts: TracerServiceOptions) {
    this.safeStorage = opts.safeStorage;
    this.logger = opts.logger;
    this.loadLangfuse = opts.loadLangfuse ?? defaultLoadLangfuse;
    this.loadCallbackHandler = opts.loadCallbackHandler ?? defaultLoadCallbackHandler;
  }

  isEnabled(): boolean {
    return this.client !== null && this.handlerCtor !== null;
  }

  config(): ResolvedConfig | null {
    return this.resolvedConfig;
  }

  async refresh(settings: LeoSettings): Promise<void> {
    if (!settings.langfuse.enabled) {
      await this.disposeClient();
      this.resolvedConfig = null;
      this.logger?.info('tracer.refresh.disabled', {});
      return;
    }
    const [publicKey, secretKey] = await Promise.all([
      this.safeStorage.get(LANGFUSE_PUBLIC_KEY),
      this.safeStorage.get(LANGFUSE_SECRET_KEY),
    ]);
    if (
      publicKey === null ||
      publicKey.length === 0 ||
      secretKey === null ||
      secretKey.length === 0
    ) {
      await this.disposeClient();
      this.resolvedConfig = null;
      this.logger?.warn('tracer.refresh.skip', {
        reason: 'missing-keys',
        hasPublic: publicKey !== null && publicKey.length > 0,
        hasSecret: secretKey !== null && secretKey.length > 0,
      });
      return;
    }
    const host = settings.langfuse.host.trim();
    if (host.length === 0) {
      await this.disposeClient();
      this.resolvedConfig = null;
      this.logger?.warn('tracer.refresh.skip', { reason: 'missing-host' });
      return;
    }
    const cfg: ResolvedConfig = { publicKey, secretKey, baseUrl: host };
    try {
      const [client, ctor] = await Promise.all([
        this.loadLangfuse(cfg),
        this.loadCallbackHandler(),
      ]);
      await this.disposeClient();
      this.client = client;
      this.handlerCtor = ctor;
      this.resolvedConfig = cfg;
      this.logger?.info('tracer.refresh.enabled', { host });
    } catch (err) {
      this.logger?.error('tracer.refresh.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      await this.disposeClient();
      this.resolvedConfig = null;
    }
  }

  beginTurn(input: TraceTurnInput): TurnHandle {
    const baseMetadata: Record<string, unknown> = {
      ...input.metadata,
      langfuseSessionId: input.sessionId,
    };
    const baseTags = [...input.tags];
    const client = this.client;
    const Ctor = this.handlerCtor;
    if (client === null || Ctor === null) {
      this.logger?.debug('tracer.turn.skip', { sessionId: input.sessionId });
      return {
        traceContext: { metadata: baseMetadata, tags: baseTags },
        end: async () => undefined,
      };
    }
    let trace: LangfuseTraceClientLike;
    let span: LangfuseSpanClientLike;
    let handler: CallbackHandlerLike;
    try {
      trace = this.getOrCreateThreadTrace(client, input.sessionId, baseTags);
      span = trace.span({
        name: input.name ?? 'leo.turn',
        metadata: baseMetadata,
      });
      handler = new Ctor({
        root: { client, traceId: trace.id, observationId: span.id },
        updateRoot: false,
      });
    } catch (err) {
      this.logger?.warn('tracer.turn.build_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        traceContext: { metadata: baseMetadata, tags: baseTags },
        end: async () => undefined,
      };
    }
    this.logger?.info('tracer.turn.attached', {
      sessionId: input.sessionId,
      traceId: trace.id,
      spanId: span.id,
      tags: baseTags,
    });
    const ctx: TraceContext = {
      callbacks: [handler],
      metadata: baseMetadata,
      tags: baseTags,
    };
    return {
      traceContext: ctx,
      end: async () => {
        try {
          span.end();
        } catch (err) {
          this.logger?.warn('tracer.turn.span_end_failed', {
            error: err instanceof Error ? err.message : String(err),
            traceId: trace.id,
          });
        }
        try {
          if (typeof handler.flushAsync === 'function') {
            await handler.flushAsync();
          }
        } catch (err) {
          this.logger?.warn('tracer.turn.flush_failed', {
            error: err instanceof Error ? err.message : String(err),
            traceId: trace.id,
          });
        }
      },
    };
  }

  private getOrCreateThreadTrace(
    client: LangfuseClientLike,
    threadId: string,
    tags: readonly string[],
  ): LangfuseTraceClientLike {
    const existing = this.threadTraces.get(threadId);
    if (existing !== undefined) return existing;
    const trace = client.trace({
      id: threadId,
      name: `leo.thread:${threadId}`,
      sessionId: threadId,
      tags: [...tags],
      metadata: { threadId, kind: 'leo.thread' },
    });
    this.threadTraces.set(threadId, trace);
    return trace;
  }

  async testTrace(): Promise<void> {
    const cfg = this.resolvedConfig;
    if (cfg === null || this.client === null) throw new Error('tracer not configured');
    const trace = this.client.trace({
      name: 'leo.test',
      tags: ['leo', 'test'],
      metadata: { source: 'settings.testTrace', host: cfg.baseUrl },
    });
    const traceWithEvent = trace as unknown as {
      event?: (e: Record<string, unknown>) => unknown;
      update?: (u: Record<string, unknown>) => unknown;
    };
    traceWithEvent.event?.({ name: 'ping', input: { from: 'leo' } });
    traceWithEvent.update?.({ output: { ok: true } });
    await this.client.flushAsync();
    this.logger?.info('tracer.test.sent', { host: cfg.baseUrl, traceId: trace.id });
  }

  async dispose(): Promise<void> {
    await this.disposeClient();
    this.resolvedConfig = null;
  }

  private async disposeClient(): Promise<void> {
    const prev = this.client;
    this.client = null;
    this.handlerCtor = null;
    this.threadTraces.clear();
    if (prev === null) return;
    try {
      await prev.shutdownAsync();
    } catch (err) {
      this.logger?.warn('tracer.dispose.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function defaultLoadLangfuse(cfg: ResolvedConfig): Promise<LangfuseClientLike> {
  const mod = (await import('langfuse')) as unknown as LangfuseModule;
  const Ctor = mod.Langfuse ?? mod.default;
  if (Ctor === undefined) throw new Error('langfuse module missing Langfuse export');
  return new Ctor({
    publicKey: cfg.publicKey,
    secretKey: cfg.secretKey,
    baseUrl: cfg.baseUrl,
    flushAt: 1,
  });
}

async function defaultLoadCallbackHandler(): Promise<CallbackHandlerCtor> {
  const mod = (await import('langfuse-langchain')) as unknown as LangfuseLangchainModule;
  const Ctor = mod.CallbackHandler ?? mod.default;
  if (Ctor === undefined)
    throw new Error('langfuse-langchain module missing CallbackHandler export');
  return Ctor;
}
