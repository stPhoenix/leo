import { ChatOpenAI } from '@langchain/openai';
import type { Runnable } from '@langchain/core/runnables';
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages';
import type { Provider, ProviderChatRequest, ProviderModel, StreamEvent } from './types';
import { ProviderConnectError } from './types';
import { toLangchainMessages } from './langchainMessages';
import { normalizeForOpenAI } from './contentNormalize';
import { toStreamEvents } from './langchainStream';
import { toRunnableConfig } from './traceConfig';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleProviderOptions {
  readonly id: string;
  readonly endpoint: () => string;
  readonly apiKey?: () => string;
  readonly headers?: () => Record<string, string>;
  readonly fetch?: FetchLike;
  readonly modelListPath?: string;
  readonly listModelsFromHttp?: boolean;
  readonly modelSupportsVision?: (model: string) => boolean;
}

interface OpenAIModelsResponse {
  readonly data?: ReadonlyArray<{ readonly id?: unknown }>;
}

type OpenAICallable = Runnable<BaseMessage[], AIMessageChunk> | ChatOpenAI;

export class OpenAICompatibleProvider implements Provider {
  readonly id: string;
  private readonly fetchImpl: FetchLike;
  private readonly headersFn: () => Record<string, string>;
  private readonly modelListPath: string;

  constructor(private readonly opts: OpenAICompatibleProviderOptions) {
    this.id = opts.id;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.headersFn = opts.headers ?? ((): Record<string, string> => ({}));
    this.modelListPath = opts.modelListPath ?? '/v1/models';
  }

  async *stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const baseURL = `${this.baseUrl()}/v1`;
    const apiKey = this.opts.apiKey?.() ?? 'placeholder';
    const defaultHeaders = this.headersFn();

    const model = new ChatOpenAI({
      model: req.model,
      apiKey,
      streaming: true,
      streamUsage: true,
      ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      configuration: {
        baseURL,
        dangerouslyAllowBrowser: true,
        ...(Object.keys(defaultHeaders).length > 0 ? { defaultHeaders } : {}),
      },
    });

    const callable: OpenAICallable =
      req.tools !== undefined && req.tools.length > 0 ? model.bindTools([...req.tools]) : model;

    const supportsVision =
      this.opts.modelSupportsVision?.(req.model) ?? defaultModelSupportsVision(req.model);
    const normalized = normalizeForOpenAI(req.messages, { supportsVision });
    const messages = toLangchainMessages(normalized);
    let stream: AsyncIterable<AIMessageChunk>;
    try {
      stream = await callable.stream(messages, { signal, ...toRunnableConfig(req.trace) });
    } catch (err) {
      if (signal.aborted) throw abortReason(signal);
      throw asConnectError(err, 'stream failed');
    }
    yield* toStreamEvents(stream);
  }

  async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    const url = `${this.baseUrl()}${this.modelListPath}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...(signal !== undefined ? { signal } : {}),
        headers: this.headersFn(),
      });
    } catch (err) {
      if (signal?.aborted === true) throw abortReason(signal);
      throw asConnectError(err, 'fetch failed');
    }
    if (!response.ok) throw new ProviderConnectError(`HTTP ${response.status}`);
    const json = (await response.json()) as OpenAIModelsResponse;
    const data = json.data ?? [];
    const out: ProviderModel[] = [];
    for (const m of data) {
      if (typeof m.id === 'string') out.push({ id: m.id });
    }
    return out;
  }

  private baseUrl(): string {
    return this.opts.endpoint().replace(/\/+$/, '');
  }
}

export interface OpenAIProviderOptions {
  readonly apiKey: () => string;
  readonly endpoint?: () => string;
  readonly fetch?: FetchLike;
  readonly organization?: () => string | null;
}

export function createOpenAIProvider(opts: OpenAIProviderOptions): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'openai',
    endpoint: opts.endpoint ?? ((): string => 'https://api.openai.com'),
    apiKey: opts.apiKey,
    headers: () => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${opts.apiKey()}`,
      };
      const org = opts.organization?.();
      if (typeof org === 'string' && org.length > 0) headers['OpenAI-Organization'] = org;
      return headers;
    },
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  });
}

export interface OllamaProviderOptions {
  readonly endpoint?: () => string;
  readonly fetch?: FetchLike;
}

export function createOllamaProvider(opts: OllamaProviderOptions = {}): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'ollama',
    endpoint: opts.endpoint ?? ((): string => 'http://localhost:11434'),
    apiKey: () => 'ollama',
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  });
}

export interface CustomProviderOptions {
  readonly baseURL: () => string;
  readonly authHeader?: () => { name: string; value: string } | null;
  readonly fetch?: FetchLike;
}

export function createCustomProvider(opts: CustomProviderOptions): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'custom',
    endpoint: opts.baseURL,
    apiKey: () => {
      const auth = opts.authHeader?.() ?? null;
      if (
        auth !== null &&
        auth.name.toLowerCase() === 'authorization' &&
        auth.value.startsWith('Bearer ')
      ) {
        return auth.value.slice(7);
      }
      return 'placeholder';
    },
    headers: () => {
      const auth = opts.authHeader?.() ?? null;
      if (auth === null || auth.name.length === 0) return {};
      return { [auth.name]: auth.value };
    },
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  });
}

function asConnectError(err: unknown, fallback: string): ProviderConnectError {
  if (err instanceof ProviderConnectError) return err;
  if (err instanceof Error)
    return new ProviderConnectError(err.message.length > 0 ? err.message : fallback, {
      cause: err,
    });
  return new ProviderConnectError(fallback);
}

function defaultModelSupportsVision(model: string): boolean {
  const m = model.toLowerCase();
  if (m.includes('gpt-4o') || m.includes('gpt-4.1') || m.includes('gpt-5')) return true;
  if (m.includes('vision') || m.includes('-vl') || m.includes('llava')) return true;
  return false;
}

function abortReason(signal: AbortSignal): Error {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  return new Error('aborted');
}
