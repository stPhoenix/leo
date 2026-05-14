import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { Runnable } from '@langchain/core/runnables';
import { SystemMessage, type AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import type {
  OpenAITool,
  Provider,
  ProviderChatRequest,
  ProviderModel,
  StreamEvent,
} from './types';
import { ProviderConnectError } from './types';
import { toLangchainMessages } from './langchainMessages';
import { toStreamEvents } from './langchainStream';
import { toRunnableConfig } from './traceConfig';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GoogleProviderOptions {
  readonly apiKey: () => string;
  readonly endpoint?: () => string;
  readonly bundledModels?: readonly string[];
  readonly fetch?: FetchLike;
}

const DEFAULT_MODELS: readonly string[] = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

interface GeminiListModelsResponse {
  readonly models?: ReadonlyArray<{
    readonly name?: unknown;
    readonly supportedGenerationMethods?: readonly unknown[];
  }>;
}

type GoogleCallable = Runnable<BaseMessage[], AIMessageChunk> | ChatGoogleGenerativeAI;

export class GoogleProvider implements Provider {
  readonly id = 'google';
  private readonly bundledModels: readonly string[];
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: GoogleProviderOptions) {
    this.bundledModels = opts.bundledModels ?? DEFAULT_MODELS;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  async *stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const apiKey = this.opts.apiKey();
    if (apiKey.length === 0) throw new ProviderConnectError('missing API key');
    const endpoint = this.opts.endpoint?.();

    const model = new ChatGoogleGenerativeAI({
      model: req.model,
      apiKey,
      streaming: true,
      streamUsage: true,
      ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(endpoint !== undefined && endpoint.length > 0 ? { baseUrl: endpoint } : {}),
    });

    const hasTools = req.tools !== undefined && req.tools.length > 0;
    const callable: GoogleCallable = hasTools ? model.bindTools(toToolDefs(req.tools!)) : model;

    const messages = normalizeForGoogle(toLangchainMessages(req.messages));
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
    const apiKey = this.opts.apiKey();
    if (apiKey.length === 0) return this.bundledModels.map((id) => ({ id }));
    const url = this.buildListModelsUrl();
    const response = await this.fetchListModels(url, apiKey, signal);
    if (!response.ok) throw new ProviderConnectError(`HTTP ${response.status}`);
    const json = (await response.json()) as GeminiListModelsResponse;
    return mapGeminiModels(json.models ?? []);
  }

  private buildListModelsUrl(): string {
    const endpoint = this.opts.endpoint?.();
    const baseUrl =
      endpoint !== undefined && endpoint.length > 0
        ? endpoint.replace(/\/+$/, '') // NOSONAR(typescript:S5852): anchored trailing-slash trim, linear.
        : DEFAULT_BASE_URL;
    return `${baseUrl}/v1beta/models?pageSize=1000`;
  }

  private async fetchListModels(
    url: string,
    apiKey: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...(signal !== undefined ? { signal } : {}),
        headers: { 'x-goog-api-key': apiKey },
      });
    } catch (err) {
      if (signal?.aborted === true) throw abortReason(signal);
      throw asConnectError(err, 'fetch failed');
    }
  }
}

function mapGeminiModels(data: NonNullable<GeminiListModelsResponse['models']>): ProviderModel[] {
  const out: ProviderModel[] = [];
  for (const m of data) {
    if (typeof m.name !== 'string') continue;
    const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
    if (!methods.includes('generateContent')) continue;
    const id = m.name.startsWith('models/') ? m.name.slice('models/'.length) : m.name;
    if (id.length > 0) out.push({ id });
  }
  return out;
}

// Gemini's bindTools requires `{ name, description, schema }` shape — it
// does not accept OpenAI's `{ type: 'function', function: { ... } }` envelope.
function toToolDefs(tools: readonly OpenAITool[]): Array<{
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
}> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    schema: sanitizeSchemaForGemini(t.function.parameters),
  }));
}

// Gemini accepts a restricted subset of OpenAPI 3.0 schema. JSON Schema
// keywords like `exclusiveMinimum` / `additionalProperties` / `$ref` raise
// 400 "Invalid JSON payload received. Unknown name ..." even though most
// Zod-emitted schemas include them. Strip recursively. List sourced from
// Gemini structured-output docs + langchainjs/promptfoo issue trackers.
const GEMINI_DROP_KEYS: ReadonlySet<string> = new Set([
  'exclusiveMinimum',
  'exclusiveMaximum',
  'additionalProperties',
  'patternProperties',
  'propertyNames',
  'const',
  'not',
  '$schema',
  '$ref',
  '$defs',
  'definitions',
  '$id',
  '$comment',
]);

export function sanitizeSchemaForGemini(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((v) => sanitizeSchemaForGemini(v));
  if (input === null || typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (GEMINI_DROP_KEYS.has(k)) continue;
    out[k] = sanitizeSchemaForGemini(v);
  }
  return out;
}

// Gemini's API rejects requests where a system message appears anywhere
// other than the first slot ("System message should be the first one").
// Leo's agent loop emits multiple system reminders mid-conversation, so
// merge them into a single leading SystemMessage before dispatch.
export function normalizeForGoogle(messages: readonly BaseMessage[]): BaseMessage[] {
  const systemTexts: string[] = [];
  const rest: BaseMessage[] = [];
  for (const m of messages) {
    if (m.getType() === 'system') {
      const text = systemMessageText(m);
      if (text.length > 0) systemTexts.push(text);
    } else {
      rest.push(m);
    }
  }
  if (systemTexts.length === 0) return rest;
  return [new SystemMessage({ content: systemTexts.join('\n\n') }), ...rest];
}

function systemMessageText(m: BaseMessage): string {
  const c = m.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  const parts: string[] = [];
  for (const b of c) {
    if (typeof b === 'object' && b !== null && 'type' in b && b.type === 'text') {
      const text = (b as { text?: unknown }).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts.join('');
}

function asConnectError(err: unknown, fallback: string): ProviderConnectError {
  if (err instanceof ProviderConnectError) return err;
  if (err instanceof Error)
    return new ProviderConnectError(err.message.length > 0 ? err.message : fallback, {
      cause: err,
    });
  return new ProviderConnectError(fallback);
}

function abortReason(signal: AbortSignal): Error {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  return new Error('aborted');
}
