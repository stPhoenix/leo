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

  return {
    async refine({ state, userInput, signal, traceConfig }) {
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: state.originalAsk },
        ...state.refineHistory.map((m) => toChatMessage(m)),
      ];
      if (userInput !== null && userInput.length > 0) {
        // Avoid duplicating; refineHistory already carries the user message
        // appended by the subgraph driver. userInput is informational only.
      }

      const req: ProviderChatRequest = {
        model: opts.model(),
        messages,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature() } : {}),
        maxTokens: opts.maxTokens !== undefined ? opts.maxTokens() : DEFAULT_MAX_TOKENS,
        tools: REFINE_TOOLS,
        ...(traceConfig !== undefined ? { trace: buildTraceContext(traceConfig) } : {}),
      };

      // Stream-event tool-call parser. Not replaced by LangChain's
      // `ChatModel.bindTools(...).invoke(...).tool_calls` because that path
      // bypasses Leo's `ProviderManager` abstraction (uniform OpenAI-compat +
      // Anthropic + LM Studio wiring with shared connection-state tracking,
      // retry policy, FIFO queue, telemetry). The parser handles both
      // OpenAI-style (`tool_call` events) and Anthropic-style streams
      // (`block_start[tool_use]` → `block_delta[input_json_delta]` → `block_stop`)
      // because `ProviderManager.stream()` normalises across providers but
      // surfaces the provider-native event shape verbatim.
      let textBuffer = '';
      const toolCalls: Array<{ name: string; argsJson: string }> = [];
      const toolBufs = new Map<number, { id: string; name: string; args: string }>();

      try {
        for await (const event of opts.provider.stream(req, signal)) {
          if (signal.aborted) break;
          if (event.type === 'token') {
            textBuffer += event.text;
          } else if (event.type === 'tool_call') {
            toolCalls.push({ name: event.call.name, argsJson: event.call.argsJson });
          } else if (event.type === 'block_start') {
            if (event.block.type === 'tool_use') {
              toolBufs.set(event.index, {
                id: event.block.id,
                name: event.block.name,
                args: '',
              });
            }
          } else if (event.type === 'block_delta') {
            if (event.delta.type === 'text_delta') {
              textBuffer += event.delta.text;
            } else if (event.delta.type === 'input_json_delta') {
              const buf = toolBufs.get(event.index);
              if (buf !== undefined) buf.args += event.delta.partial_json;
            }
          } else if (event.type === 'block_stop') {
            const buf = toolBufs.get(event.index);
            if (buf !== undefined) {
              toolCalls.push({
                name: buf.name,
                argsJson: buf.args.length === 0 ? '{}' : buf.args,
              });
              toolBufs.delete(event.index);
            }
          } else if (event.type === 'error') {
            throw event.error;
          } else if (event.type === 'done') {
            break;
          }
        }
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }

      const assistantMessage: RefineMessage | undefined =
        textBuffer.length > 0 ? { role: 'assistant', content: textBuffer } : undefined;

      const finalCall = toolCalls.find((c) => c.name === 'emit_final_prompt');
      const askCall = toolCalls.find((c) => c.name === 'ask_clarifying_question');
      const otherCall = toolCalls.find(
        (c) => c.name !== 'emit_final_prompt' && c.name !== 'ask_clarifying_question',
      );

      if (otherCall !== undefined) {
        const err = new Error(
          `refine_invalid_tool: refine sub-agent attempted to call ${otherCall.name}`,
        );
        // Surface as a typed error code via subgraph's error wiring.
        (err as Error & { code?: string }).code = 'refine_invalid_tool';
        throw err;
      }

      if (finalCall !== undefined) {
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
        const decision: RefineDecision = {
          type: 'final_prompt',
          text: promptText,
          refinedPrompt: promptText,
          ...(assistantMessage !== undefined ? { assistantMessage } : {}),
        };
        return decision;
      }

      if (askCall !== undefined) {
        const question = pickStringField(askCall.argsJson, 'question') ?? textBuffer.trim();
        const decision: RefineDecision = {
          type: 'clarify',
          text: question,
          ...(assistantMessage !== undefined ? { assistantMessage } : {}),
        };
        return decision;
      }

      // Model returned text but no tool call: treat the text as a tentative
      // final prompt to keep the loop progressing.
      const fallback = textBuffer.trim();
      if (fallback.length === 0) {
        // Reasoning-heavy models (qwen3, deepseek) sometimes exhaust their
        // token budget inside `reasoning_content` without ever emitting a
        // tool call or visible content. Rather than fail the run, fall back
        // to passing the user's original ask through verbatim — refine adds
        // value but is not load-bearing.
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
    },
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
