import type { Sandbox } from '../sandbox';
import type { InlineAgentLogger, ProviderFactory } from '../index';
import type { InlineAgentConfig } from '../configSchema';
import {
  addTokens,
  incrementIterations,
  type InlineAgentRunState,
  type NoteRecord,
} from '../runState';
import { bridgeStream, type BridgeChunk } from '../eventBridge';
import { tokenTick, SYNTHESIZE_RESERVE_DEFAULT } from '../budgets';
import type { ExternalEvent } from '../../base';
import { createPublishArtifactTool } from '../tools/publishArtifact';
import type { InlineToolHandle } from '../branches/simpleBranch';
import type { RewriteMessage } from './messageRewriter';
import type { AssistantStep, ManualChatModelAdapter } from '../manualChatModel';
export type { AssistantStep, ManualChatModelAdapter } from '../manualChatModel';

export interface SynthesizeCtx {
  readonly providerFactory: ProviderFactory;
  readonly config: InlineAgentConfig;
  readonly sandbox: Sandbox;
  readonly runState: InlineAgentRunState;
  readonly signal: AbortSignal;
  readonly logger: InlineAgentLogger;
  readonly refinedAsk: string;
  readonly tokenLimit: number;
  readonly remainingIterations: number;
  readonly runReactLoop?: (input: SynthesizeLoopInput) => AsyncIterable<BridgeChunk>;
  readonly now?: () => number;
}

export interface SynthesizeLoopInput {
  readonly tools: readonly InlineToolHandle[];
  readonly maxIterations: number;
  readonly signal: AbortSignal;
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
  readonly tokenLimit: number;
  readonly messages: readonly RewriteMessage[];
}

export function buildSynthesizeTools(input: {
  readonly config: InlineAgentConfig;
  readonly sandbox: Sandbox;
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
}): readonly InlineToolHandle[] {
  const { config, sandbox, runState, logger } = input;
  return [
    createPublishArtifactTool({
      config: { maxArtifacts: config.sandbox.maxArtifacts },
      sandbox,
      logger,
      runState,
    }),
  ];
}

export function buildSynthesizePrompt(input: {
  readonly refinedAsk: string;
  readonly plan: readonly string[];
  readonly notes: readonly NoteRecord[];
  readonly scratchpad: string;
}): string {
  const { refinedAsk, plan, notes, scratchpad } = input;
  const planLines =
    plan.length > 0 ? plan.map((step, i) => `${i + 1}. ${step}`).join('\n') : '(no plan recorded)';
  const noteLines =
    notes.length > 0
      ? notes
          .map(
            (n) =>
              `(${n.id}) [${n.title}] — ${n.summary}${
                n.sourceUrl !== undefined ? ` (source: ${n.sourceUrl})` : ''
              } (relevance: ${n.relevance.toFixed(2)})`,
          )
          .join('\n')
      : '(no notes recorded)';
  return [
    'Refined ask:',
    refinedAsk,
    '',
    'Plan:',
    planLines,
    '',
    'Notes (only state surviving across steps):',
    noteLines,
    '',
    'Scratchpad:',
    scratchpad.length > 0 ? scratchpad : '(empty)',
    '',
    'Synthesize the final answer for the user. You may call publish_artifact to nominate sandbox files for publication. Terminate by emitting a final assistant message with no tool calls.',
  ].join('\n');
}

export function selectSynthesizeIterations(remainingIterations: number): number {
  return Math.max(SYNTHESIZE_RESERVE_DEFAULT, remainingIterations);
}

export async function* runManualSynthesizeLoop(
  ctx: SynthesizeLoopInput,
  adapter: ManualChatModelAdapter,
): AsyncIterable<BridgeChunk> {
  const messages: RewriteMessage[] = [...ctx.messages];
  for (let iteration = 0; iteration < ctx.maxIterations; iteration += 1) {
    if (ctx.signal.aborted) return;
    const outcome = yield* runSynthesizeIteration(ctx, adapter, messages);
    if (outcome === 'terminate') return;
  }
  yield { kind: 'node_complete', node: 'synthesize', durationMs: 0 };
  yield {
    kind: 'error',
    error: {
      code: 'iteration_limit',
      message: `synthesize exceeded ${ctx.maxIterations} iterations`,
    },
  };
}

async function* runSynthesizeIteration(
  ctx: SynthesizeLoopInput,
  adapter: ManualChatModelAdapter,
  messages: RewriteMessage[],
): AsyncGenerator<BridgeChunk, 'continue' | 'terminate'> {
  incrementIterations(ctx.runState, 1);
  let step: AssistantStep;
  try {
    step = await adapter.invokeTurn({
      messages,
      toolNames: ctx.tools.map((t) => t.name),
      signal: ctx.signal,
    });
  } catch (err) {
    yield { kind: 'error', error: err };
    return 'terminate';
  }
  const tokenStat = tokenTick({
    cumulativeTokens: ctx.runState.cumulativeTokens,
    addedInputEstimate: 0,
    observedUsage: step.usage,
    maxTokens: ctx.tokenLimit,
  });
  addTokens(ctx.runState, step.usage);
  if (tokenStat.over) {
    yield {
      kind: 'error',
      error: {
        code: 'token_limit',
        message: `Inline agent token budget exhausted (synthesize): cumulative ${ctx.runState.cumulativeTokens} > maxTokens ${ctx.tokenLimit}. Increase \`budgets.maxTokens\` in plugin settings (default 100000).`,
      },
    };
    return 'terminate';
  }
  if (step.text.length > 0) yield { kind: 'text', chunk: step.text };
  if (step.toolCalls.length === 0) {
    messages.push({ role: 'assistant', content: step.text });
    yield { kind: 'node_complete', node: 'synthesize', durationMs: 0 };
    yield { kind: 'done' };
    return 'terminate';
  }
  messages.push({ role: 'assistant', content: step.text });
  for (const call of step.toolCalls) {
    yield* invokeSynthesizeToolCall(call, ctx, messages);
  }
  return 'continue';
}

async function* invokeSynthesizeToolCall(
  call: { id: string; name: string; args: unknown },
  ctx: SynthesizeLoopInput,
  messages: RewriteMessage[],
): AsyncGenerator<BridgeChunk, void> {
  const tool = ctx.tools.find((t) => t.name === call.name);
  if (tool === undefined) {
    messages.push({
      role: 'tool',
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({ ok: false, error: 'unknown_tool' }),
    });
    return;
  }
  yield { kind: 'tool_start', tool: call.name, args: call.args };
  const { result, ok, errorCode, durationMs } = await invokeSynthesizeTool(tool, call.args);
  yield {
    kind: 'tool_end',
    tool: call.name,
    ok,
    durationMs,
    ...(errorCode !== undefined ? { error: errorCode } : {}),
  };
  messages.push({
    role: 'tool',
    toolCallId: call.id,
    name: call.name,
    content: JSON.stringify(result),
  });
}

async function invokeSynthesizeTool(
  tool: { invoke(args: unknown): Promise<unknown> | unknown },
  args: unknown,
): Promise<{ result: unknown; ok: boolean; errorCode: string | undefined; durationMs: number }> {
  const startedAt = Date.now();
  let result: unknown;
  let ok = true;
  let errorCode: string | undefined;
  try {
    result = await tool.invoke(args);
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
  return { result, ok, errorCode, durationMs: Date.now() - startedAt };
}

export async function* runSynthesize(ctx: SynthesizeCtx): AsyncIterable<ExternalEvent> {
  const tools = buildSynthesizeTools({
    config: ctx.config,
    sandbox: ctx.sandbox,
    runState: ctx.runState,
    logger: ctx.logger,
  });
  const prompt = buildSynthesizePrompt({
    refinedAsk: ctx.refinedAsk,
    plan: ctx.runState.plan ?? [],
    notes: ctx.runState.notes,
    scratchpad: ctx.runState.scratchpad,
  });
  const messages: readonly RewriteMessage[] = [
    {
      role: 'system',
      content:
        'You are the inline-agent synthesizer. Use only the notes; do not call any tool other than publish_artifact.',
    },
    { role: 'user', content: prompt },
  ];
  const maxIterations = selectSynthesizeIterations(ctx.remainingIterations);
  const loopInput: SynthesizeLoopInput = {
    tools,
    maxIterations,
    signal: ctx.signal,
    runState: ctx.runState,
    logger: ctx.logger,
    tokenLimit: ctx.tokenLimit,
    messages,
  };
  if (ctx.runReactLoop !== undefined) {
    yield* bridgeStream(ctx.runReactLoop(loopInput), { logger: ctx.logger });
    return;
  }
  yield* bridgeStream(
    (async function* (): AsyncIterable<BridgeChunk> {
      yield {
        kind: 'error',
        error: {
          code: 'not_implemented',
          message: 'synthesize default loop requires F16 manualAdapter wiring',
        },
      };
    })(),
    { logger: ctx.logger },
  );
}
