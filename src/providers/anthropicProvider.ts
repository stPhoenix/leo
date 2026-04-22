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

export interface AnthropicProviderOptions {
  readonly apiKey: () => string;
  readonly endpoint?: () => string;
  readonly anthropicVersion?: string;
  readonly fetch?: FetchLike;
  readonly bundledModels?: readonly string[];
}

const DEFAULT_MODELS: readonly string[] = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
];

interface AnthropicDeltaEvent {
  readonly type?: string;
  readonly delta?: { readonly type?: string; readonly text?: string };
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
  readonly message?: {
    readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
  };
}

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic';
  private readonly fetchImpl: FetchLike;
  private readonly bundledModels: readonly string[];
  private readonly anthropicVersion: string;

  constructor(private readonly opts: AnthropicProviderOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.bundledModels = opts.bundledModels ?? DEFAULT_MODELS;
    this.anthropicVersion = opts.anthropicVersion ?? '2023-06-01';
  }

  async *stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const url = `${this.baseUrl()}/v1/messages`;
    const { system, messages } = splitSystemMessage(req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? 1024,
      stream: true,
    };
    if (system !== null) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-api-key': this.opts.apiKey(),
          'anthropic-version': this.anthropicVersion,
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

    let inputTokens = 0;
    let outputTokens = 0;
    let emittedUsage = false;
    try {
      for await (const data of parseSseDataFrames(response.body, signal)) {
        if (data.length === 0) continue;
        let parsed: AnthropicDeltaEvent;
        try {
          parsed = JSON.parse(data) as AnthropicDeltaEvent;
        } catch {
          continue;
        }
        const evType = parsed.type;
        if (evType === 'content_block_delta') {
          const delta = parsed.delta;
          if (
            delta?.type === 'text_delta' &&
            typeof delta.text === 'string' &&
            delta.text.length > 0
          ) {
            yield { type: 'token', text: delta.text };
          }
        } else if (evType === 'message_start') {
          const usage = parsed.message?.usage;
          if (usage !== undefined && typeof usage.input_tokens === 'number') {
            inputTokens = usage.input_tokens;
          }
        } else if (evType === 'message_delta') {
          const usage = parsed.usage;
          if (usage !== undefined && typeof usage.output_tokens === 'number') {
            outputTokens = usage.output_tokens;
          }
        } else if (evType === 'message_stop') {
          if (!emittedUsage && (inputTokens > 0 || outputTokens > 0)) {
            emittedUsage = true;
            yield { type: 'usage', input: inputTokens, output: outputTokens };
          }
          yield { type: 'done' };
          return;
        }
      }
    } catch (err) {
      if (signal.aborted) throw abortReason(signal);
      throw err;
    }
    if (!emittedUsage && (inputTokens > 0 || outputTokens > 0)) {
      yield { type: 'usage', input: inputTokens, output: outputTokens };
    }
    yield { type: 'done' };
  }

  async listModels(_signal?: AbortSignal): Promise<ProviderModel[]> {
    return this.bundledModels.map((id) => ({ id }));
  }

  private baseUrl(): string {
    return (this.opts.endpoint?.() ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  }
}

function splitSystemMessage(messages: readonly ChatMessage[]): {
  system: string | null;
  messages: ReadonlyArray<{ role: string; content: string }>;
} {
  const systemParts: string[] = [];
  const out: Array<{ role: string; content: string }> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    out.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    });
  }
  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : null,
    messages: out,
  };
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
