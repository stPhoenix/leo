import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  AssistantStep,
  ManualChatModelAdapter,
} from '@/agent/externalAgent/adapters/inlineAgent';

/**
 * Fake `ManualChatModelAdapter` that emits a scripted sequence of assistant
 * turns. Each `invokeTurn` consumes the next entry from `script`.
 */
export interface ScriptedTurn {
  text?: string;
  toolCalls?: readonly { id: string; name: string; args: unknown }[];
  usage?: number;
  delayMs?: number;
  throwError?: unknown;
}

export function makeScriptedAdapter(
  script: readonly ScriptedTurn[],
): ManualChatModelAdapter & { calls: number } {
  let calls = 0;
  const adapter: ManualChatModelAdapter & { calls: number } = {
    get calls() {
      return calls;
    },
    set calls(_n) {
      // read-only externally
    },
    async invokeTurn(input): Promise<AssistantStep> {
      const turn = script[calls] ?? { text: 'fallback', toolCalls: [], usage: 0 };
      calls += 1;
      if (turn.delayMs !== undefined) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, turn.delayMs);
          input.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            },
            { once: true },
          );
        });
      }
      if (turn.throwError !== undefined) throw turn.throwError;
      return {
        text: turn.text ?? '',
        toolCalls: turn.toolCalls ?? [],
        usage: turn.usage ?? 0,
      };
    },
  };
  return adapter;
}

/**
 * Fake `BaseChatModel` exposing `withStructuredOutput` for classifier/planner
 * consumption. Returns scripted JSON outputs.
 */
export function makeStructuredOutputModel(outputs: readonly unknown[]): BaseChatModel {
  let i = 0;
  return {
    invoke: async () => undefined,
    withStructuredOutput() {
      return {
        invoke: async (): Promise<unknown> => {
          const out = outputs[i] ?? outputs[outputs.length - 1];
          i += 1;
          if (out instanceof Error) throw out;
          return out;
        },
      };
    },
  } as unknown as BaseChatModel;
}
