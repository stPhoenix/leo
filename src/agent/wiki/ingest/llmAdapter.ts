import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AIMessage, ToolCall } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { RunnableLambda } from '@langchain/core/runnables';
import type { Runnable } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import type { ZodType } from 'zod';
import type { LlmJsonInvoker } from './subagents';
import {
  buildEmitToolDescription,
  composeStructuredInvocation,
} from '@/prompts/agent/wiki/ingest/llmAdapterPrompts';

export interface LlmAdapterDeps {
  readonly chatModel: () => BaseChatModel;
  readonly getInvokeOptions?: () => Record<string, unknown>;
}

export function createLlmJsonInvoker(deps: LlmAdapterDeps): LlmJsonInvoker {
  return {
    async invoke<T>(
      input: { system: string; user: string },
      schema: ZodType<T>,
      name: string,
      signal: AbortSignal,
    ): Promise<T> {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');

      const model = deps.chatModel();
      if (typeof model.bindTools !== 'function') {
        throw new Error('chat model does not support bindTools');
      }

      const toolName = `emit_${name}`;
      const emitTool = tool(async () => '', {
        name: toolName,
        description: buildEmitToolDescription(name),
        schema: schema as ZodType<Record<string, unknown>>,
      });

      // LM Studio + qwen3.6 GGUF accept only string tool_choice values (none|auto|required).
      // `required` routes output into reasoning_content (LM Studio bug #1773); object form
      // returns 400. `auto` is the only viable choice — tool selection is enforced by an
      // emphatic prompt directive instead.
      const bound = model.bindTools([emitTool], { tool_choice: 'auto' }) as Runnable<
        readonly unknown[],
        AIMessage
      >;

      const extractAndParse = RunnableLambda.from((msg: AIMessage): T => {
        const match = (msg.tool_calls ?? []).find((c: ToolCall) => c.name === toolName);
        if (match === undefined) {
          throw new Error(`tool_call_missing: model did not call ${toolName}`);
        }
        return schema.parse(match.args);
      });

      const chain = bound.pipe(extractAndParse).withRetry({ stopAfterAttempt: 4 });

      const { system: directedSystem, user: directedUser } = composeStructuredInvocation(
        input.system,
        input.user,
        toolName,
      );

      const invokeOpts: Record<string, unknown> = { signal, ...(deps.getInvokeOptions?.() ?? {}) };
      return chain.invoke(
        [new SystemMessage(directedSystem), new HumanMessage(directedUser)],
        invokeOpts,
      );
    },
  };
}
