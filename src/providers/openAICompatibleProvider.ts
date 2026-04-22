import type {
  ChatMessage,
  Provider,
  ProviderChatRequest,
  ProviderModel,
  StreamEvent,
} from './types';
import { ProviderConnectError } from './types';
import { parseSseDataFrames } from './sseParser';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleProviderOptions {
  readonly id: string;
  readonly endpoint: () => string;
  readonly headers?: () => Record<string, string>;
  readonly fetch?: FetchLike;
  readonly modelListPath?: string;
  readonly streamPath?: string;
}

interface OpenAIToolCallDelta {
  readonly index?: number;
  readonly id?: string;
  readonly type?: string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
}

interface OpenAIDelta {
  readonly content?: string;
  readonly tool_calls?: readonly OpenAIToolCallDelta[];
}

interface OpenAIChoice {
  readonly delta?: OpenAIDelta;
  readonly finish_reason?: string | null;
}

interface OpenAIUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
}

interface OpenAIChunk {
  readonly choices?: readonly OpenAIChoice[];
  readonly usage?: OpenAIUsage;
}

interface OpenAIModelsResponse {
  readonly data?: ReadonlyArray<{ readonly id?: unknown }>;
}

export class OpenAICompatibleProvider implements Provider {
  readonly id: string;
  private readonly fetchImpl: FetchLike;
  private readonly headersFn: () => Record<string, string>;
  private readonly modelListPath: string;
  private readonly streamPath: string;

  constructor(private readonly opts: OpenAICompatibleProviderOptions) {
    this.id = opts.id;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.headersFn = opts.headers ?? ((): Record<string, string> => ({}));
    this.modelListPath = opts.modelListPath ?? '/v1/models';
    this.streamPath = opts.streamPath ?? '/v1/chat/completions';
  }

  async *stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const url = `${this.baseUrl()}${this.streamPath}`;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => serializeMessage(m)),
      stream: true,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.tools !== undefined && req.tools.length > 0) body.tools = req.tools;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...this.headersFn(),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw abortReason(signal);
      throw asConnectError(err, 'fetch failed');
    }
    if (!response.ok) throw new ProviderConnectError(`HTTP ${response.status}`);
    if (response.body === null) throw new ProviderConnectError('empty response body');

    let sawDone = false;
    const toolCallAcc = new Map<number, { id: string; name: string; argsJson: string }>();
    const emittedToolIds = new Set<string>();
    try {
      for await (const data of parseSseDataFrames(response.body, signal)) {
        if (data === '[DONE]') {
          sawDone = true;
          for (const call of flushToolCalls(toolCallAcc, emittedToolIds)) {
            yield { type: 'tool_call', call };
          }
          yield { type: 'done' };
          return;
        }
        let parsed: OpenAIChunk;
        try {
          parsed = JSON.parse(data) as OpenAIChunk;
        } catch {
          continue;
        }
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        const text = delta?.content;
        if (typeof text === 'string' && text.length > 0) {
          yield { type: 'token', text };
        }
        const toolDeltas = delta?.tool_calls;
        if (toolDeltas !== undefined) {
          for (const td of toolDeltas) {
            const idx = td.index ?? 0;
            const existing = toolCallAcc.get(idx) ?? { id: '', name: '', argsJson: '' };
            if (typeof td.id === 'string' && td.id.length > 0) existing.id = td.id;
            if (typeof td.function?.name === 'string' && td.function.name.length > 0) {
              existing.name = td.function.name;
            }
            if (typeof td.function?.arguments === 'string') {
              existing.argsJson += td.function.arguments;
            }
            toolCallAcc.set(idx, existing);
          }
        }
        if (choice?.finish_reason === 'tool_calls') {
          for (const call of flushToolCalls(toolCallAcc, emittedToolIds)) {
            yield { type: 'tool_call', call };
          }
        }
        const usage = parsed.usage;
        if (
          usage !== undefined &&
          typeof usage.prompt_tokens === 'number' &&
          typeof usage.completion_tokens === 'number'
        ) {
          yield { type: 'usage', input: usage.prompt_tokens, output: usage.completion_tokens };
        }
      }
    } catch (err) {
      if (signal.aborted) throw abortReason(signal);
      throw err;
    }
    if (signal.aborted) throw abortReason(signal);
    if (!sawDone) {
      for (const call of flushToolCalls(toolCallAcc, emittedToolIds)) {
        yield { type: 'tool_call', call };
      }
      yield { type: 'done' };
    }
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
    headers: () => {
      const auth = opts.authHeader?.() ?? null;
      if (auth === null || auth.name.length === 0) return {};
      return { [auth.name]: auth.value };
    },
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  });
}

function serializeMessage(m: ChatMessage): Record<string, unknown> {
  const raw: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.toolCalls !== undefined && m.toolCalls.length > 0) {
    raw.tool_calls = m.toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: c.argsJson },
    }));
  }
  if (m.toolCallId !== undefined) raw.tool_call_id = m.toolCallId;
  if (m.name !== undefined) raw.name = m.name;
  return raw;
}

function flushToolCalls(
  acc: Map<number, { id: string; name: string; argsJson: string }>,
  emitted: Set<string>,
): Array<{ id: string; name: string; argsJson: string }> {
  const out: Array<{ id: string; name: string; argsJson: string }> = [];
  for (const [idx, call] of acc) {
    const id = call.id.length > 0 ? call.id : `call_${idx}`;
    if (emitted.has(id)) continue;
    if (call.name.length === 0) continue;
    emitted.add(id);
    out.push({ id, name: call.name, argsJson: call.argsJson });
  }
  return out;
}

function asConnectError(err: unknown, fallback: string): ProviderConnectError {
  if (err instanceof ProviderConnectError) return err;
  if (err instanceof Error)
    return new ProviderConnectError(err.message || fallback, { cause: err });
  return new ProviderConnectError(fallback);
}

function abortReason(signal: AbortSignal): Error {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  return new Error('aborted');
}
