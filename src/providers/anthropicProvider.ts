import { ChatAnthropic } from '@langchain/anthropic';
import type { Runnable } from '@langchain/core/runnables';
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages';
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
import { makeAnthropicFetchPatch } from './anthropicFetchPatch';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AnthropicProviderOptions {
  readonly apiKey: () => string;
  readonly endpoint?: () => string;
  readonly bundledModels?: readonly string[];
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
    const deferLoadingNames = collectDeferLoadingNames(req.tools);
    const needsPatch = betas.length > 0 || deferLoadingNames.size > 0;
    const fetchPatched = needsPatch
      ? makeAnthropicFetchPatch({
          betas,
          deferLoading: deferLoadingNames,
        })
      : undefined;

    const model: ChatAnthropic = new ChatAnthropic({
      model: req.model,
      apiKey,
      maxTokens: req.maxTokens ?? 1024,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      streaming: true,
      streamUsage: true,
      clientOptions: {
        dangerouslyAllowBrowser: true,
        ...(endpoint !== undefined && endpoint.length > 0 ? { baseURL: endpoint } : {}),
        ...(fetchPatched !== undefined ? { fetch: fetchPatched } : {}),
      },
    });

    const disableParallel = req.providerHints?.disableParallelToolCalls === true;
    const callable: AnthropicCallable =
      req.tools !== undefined && req.tools.length > 0
        ? model.bindTools(
            toToolDefs(req.tools),
            disableParallel
              ? // ChatAnthropicCallOptions narrows tool_choice.type to 'tool', but the
                // Anthropic API also accepts {type:'auto', disable_parallel_tool_use:true}.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ({ tool_choice: { type: 'auto', disable_parallel_tool_use: true } } as any)
              : undefined,
          )
        : model;

    const messages = toLangchainMessages(req.messages);
    let stream: AsyncIterable<AIMessageChunk>;
    try {
      stream = await callable.stream(messages, { signal, ...toRunnableConfig(req.trace) });
    } catch (err) {
      if (signal.aborted) throw abortReason(signal);
      throw asConnectError(err, 'stream failed');
    }
    yield* toStreamEvents(stream);
  }

  async listModels(_signal?: AbortSignal): Promise<ProviderModel[]> {
    return this.bundledModels.map((id) => ({ id }));
  }
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
