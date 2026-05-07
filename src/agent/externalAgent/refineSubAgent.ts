import type { Logger } from '@/platform/Logger';
import type {
  ChatMessage,
  OpenAITool,
  ProviderChatRequest,
  ProviderTraceContext,
  StreamEvent,
} from '@/providers/types';
import type { RefineDecision, RefineDeps } from './subgraph';
import type { RefineMessage } from './state';
import { getRefineSystemPrompt } from './refinePrompt';

const REFINE_TOOLS: readonly OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'ask_clarifying_question',
      description:
        'Ask the user a single, specific clarifying question before producing the final prompt. The user replies in the chat widget and the refine loop resumes.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user. Keep it short and specific.',
          },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'emit_final_prompt',
      description:
        'Emit the final, self-contained prompt to send verbatim to the external agent. Inline any required content; never reference vault paths.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The final prompt the external agent will answer. Self-contained.',
          },
        },
        required: ['prompt'],
      },
    },
  },
];

export interface RefineProvider {
  stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface RefineSubAgentOptions {
  readonly provider: RefineProvider;
  readonly model: () => string;
  readonly temperature?: () => number;
  readonly logger?: Logger;
  readonly systemPromptOverride?: () => string;
  readonly finalPromptSoftLimitChars?: number;
  readonly finalPromptHardLimitChars?: number;
  readonly maxTokens?: () => number;
}

const DEFAULT_SOFT_LIMIT = 4_096;
const DEFAULT_HARD_LIMIT = 16_384;
// Bound refine reasoning so chat-of-thought models (qwen3, deepseek) cannot
// loop forever before emitting a tool call. 32k accommodates models that
// produce a long reasoning trace before emitting the final tool call.
const DEFAULT_MAX_TOKENS = 32_768;

export function createRefineSubAgent(opts: RefineSubAgentOptions): RefineDeps {
  const logger = opts.logger;
  const systemPrompt = opts.systemPromptOverride ?? getRefineSystemPrompt;
  const softLimit = opts.finalPromptSoftLimitChars ?? DEFAULT_SOFT_LIMIT;
  const hardLimit = opts.finalPromptHardLimitChars ?? DEFAULT_HARD_LIMIT;

  // Stream-event tool-call parser. Not replaced by LangChain's
  // `ChatModel.bindTools(...).invoke(...).tool_calls` because that path
  // bypasses Leo's `ProviderManager` abstraction (uniform OpenAI-compat +
  // Anthropic + LM Studio wiring with shared connection-state tracking,
  // retry policy, FIFO queue, telemetry). The parser handles both
  // OpenAI-style (`tool_call` events) and Anthropic-style streams
  // (`block_start[tool_use]` → `block_delta[input_json_delta]` → `block_stop`)
  // because `ProviderManager.stream()` normalises across providers but
  // surfaces the provider-native event shape verbatim.
  const collectStream = async (
    stream: AsyncIterable<RefineStreamEvent>,
    signal: AbortSignal,
  ): Promise<{ textBuffer: string; toolCalls: Array<{ name: string; argsJson: string }> }> => {
    let textBuffer = '';
    const toolCalls: Array<{ name: string; argsJson: string }> = [];
    const toolBufs = new Map<number, { id: string; name: string; args: string }>();
    for await (const event of stream) {
      if (signal.aborted) break;
      const outcome = applyRefineEvent(event, toolBufs, toolCalls);
      if (outcome === 'text')
        textBuffer +=
          (event as { text?: string; delta?: { text?: string } }).text ??
          (event as { delta: { text: string } }).delta.text;
      else if (outcome === 'break') break;
      else if (outcome === 'throw') throw (event as { error: Error }).error;
    }
    return { textBuffer, toolCalls };
  };

  return {
    async refine({ state, signal, traceConfig }) {
      // refineHistory already carries the user message; userInput is informational only.
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: state.originalAsk },
        ...state.refineHistory.map((m) => toChatMessage(m)),
      ];

      const req: ProviderChatRequest = {
        model: opts.model(),
        messages,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature() } : {}),
        maxTokens: opts.maxTokens !== undefined ? opts.maxTokens() : DEFAULT_MAX_TOKENS,
        tools: REFINE_TOOLS,
        ...(traceConfig !== undefined ? { trace: buildTraceContext(traceConfig) } : {}),
      };

      let collected: { textBuffer: string; toolCalls: Array<{ name: string; argsJson: string }> };
      try {
        collected = await collectStream(
          opts.provider.stream(req, signal) as AsyncIterable<RefineStreamEvent>,
          signal,
        );
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      const { textBuffer, toolCalls } = collected;

      const assistantMessage: RefineMessage | undefined =
        textBuffer.length > 0 ? { role: 'assistant', content: textBuffer } : undefined;

      assertNoForeignToolCall(toolCalls);
      const finalCall = toolCalls.find((c) => c.name === 'emit_final_prompt');
      const askCall = toolCalls.find((c) => c.name === 'ask_clarifying_question');

      if (finalCall !== undefined) {
        return finalizePromptDecision({
          finalCall,
          askCall,
          textBuffer,
          state,
          assistantMessage,
          softLimit,
          hardLimit,
          logger,
        });
      }
      if (askCall !== undefined) {
        const question = pickStringField(askCall.argsJson, 'question') ?? textBuffer.trim();
        return {
          type: 'clarify',
          text: question,
          ...(assistantMessage !== undefined ? { assistantMessage } : {}),
        };
      }
      return passthroughDecision({ textBuffer, state, assistantMessage, logger });
    },
  };
}

type RefineStreamEvent =
  | { readonly type: 'token'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: { name: string; argsJson: string } }
  | {
      readonly type: 'block_start';
      readonly index: number;
      readonly block: { type: 'tool_use'; id: string; name: string } | { type: string };
    }
  | {
      readonly type: 'block_delta';
      readonly index: number;
      readonly delta:
        | { readonly type: 'text_delta'; readonly text: string }
        | { readonly type: 'input_json_delta'; readonly partial_json: string }
        | { readonly type: string };
    }
  | { readonly type: 'block_stop'; readonly index: number }
  | { readonly type: 'error'; readonly error: Error }
  | { readonly type: 'done' };

function applyRefineEvent(
  event: RefineStreamEvent,
  toolBufs: Map<number, { id: string; name: string; args: string }>,
  toolCalls: Array<{ name: string; argsJson: string }>,
): 'text' | 'continue' | 'break' | 'throw' {
  if (event.type === 'token') return 'text';
  if (event.type === 'tool_call') {
    toolCalls.push({ name: event.call.name, argsJson: event.call.argsJson });
    return 'continue';
  }
  if (event.type === 'block_start') {
    if (event.block.type === 'tool_use') {
      const block = event.block as { id: string; name: string };
      toolBufs.set(event.index, { id: block.id, name: block.name, args: '' });
    }
    return 'continue';
  }
  if (event.type === 'block_delta') {
    if (event.delta.type === 'text_delta') return 'text';
    if (event.delta.type === 'input_json_delta') {
      const buf = toolBufs.get(event.index);
      if (buf !== undefined) buf.args += (event.delta as { partial_json: string }).partial_json;
    }
    return 'continue';
  }
  if (event.type === 'block_stop') {
    const buf = toolBufs.get(event.index);
    if (buf !== undefined) {
      toolCalls.push({ name: buf.name, argsJson: buf.args.length === 0 ? '{}' : buf.args });
      toolBufs.delete(event.index);
    }
    return 'continue';
  }
  if (event.type === 'error') return 'throw';
  if (event.type === 'done') return 'break';
  return 'continue';
}

function assertNoForeignToolCall(toolCalls: ReadonlyArray<{ name: string }>): void {
  const otherCall = toolCalls.find(
    (c) => c.name !== 'emit_final_prompt' && c.name !== 'ask_clarifying_question',
  );
  if (otherCall === undefined) return;
  const err = new Error(
    `refine_invalid_tool: refine sub-agent attempted to call ${otherCall.name}`,
  );
  (err as Error & { code?: string }).code = 'refine_invalid_tool';
  throw err;
}

interface FinalizeArgs {
  readonly finalCall: { argsJson: string };
  readonly askCall: { argsJson: string } | undefined;
  readonly textBuffer: string;
  readonly state: { runId: string };
  readonly assistantMessage: RefineMessage | undefined;
  readonly softLimit: number;
  readonly hardLimit: number;
  readonly logger: { warn(event: string, fields: Record<string, unknown>): void } | undefined;
}

function finalizePromptDecision(args: FinalizeArgs): RefineDecision {
  const { finalCall, askCall, textBuffer, state, assistantMessage, softLimit, hardLimit, logger } =
    args;
  if (askCall !== undefined) {
    logger?.warn('externalAgent.refine.dual-tool-call', {
      runId: state.runId,
      preferred: 'emit_final_prompt',
    });
  }
  const promptText = pickStringField(finalCall.argsJson, 'prompt') ?? textBuffer.trim();
  if (promptText.length > hardLimit) {
    const err = new Error(
      `refine_prompt_too_large: ${promptText.length} chars (hard limit ${hardLimit})`,
    );
    (err as Error & { code?: string }).code = 'refine_prompt_too_large';
    throw err;
  }
  if (promptText.length > softLimit) {
    logger?.warn('externalAgent.refine.prompt-soft-limit', {
      runId: state.runId,
      length: promptText.length,
      softLimit,
    });
  }
  return {
    type: 'final_prompt',
    text: promptText,
    refinedPrompt: promptText,
    ...(assistantMessage !== undefined ? { assistantMessage } : {}),
  };
}

interface PassthroughArgs {
  readonly textBuffer: string;
  readonly state: { runId: string; originalAsk: string };
  readonly assistantMessage: RefineMessage | undefined;
  readonly logger: { warn(event: string, fields: Record<string, unknown>): void } | undefined;
}

function passthroughDecision(args: PassthroughArgs): RefineDecision {
  const { textBuffer, state, assistantMessage, logger } = args;
  // Model returned text but no tool call: treat the text as a tentative final prompt.
  const fallback = textBuffer.trim();
  if (fallback.length === 0) {
    // Reasoning-heavy models (qwen3, deepseek) sometimes exhaust their token
    // budget inside `reasoning_content` without ever emitting a tool call or
    // visible content. Fall back to passing the user's original ask verbatim.
    logger?.warn('externalAgent.refine.passthrough', {
      runId: state.runId,
      reason: 'empty_response',
    });
    return {
      type: 'final_prompt',
      text: state.originalAsk,
      refinedPrompt: state.originalAsk,
      ...(assistantMessage !== undefined ? { assistantMessage } : {}),
    };
  }
  logger?.warn('externalAgent.refine.no-tool-call', { runId: state.runId });
  return {
    type: 'final_prompt',
    text: fallback,
    refinedPrompt: fallback,
    ...(assistantMessage !== undefined ? { assistantMessage } : {}),
  };
}

function toChatMessage(m: RefineMessage): ChatMessage {
  return { role: m.role, content: m.content };
}

function buildTraceContext(input: ProviderTraceContext): ProviderTraceContext {
  return {
    ...(input.callbacks !== undefined && input.callbacks.length > 0
      ? { callbacks: input.callbacks }
      : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.tags !== undefined && input.tags.length > 0 ? { tags: [...input.tags] } : {}),
    ...(input.runName !== undefined ? { runName: input.runName } : {}),
  };
}

function pickStringField(argsJson: string, field: string): string | null {
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    if (parsed === null || typeof parsed !== 'object') return null;
    const v = (parsed as Record<string, unknown>)[field];
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}
