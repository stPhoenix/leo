import type { RewriteMessage } from './multistep/messageRewriter';

export interface AssistantStep {
  readonly text: string;
  readonly toolCalls: readonly { id: string; name: string; args: unknown }[];
  readonly usage: number;
}

/**
 * Narrow interface every inner ReAct loop (simple, researchStep, synthesize)
 * targets. F16 binds a real LangChain `BaseChatModel` to this shape; tests
 * pass scripted adapters directly.
 */
export interface ManualChatModelAdapter {
  invokeTurn(input: {
    readonly messages: readonly RewriteMessage[];
    readonly toolNames: readonly string[];
    readonly signal: AbortSignal;
  }): Promise<AssistantStep>;
}
