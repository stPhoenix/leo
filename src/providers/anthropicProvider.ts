import { ChatAnthropic } from '@langchain/anthropic';
import type { Runnable } from '@langchain/core/runnables';
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages';
import type {
  AnthropicThinkingConfig,
  ChatMessage,
  ChatMessageContent,
  ContentBlock,
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
import { makeAnthropicFetchPatch } from './anthropicFetchPatch';
import { anthropicCountTokens } from './anthropicCountTokens';
import type { FetchLike as ObsidianFetchLike } from '@/platform/obsidianFetch';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AnthropicProviderOptions {
  readonly apiKey: () => string;
  readonly endpoint?: () => string;
  readonly bundledModels?: readonly string[];
  readonly fetch?: ObsidianFetchLike;
}

const DEFAULT_MODELS: readonly string[] = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
];

type AnthropicCallable = Runnable<BaseMessage[], AIMessageChunk> | ChatAnthropic;

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic';
  private readonly bundledModels: readonly string[];

  constructor(private readonly opts: AnthropicProviderOptions) {
    this.bundledModels = opts.bundledModels ?? DEFAULT_MODELS;
  }

  async *stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const apiKey = this.opts.apiKey();
    if (apiKey.length === 0) throw new ProviderConnectError('missing API key');
    const endpoint = this.opts.endpoint?.();

    const betas = req.providerHints?.betas ?? [];
    const hasTools = req.tools !== undefined && req.tools.length > 0;
    const nameMapping = hasTools ? sanitizeToolNames(req.tools!) : null;
    // Defer-loading names must reference the sanitized tool names since that
    // is what the wire body actually carries (Anthropic rejects dots in names).
    const deferLoadingNames = collectDeferLoadingNames(nameMapping?.tools);
    const needsPatch = betas.length > 0 || deferLoadingNames.size > 0;
    const fetchPatched = needsPatch
      ? makeAnthropicFetchPatch({
          betas,
          deferLoading: deferLoadingNames,
        })
      : undefined;

    const thinkingParam = toAnthropicThinkingParam(req.providerHints?.thinking);
    const thinkingActive = thinkingParam !== undefined;
    // Anthropic rejects budget_tokens >= max_tokens. Bump max so the model
    // has room for an answer beyond reasoning.
    const requestedMax = req.maxTokens ?? 1024;
    const minMaxForThinking =
      thinkingParam !== undefined && thinkingParam.type === 'enabled'
        ? thinkingParam.budget_tokens + 1024
        : 0;
    const maxTokens = Math.max(requestedMax, minMaxForThinking);
    // Extended thinking requires temperature=1; top_p/top_k must be unset.
    const temperature = thinkingActive ? 1 : req.temperature;

    const model: ChatAnthropic = new ChatAnthropic({
      model: req.model,
      apiKey,
      maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(thinkingParam !== undefined ? { thinking: thinkingParam } : {}),
      streaming: true,
      streamUsage: true,
      clientOptions: {
        dangerouslyAllowBrowser: true,
        ...(endpoint !== undefined && endpoint.length > 0 ? { baseURL: endpoint } : {}),
        ...(fetchPatched !== undefined ? { fetch: fetchPatched } : {}),
      },
    });

    const disableParallel = req.providerHints?.disableParallelToolCalls === true;
    const bindOpts = buildAnthropicBindOpts(disableParallel);
    const callable: AnthropicCallable = hasTools
      ? model.bindTools(toToolDefs(nameMapping!.tools), bindOpts)
      : model;

    const messages = toLangchainMessages(mergeSystemMessages(req.messages));
    let stream: AsyncIterable<AIMessageChunk>;
    try {
      stream = await callable.stream(messages, { signal, ...toRunnableConfig(req.trace) });
    } catch (err) {
      if (signal.aborted) throw abortReason(signal);
      throw asConnectError(err, 'stream failed');
    }
    const streamOpts =
      nameMapping !== null && nameMapping.reverseMap.size > 0
        ? { toolNameMap: nameMapping.reverseMap }
        : {};
    yield* toStreamEvents(stream, streamOpts);
  }

  async listModels(_signal?: AbortSignal): Promise<ProviderModel[]> {
    return this.bundledModels.map((id) => ({ id }));
  }

  async countTokens(req: ProviderChatRequest, signal?: AbortSignal): Promise<number> {
    const fetchImpl = this.opts.fetch;
    if (fetchImpl === undefined) {
      throw new ProviderConnectError('countTokens requires fetch adapter');
    }
    const apiKey = this.opts.apiKey();
    if (apiKey.length === 0) throw new ProviderConnectError('missing API key');
    const endpoint = this.opts.endpoint?.();
    return anthropicCountTokens(req, {
      apiKey,
      ...(endpoint !== undefined && endpoint.length > 0 ? { endpoint } : {}),
      fetchImpl,
      ...(signal !== undefined ? { signal } : {}),
    });
  }
}

// Anthropic API rejects mid-conversation system messages
// ("System messages are only permitted as the first passed message").
// Concatenate all role:'system' content into a single leading system message,
// matching Anthropic's documented OpenAI-compat behavior (newline-joined).
export function mergeSystemMessages(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  const systemParts: string[] = [];
  const rest: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const text = systemContentToString(m.content);
      if (text.length > 0) systemParts.push(text);
      continue;
    }
    rest.push(m);
  }
  if (systemParts.length === 0) return rest;
  const merged: ChatMessage = { role: 'system', content: systemParts.join('\n\n') };
  return [merged, ...rest];
}

function systemContentToString(content: ChatMessageContent): string {
  if (typeof content === 'string') return content;
  const out: string[] = [];
  for (const b of content as readonly ContentBlock[]) {
    if (b.type === 'text') out.push(b.text);
    else if (b.type === 'thinking') out.push(b.thinking);
  }
  return out.join('');
}

// Anthropic tool names must match `^[a-zA-Z0-9_-]{1,128}$`. MCP tools are
// namespaced as `mcp.<server>.<name>` — dots get rejected. Replace any
// disallowed char with `_` and keep a reverse map so streamed tool_use blocks
// can be restored to their original IDs (the registry still uses the dots).
export interface SanitizedToolMapping {
  readonly tools: readonly OpenAITool[];
  readonly reverseMap: ReadonlyMap<string, string>;
}

const ANTHROPIC_NAME_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function sanitizeToolNames(tools: readonly OpenAITool[]): SanitizedToolMapping {
  const reverseMap = new Map<string, string>();
  const out: OpenAITool[] = [];
  for (const t of tools) {
    const original = t.function.name;
    if (ANTHROPIC_NAME_RE.test(original)) {
      out.push(t);
      continue;
    }
    let sanitized = original.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    if (sanitized.length === 0) sanitized = '_';
    // On collision, suffix with a counter until unique.
    let candidate = sanitized;
    let n = 2;
    while (reverseMap.has(candidate) || out.some((o) => o.function.name === candidate)) {
      const suffix = `_${n}`;
      candidate = sanitized.slice(0, 128 - suffix.length) + suffix;
      n += 1;
    }
    reverseMap.set(candidate, original);
    out.push({
      ...t,
      function: { ...t.function, name: candidate },
    });
  }
  return { tools: out, reverseMap };
}

interface OpenAIToolLike {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  };
  readonly defer_loading?: boolean;
}

// ChatAnthropicCallOptions narrows tool_choice.type to 'tool', but the
// Anthropic API also accepts {type:'auto', disable_parallel_tool_use:true}.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAnthropicBindOpts(disableParallel: boolean): any {
  if (!disableParallel) return undefined;
  return { tool_choice: { type: 'auto', disable_parallel_tool_use: true } };
}

function toToolDefs(tools: readonly OpenAIToolLike[]): Array<{
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
  defer_loading?: boolean;
}> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    schema: t.function.parameters,
    ...(t.defer_loading === true ? { defer_loading: true } : {}),
  }));
}

type AnthropicThinkingParam =
  | { readonly type: 'disabled' }
  | { readonly type: 'enabled'; readonly budget_tokens: number }
  | { readonly type: 'adaptive' };

const MIN_THINKING_BUDGET = 1024;

export function toAnthropicThinkingParam(
  cfg: AnthropicThinkingConfig | undefined,
): AnthropicThinkingParam | undefined {
  if (cfg === undefined) return undefined;
  if (cfg.type === 'disabled') return undefined;
  if (cfg.type === 'adaptive') return { type: 'adaptive' };
  const budget = Math.max(MIN_THINKING_BUDGET, Math.floor(cfg.budgetTokens));
  return { type: 'enabled', budget_tokens: budget };
}

function collectDeferLoadingNames(tools: readonly OpenAITool[] | undefined): ReadonlySet<string> {
  if (tools === undefined) return new Set<string>();
  const out = new Set<string>();
  for (const t of tools) if (t.defer_loading === true) out.add(t.function.name);
  return out;
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
