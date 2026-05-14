import {
  estimateBlockTokens,
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
  const acc: BreakdownAcc = {
    toolCallTokens: 0,
    toolResultTokens: 0,
    attachmentTokens: 0,
    assistantTextTokens: 0,
    userTextTokens: 0,
  };

  for (const m of messages) {
    if (typeof m.content === 'string') {
      addTextTokens(acc, m.role, roughTokenCountEstimation(m.content));
      continue;
    }
    for (const block of m.content) {
      applyTally(acc, m.role, tallyBlock(block));
    }
  }

  return {
    ...acc,
    totalTokens:
      acc.toolCallTokens +
      acc.toolResultTokens +
      acc.attachmentTokens +
      acc.assistantTextTokens +
      acc.userTextTokens,
  };
}

interface BreakdownAcc {
  toolCallTokens: number;
  toolResultTokens: number;
  attachmentTokens: number;
  assistantTextTokens: number;
  userTextTokens: number;
}

function addTextTokens(acc: BreakdownAcc, role: TokenMessage['role'], tokens: number): void {
  if (role === 'assistant') acc.assistantTextTokens += tokens;
  else if (role === 'user') acc.userTextTokens += tokens;
}

function applyTally(
  acc: BreakdownAcc,
  role: TokenMessage['role'],
  tally: { bucket: Bucket; tokens: number },
): void {
  switch (tally.bucket) {
    case 'tool_call':
      acc.toolCallTokens += tally.tokens;
      return;
    case 'tool_result':
      acc.toolResultTokens += tally.tokens;
      return;
    case 'attachment':
      acc.attachmentTokens += tally.tokens;
      return;
    case 'text':
      addTextTokens(acc, role, tally.tokens);
      return;
  }
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
      return { bucket: 'attachment', tokens: estimateBlockTokens(block) };
    case 'text':
    case 'thinking':
      return { bucket: 'text', tokens: estimateBlockTokens(block) };
    default:
      return { bucket: 'text', tokens: estimateBlockTokens(block) };
  }
}
