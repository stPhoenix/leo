import type { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  ExternalAgentAdapter,
  type AdapterCapabilities,
  type ExternalAgentInput,
  type ExternalEvent,
} from '../base';
import { inlineAgentConfigSchema, type InlineAgentConfig } from './configSchema';
import { getInlineAgentSystemPrompt } from './systemPrompt';
import { Sandbox } from './sandbox';

export { inlineAgentConfigSchema, getInlineAgentSystemPrompt, Sandbox };
export type { InlineAgentConfig };
export type { ManualChatModelAdapter, AssistantStep } from './manualChatModel';
export type { RewriteMessage } from './multistep/messageRewriter';

export interface InlineAgentLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface ProviderFactoryOpts {
  readonly temperature?: number;
  readonly signal?: AbortSignal;
}

export type ProviderFactory = (
  providerId: string,
  model: string,
  opts?: ProviderFactoryOpts,
) => BaseChatModel;

import type { ManualChatModelAdapter as InlineAgentManualChatModelAdapter } from './manualChatModel';

export interface InlineAgentAdapterDeps {
  readonly providerFactory: ProviderFactory;
  readonly logger: InlineAgentLogger;
  readonly knownProviderIds?: () => readonly string[];
  readonly chatModelAdapter?: (model: BaseChatModel) => InlineAgentManualChatModelAdapter;
  readonly resolveSearchWebApiKey?: (config: InlineAgentConfig) => string;
}

const DEFAULT_KNOWN_PROVIDERS: readonly string[] = [
  'lmstudio',
  'openai',
  'anthropic',
  'ollama',
  'custom',
];

export interface ResolvedSystemPromptInput {
  readonly hostPrompt: string;
  readonly override: string | null;
}

export function resolveSystemPrompt(input: ResolvedSystemPromptInput): string {
  const inline =
    input.override !== null && input.override.length > 0
      ? input.override
      : getInlineAgentSystemPrompt();
  if (input.hostPrompt.length === 0) return inline;
  return `${input.hostPrompt}\n\n${inline}`;
}

export class InlineAgentAdapter extends ExternalAgentAdapter {
  readonly id = 'inline-agent';
  readonly label = 'Inline Agent';
  readonly defaultTimeoutMs = 300_000;
  readonly capabilities: AdapterCapabilities = { files: true, stream: true };
  readonly configSchema: z.ZodType = inlineAgentConfigSchema;

  private readonly providerFactory: ProviderFactory;
  private readonly logger: InlineAgentLogger;
  private readonly knownProviderIds: () => readonly string[];
  private readonly chatModelAdapter:
    | ((model: BaseChatModel) => InlineAgentManualChatModelAdapter)
    | undefined;
  private readonly resolveSearchWebApiKey: ((config: InlineAgentConfig) => string) | undefined;

  constructor(deps: InlineAgentAdapterDeps) {
    super();
    this.providerFactory = deps.providerFactory;
    this.logger = deps.logger;
    this.knownProviderIds =
      deps.knownProviderIds ?? ((): readonly string[] => DEFAULT_KNOWN_PROVIDERS);
    this.chatModelAdapter = deps.chatModelAdapter;
    this.resolveSearchWebApiKey = deps.resolveSearchWebApiKey;
    Sandbox.sweepOrphans({ logger: this.logger }).catch((err) => {
      this.logger.warn('externalAgent.adapter.inlineAgent.sandbox.sweep-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async *start(input: ExternalAgentInput): AsyncIterable<ExternalEvent> {
    // Provider whitelist gate runs before the graph so the error code matches
    // the F02 contract regardless of LangChain availability.
    let parsed: InlineAgentConfig;
    try {
      parsed = inlineAgentConfigSchema.parse(input.config ?? {});
    } catch (err) {
      this.logger.warn('externalAgent.adapter.inlineAgent.config-invalid', {
        error: err instanceof Error ? err.message : String(err),
      });
      yield {
        type: 'error',
        error: {
          code: 'invalid_config',
          message: err instanceof Error ? err.message : 'invalid inline-agent config',
        },
      };
      return;
    }

    const known = this.knownProviderIds();
    if (!known.includes(parsed.providerId)) {
      yield {
        type: 'error',
        error: {
          code: 'invalid_provider',
          message: `unknown providerId '${parsed.providerId}' (expected one of: ${known.join(', ')})`,
        },
      };
      return;
    }

    const { runInlineAgentGraph } = await import('./graph');
    const runId = input.runId ?? `local-${Date.now()}`;
    yield* runInlineAgentGraph(
      {
        providerFactory: this.providerFactory,
        logger: this.logger,
        ...(this.chatModelAdapter !== undefined ? { chatModelAdapter: this.chatModelAdapter } : {}),
        ...(this.resolveSearchWebApiKey !== undefined
          ? { resolveSearchWebApiKey: this.resolveSearchWebApiKey }
          : {}),
      },
      {
        refinedAsk: input.refinedAsk,
        systemPrompt: input.systemPrompt,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        config: input.config,
        runId,
      },
    );
  }
}
