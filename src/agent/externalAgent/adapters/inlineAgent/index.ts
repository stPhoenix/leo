import type { z } from 'zod';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  ExternalAgentAdapter,
  type AdapterCapabilities,
  type ExternalAgentInput,
  type ExternalEvent,
} from '../base';
import { inlineAgentConfigSchema, type InlineAgentConfig } from './configSchema';
import { getInlineAgentSystemPrompt } from '@/prompts/agent/externalAgent/adapters/inlineAgent/systemPrompt';
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

export interface InvokeTraceConfig {
  readonly callbacks?: readonly BaseCallbackHandler[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly tags?: readonly string[];
}

export interface InlineTurnHandle {
  readonly traceConfig: InvokeTraceConfig;
  end(): Promise<void>;
}

export type BeginInlineTurn = (input: {
  readonly sessionId: string;
  readonly runId: string;
}) => InlineTurnHandle | null;

export interface InlineAgentAdapterDeps {
  readonly providerFactory: ProviderFactory;
  readonly logger: InlineAgentLogger;
  readonly knownProviderIds?: () => readonly string[];
  readonly chatModelAdapter?: (
    model: BaseChatModel,
    traceConfig?: InvokeTraceConfig,
  ) => InlineAgentManualChatModelAdapter;
  readonly resolveSearchWebApiKey?: (config: InlineAgentConfig) => string;
  readonly beginTurn?: BeginInlineTurn;
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
    | ((model: BaseChatModel, traceConfig?: InvokeTraceConfig) => InlineAgentManualChatModelAdapter)
    | undefined;
  private readonly resolveSearchWebApiKey: ((config: InlineAgentConfig) => string) | undefined;
  private readonly beginTurn: BeginInlineTurn | undefined;
  private orphanSweepStarted = false;

  constructor(deps: InlineAgentAdapterDeps) {
    super();
    this.providerFactory = deps.providerFactory;
    this.logger = deps.logger;
    this.knownProviderIds =
      deps.knownProviderIds ?? ((): readonly string[] => DEFAULT_KNOWN_PROVIDERS);
    this.chatModelAdapter = deps.chatModelAdapter;
    this.resolveSearchWebApiKey = deps.resolveSearchWebApiKey;
    this.beginTurn = deps.beginTurn;
  }

  async *start(input: ExternalAgentInput): AsyncIterable<ExternalEvent> {
    this.ensureOrphanSweep();
    const validated = this.validateStartConfig(input);
    if (validated.kind === 'error') {
      yield validated.event;
      return;
    }

    const { runInlineAgentGraph } = await import('./graph');
    const runId = input.runId ?? `local-${Date.now()}`;
    const turnHandle =
      this.beginTurn !== undefined && input.threadId !== undefined
        ? this.beginTurn({ sessionId: input.threadId, runId })
        : null;
    const traceConfig = turnHandle?.traceConfig;
    try {
      yield* runInlineAgentGraph(this.buildGraphDeps(traceConfig), {
        refinedAsk: input.refinedAsk,
        systemPrompt: input.systemPrompt,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        config: input.config,
        runId,
      });
    } finally {
      await this.endTurn(turnHandle);
    }
  }

  private ensureOrphanSweep(): void {
    if (this.orphanSweepStarted) return;
    this.orphanSweepStarted = true;
    Sandbox.sweepOrphans({ logger: this.logger }).catch((err) => {
      this.logger.warn('externalAgent.adapter.inlineAgent.sandbox.sweep-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private validateStartConfig(
    input: ExternalAgentInput,
  ): { kind: 'ok'; parsed: InlineAgentConfig } | { kind: 'error'; event: ExternalEvent } {
    let parsed: InlineAgentConfig;
    try {
      parsed = inlineAgentConfigSchema.parse(input.config ?? {});
    } catch (err) {
      this.logger.warn('externalAgent.adapter.inlineAgent.config-invalid', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        kind: 'error',
        event: {
          type: 'error',
          error: {
            code: 'invalid_config',
            message: err instanceof Error ? err.message : 'invalid inline-agent config',
          },
        },
      };
    }
    const known = this.knownProviderIds();
    if (!known.includes(parsed.providerId)) {
      return {
        kind: 'error',
        event: {
          type: 'error',
          error: {
            code: 'invalid_provider',
            message: `unknown providerId '${parsed.providerId}' (expected one of: ${known.join(', ')})`,
          },
        },
      };
    }
    return { kind: 'ok', parsed };
  }

  private buildGraphDeps(traceConfig: InvokeTraceConfig | undefined) {
    return {
      providerFactory: this.providerFactory,
      logger: this.logger,
      ...(this.chatModelAdapter !== undefined ? { chatModelAdapter: this.chatModelAdapter } : {}),
      ...(this.resolveSearchWebApiKey !== undefined
        ? { resolveSearchWebApiKey: this.resolveSearchWebApiKey }
        : {}),
      ...(traceConfig !== undefined ? { traceConfig } : {}),
    };
  }

  private async endTurn(turnHandle: InlineTurnHandle | null): Promise<void> {
    if (turnHandle === null) return;
    try {
      await turnHandle.end();
    } catch (err) {
      this.logger.warn('externalAgent.adapter.inlineAgent.trace.end-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
