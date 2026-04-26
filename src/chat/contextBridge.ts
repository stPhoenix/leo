import type { ChatMessageRecord, ContentBlock } from './types';
import type { TokenBlock, TokenMessage, TokenUsage } from '@/agent/tokenEstimator';

export interface AnalyzerInputs {
  readonly messages: readonly TokenMessage[];
  readonly originalMessages: readonly TokenMessage[];
}

export function recordsToAnalyzerInputs(records: readonly ChatMessageRecord[]): AnalyzerInputs {
  const messages: TokenMessage[] = [];
  const originalMessages: TokenMessage[] = [];
  for (const r of records) {
    if (r.role !== 'user' && r.role !== 'assistant') continue;
    const role: TokenMessage['role'] = r.role;
    const content = recordContent(r);
    const base: TokenMessage = { role, content };
    messages.push(base);
    const usage = recordUsage(r);
    originalMessages.push(usage !== null ? { ...base, usage } : base);
  }
  return { messages, originalMessages };
}

function recordContent(r: ChatMessageRecord): string | readonly TokenBlock[] {
  if (r.blocks !== undefined && r.blocks.length > 0) {
    return r.blocks.map(toTokenBlock);
  }
  return r.content;
}

function toTokenBlock(b: ContentBlock): TokenBlock {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'thinking':
      return { type: 'thinking', thinking: b.thinking };
    case 'image':
      return { type: 'image' };
    case 'document':
      return { type: 'document' };
    case 'tool_use':
      return { type: 'tool_use', name: b.name, input: b.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        content: [{ type: 'text', text: typeof b.content === 'string' ? b.content : '' }],
      };
    case 'redacted_thinking':
      return { type: 'redacted_thinking', data: b.data };
  }
}

function recordUsage(r: ChatMessageRecord): TokenUsage | null {
  if (r.role !== 'assistant') return null;
  const t = r.tokens;
  if (t === undefined || typeof t.input !== 'number') return null;
  const usage: TokenUsage = {
    input_tokens: t.input,
    ...(typeof t.output === 'number' ? { output_tokens: t.output } : {}),
    ...(typeof t.cacheCreation === 'number'
      ? { cache_creation_input_tokens: t.cacheCreation }
      : {}),
    ...(typeof t.cacheRead === 'number' ? { cache_read_input_tokens: t.cacheRead } : {}),
  };
  return usage;
}
