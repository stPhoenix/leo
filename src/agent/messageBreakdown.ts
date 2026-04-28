import {
  estimateBlockTokens,
  IMAGE_DOCUMENT_TOKENS,
  roughTokenCountEstimation,
  type TokenBlock,
  type TokenMessage,
} from './tokenEstimator';

export interface MessageBreakdown {
  readonly toolCallTokens: number;
  readonly toolResultTokens: number;
  readonly attachmentTokens: number;
  readonly assistantTextTokens: number;
  readonly userTextTokens: number;
  readonly totalTokens: number;
}

export const EMPTY_BREAKDOWN: MessageBreakdown = {
  toolCallTokens: 0,
  toolResultTokens: 0,
  attachmentTokens: 0,
  assistantTextTokens: 0,
  userTextTokens: 0,
  totalTokens: 0,
};

export function breakdownMessages(messages: readonly TokenMessage[]): MessageBreakdown {
  let toolCallTokens = 0;
  let toolResultTokens = 0;
  let attachmentTokens = 0;
  let assistantTextTokens = 0;
  let userTextTokens = 0;

  for (const m of messages) {
    if (typeof m.content === 'string') {
      const t = roughTokenCountEstimation(m.content);
      if (m.role === 'assistant') assistantTextTokens += t;
      else if (m.role === 'user') userTextTokens += t;
      continue;
    }
    for (const block of m.content) {
      const tally = tallyBlock(block);
      switch (tally.bucket) {
        case 'tool_call':
          toolCallTokens += tally.tokens;
          break;
        case 'tool_result':
          toolResultTokens += tally.tokens;
          break;
        case 'attachment':
          attachmentTokens += tally.tokens;
          break;
        case 'text':
          if (m.role === 'assistant') assistantTextTokens += tally.tokens;
          else if (m.role === 'user') userTextTokens += tally.tokens;
          break;
      }
    }
  }

  const totalTokens =
    toolCallTokens + toolResultTokens + attachmentTokens + assistantTextTokens + userTextTokens;
  return {
    toolCallTokens,
    toolResultTokens,
    attachmentTokens,
    assistantTextTokens,
    userTextTokens,
    totalTokens,
  };
}

type Bucket = 'tool_call' | 'tool_result' | 'attachment' | 'text';

function tallyBlock(block: TokenBlock): { bucket: Bucket; tokens: number } {
  switch (block.type) {
    case 'tool_use':
      return { bucket: 'tool_call', tokens: estimateBlockTokens(block) };
    case 'tool_result':
      return { bucket: 'tool_result', tokens: estimateBlockTokens(block) };
    case 'image':
    case 'document':
      return { bucket: 'attachment', tokens: IMAGE_DOCUMENT_TOKENS };
    case 'text':
    case 'thinking':
      return { bucket: 'text', tokens: estimateBlockTokens(block) };
    default:
      return { bucket: 'text', tokens: estimateBlockTokens(block) };
  }
}
