import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Sandbox } from '../sandbox';
import type { InlineAgentLogger, ProviderFactory } from '../index';
import type { InlineAgentConfig } from '../configSchema';
import type { InlineAgentRunState } from '../runState';
import { addTokens, incrementIterations } from '../runState';
import { bridgeStream, type BridgeChunk, type InlineAgentLoggerLite } from '../eventBridge';
import { selectMaxIterations, tokenTick } from '../budgets';
import type { ManualChatModelAdapter } from '../manualChatModel';
import type { RewriteMessage } from '../multistep/messageRewriter';
import type { ExternalEvent } from '../../base';
import { createFetchUrlTool, type FetchUrlConfig } from '../tools/fetchUrl';
import { createSearchWebTool, type SearchWebConfig } from '../tools/searchWeb';
import {
  createReadFileTool,
  createWriteFileTool,
  createListDirTool,
  createDeleteFileTool,
} from '../tools/fileOps';
import { createPublishArtifactTool } from '../tools/publishArtifact';
import { wrapToolResultForLLM } from '../tools/untrustedWrap';

export interface InlineToolHandle {
  readonly name: string;
  invoke(args: unknown): Promise<unknown>;
}

export interface SimpleBranchCtx {
  readonly providerFactory: ProviderFactory;
  readonly config: InlineAgentConfig;
  readonly sandbox: Sandbox;
  readonly runState: InlineAgentRunState;
  readonly refinedAsk: string;
  readonly systemPrompt: string;
  readonly signal: AbortSignal;
  readonly logger: InlineAgentLogger;
  readonly searchWebApiKey: string;
  /**
   * Optional: override the inner ReAct loop with a scripted source for tests.
   */
  readonly runReactLoop?: (ctx: ReactLoopCtx) => AsyncIterable<BridgeChunk>;
  readonly chatModel?: BaseChatModel;
  readonly now?: () => number;
}

export interface ReactLoopCtx {
  readonly chatModel: BaseChatModel | null;
  readonly tools: readonly InlineToolHandle[];
  readonly maxIterations: number;
  readonly signal: AbortSignal;
  readonly refinedAsk: string;
  readonly systemPrompt: string;
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
  readonly tokenLimit: number;
}

export function buildSimpleBranchTools(input: {
  readonly config: InlineAgentConfig;
  readonly sandbox: Sandbox;
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
  readonly signal: AbortSignal;
  readonly searchWebApiKey: string;
}): readonly InlineToolHandle[] {
  const { config, sandbox, runState, logger, signal } = input;
  const lite: InlineAgentLoggerLite = logger;
  const tools: InlineToolHandle[] = [];
  if (config.tools.fetchUrl.enabled) {
    const fetchCfg: FetchUrlConfig = {
      enabled: config.tools.fetchUrl.enabled,
      allowlist: config.tools.fetchUrl.allowlist,
      blocklist: config.tools.fetchUrl.blocklist,
      timeoutMs: config.tools.fetchUrl.timeoutMs,
      maxBytes: config.tools.fetchUrl.maxBytes,
    };
    tools.push(createFetchUrlTool({ config: fetchCfg, signal, logger: lite }));
  }
  if (config.tools.searchWeb.enabled) {
    const searchCfg: SearchWebConfig = {
      enabled: config.tools.searchWeb.enabled,
      apiKey: input.searchWebApiKey,
      defaultMaxResults: config.tools.searchWeb.defaultMaxResults,
      defaultSearchDepth: config.tools.searchWeb.defaultSearchDepth,
      defaultTopic: config.tools.searchWeb.defaultTopic,
      includeAnswer: config.tools.searchWeb.includeAnswer,
      timeoutMs: config.tools.searchWeb.timeoutMs,
      maxBytes: config.tools.searchWeb.maxBytes,
    };
    tools.push(createSearchWebTool({ config: searchCfg, signal, logger: lite }));
  }
  if (config.tools.fileOps.enabled) {
    tools.push(createReadFileTool({ sandbox, signal, logger: lite }));
    tools.push(createWriteFileTool({ sandbox, signal, logger: lite }));
    tools.push(createListDirTool({ sandbox, signal, logger: lite }));
    tools.push(createDeleteFileTool({ sandbox, signal, logger: lite }));
  }
  tools.push(
    createPublishArtifactTool({
      config: { maxArtifacts: config.sandbox.maxArtifacts },
      sandbox,
      logger: lite,
      runState,
    }),
  );
  // FR-IA-35: simple branch excludes extract_note.
  return tools;
}

export async function* runSimpleBranch(ctx: SimpleBranchCtx): AsyncIterable<ExternalEvent> {
  const tools = buildSimpleBranchTools({
    config: ctx.config,
    sandbox: ctx.sandbox,
    runState: ctx.runState,
    logger: ctx.logger,
    signal: ctx.signal,
    searchWebApiKey: ctx.searchWebApiKey,
  });

  const chatModel =
    ctx.chatModel ??
    (() => {
      try {
        return ctx.providerFactory(ctx.config.providerId, ctx.config.model, {
          temperature: ctx.config.temperature,
          signal: ctx.signal,
        });
      } catch {
        return null;
      }
    })();

  const maxIterations = selectMaxIterations('simple', ctx.config.budgets);
  const tokenLimit = ctx.config.budgets.maxTokens;
  const loopCtx: ReactLoopCtx = {
    chatModel,
    tools,
    maxIterations,
    signal: ctx.signal,
    refinedAsk: ctx.refinedAsk,
    systemPrompt: ctx.systemPrompt,
    runState: ctx.runState,
    logger: ctx.logger,
    tokenLimit,
  };

  const loop = ctx.runReactLoop ?? defaultReactLoop;

  yield* bridgeStream(loop(loopCtx), { logger: ctx.logger });
}

async function* defaultReactLoop(ctx: ReactLoopCtx): AsyncIterable<BridgeChunk> {
  if (ctx.chatModel === null) {
    yield {
      kind: 'error',
      error: { code: 'invalid_provider', message: 'providerFactory failed to construct ChatModel' },
    };
    return;
  }
  yield* manualReactLoop(ctx);
}

/**
 * Hand-rolled ReAct loop equivalent to `createReactAgent` for the inline
 * agent's narrow tool set. Uses the shared `ManualChatModelAdapter` that the
 * F16 graph adapts from LangChain's `BaseChatModel`; tests pass scripted
 * adapters directly.
 */
async function* manualReactLoop(ctx: ReactLoopCtx): AsyncIterable<BridgeChunk> {
  const adapter = (ctx.chatModel as unknown as { manualAdapter?: ManualChatModelAdapter })
    ?.manualAdapter;
  if (adapter === undefined) {
    yield {
      kind: 'error',
      error: {
        code: 'not_implemented',
        message: 'default ReAct loop requires a manualAdapter on the ChatModel (F16 wires it).',
      },
    };
    return;
  }
  yield* runManualLoop(ctx, adapter);
}

export async function* runManualLoop(
  ctx: ReactLoopCtx,
  adapter: ManualChatModelAdapter,
): AsyncIterable<BridgeChunk> {
  const messages: RewriteMessage[] = [
    { role: 'system', content: ctx.systemPrompt },
    { role: 'user', content: ctx.refinedAsk },
  ];
  const toolNames = ctx.tools.map((t) => t.name);
  let iteration = 0;
  while (iteration < ctx.maxIterations) {
    if (ctx.signal.aborted) return;
    iteration += 1;
    incrementIterations(ctx.runState, 1);
    let step;
    try {
      step = await adapter.invokeTurn({
        messages,
        toolNames,
        signal: ctx.signal,
      });
    } catch (err) {
      yield { kind: 'error', error: err };
      return;
    }
    if (step.text.length > 0) {
      yield { kind: 'text', chunk: step.text };
    }
    const tokenStat = tokenTick({
      cumulativeTokens: ctx.runState.cumulativeTokens,
      addedInputEstimate: 0,
      observedUsage: step.usage,
      maxTokens: ctx.tokenLimit,
    });
    addTokens(ctx.runState, step.usage);
    if (tokenStat.over) {
      yield { kind: 'error', error: { code: 'token_limit', message: 'maxTokens exceeded' } };
      return;
    }
    if (step.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: step.text });
      yield { kind: 'done' };
      return;
    }
    messages.push({ role: 'assistant', content: step.text });
    for (const call of step.toolCalls) {
      const tool = ctx.tools.find((t) => t.name === call.name);
      if (tool === undefined) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ ok: false, error: 'unknown_tool' }),
        });
        continue;
      }
      yield { kind: 'tool_start', tool: call.name, args: call.args };
      const startedAt = Date.now();
      let result: unknown;
      let ok = true;
      let errorCode: string | undefined;
      try {
        result = await tool.invoke(call.args);
        if (typeof result === 'object' && result !== null && 'ok' in result) {
          const r = result as { ok: boolean; error?: string };
          ok = r.ok;
          if (!r.ok && typeof r.error === 'string') errorCode = r.error;
        }
      } catch (err) {
        ok = false;
        errorCode = err instanceof Error ? err.message : 'tool_throw';
        result = { ok: false, error: errorCode };
      }
      yield {
        kind: 'tool_end',
        tool: call.name,
        ok,
        durationMs: Date.now() - startedAt,
        ...(errorCode !== undefined ? { error: errorCode } : {}),
      };
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(wrapToolResultForLLM(call.name, result)),
      });
    }
  }
  yield {
    kind: 'error',
    error: {
      code: 'iteration_limit',
      message: `simple branch exceeded ${ctx.maxIterations} iterations`,
    },
  };
}
