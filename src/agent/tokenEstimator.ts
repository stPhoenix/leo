// Block-typed token tally built on `estimateTokens` (chars/4). Rationale for not using
// `BaseChatModel.getNumTokens()` lives in `src/agent/tokenCount.ts` (bundle-size cap).
export type TokenBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image' }
  | { readonly type: 'document' }
  | { readonly type: 'tool_result'; readonly content: readonly TokenBlock[] }
  | { readonly type: 'thinking'; readonly thinking: string }
  | { readonly type: 'tool_use'; readonly name: string; readonly input: unknown }
  | { readonly type: 'server_tool_use'; readonly [key: string]: unknown }
  | { readonly type: string; readonly [key: string]: unknown };

export interface TokenUsage {
  readonly input_tokens: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

export interface TokenMessage {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string | readonly TokenBlock[];
  readonly usage?: TokenUsage;
}

export interface EstimateResult {
  readonly total: number;
  readonly tier: 'usage' | 'hybrid' | 'rough';
}

export const CONSERVATIVE_MULTIPLIER = 4 / 3;
export const IMAGE_DOCUMENT_TOKENS = 2000;

export function roughTokenCountEstimation(content: string, bytesPerToken = 4): number {
  if (content.length === 0) return 0;
  return Math.round(content.length / bytesPerToken);
}

export function estimateBlockTokens(block: TokenBlock): number {
  switch (block.type) {
    case 'text': {
      const text =
        typeof (block as { text?: unknown }).text === 'string'
          ? (block as { text: string }).text
          : '';
      return roughTokenCountEstimation(text);
    }
    case 'image':
    case 'document':
      return IMAGE_DOCUMENT_TOKENS;
    case 'tool_result': {
      const contents = (block as { content?: readonly TokenBlock[] }).content ?? [];
      let sum = 0;
      for (const child of contents) sum += estimateBlockTokens(child);
      return sum;
    }
    case 'thinking': {
      const text =
        typeof (block as { thinking?: unknown }).thinking === 'string'
          ? (block as { thinking: string }).thinking
          : '';
      return roughTokenCountEstimation(text);
    }
    case 'tool_use': {
      const name =
        typeof (block as { name?: unknown }).name === 'string'
          ? (block as { name: string }).name
          : '';
      const input = (block as { input?: unknown }).input;
      return roughTokenCountEstimation(name + JSON.stringify(input ?? null));
    }
    default: {
      return roughTokenCountEstimation(JSON.stringify(block));
    }
  }
}

export function estimateMessageTokens(messages: readonly TokenMessage[]): number {
  let sum = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      sum += roughTokenCountEstimation(m.content);
      continue;
    }
    for (const block of m.content) sum += estimateBlockTokens(block);
  }
  return sum;
}

function applyPadding(raw: number): number {
  return Math.round(raw * CONSERVATIVE_MULTIPLIER);
}

export function apiUsageTokens(messages: readonly TokenMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const usage = m.usage;
    if (usage !== undefined && typeof usage.input_tokens === 'number') {
      const input = usage.input_tokens;
      const cacheCreate =
        typeof usage.cache_creation_input_tokens === 'number'
          ? usage.cache_creation_input_tokens
          : 0;
      const cacheRead =
        typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
      return input + cacheCreate + cacheRead;
    }
    return null;
  }
  return null;
}

export function tokenCountWithEstimation(messages: readonly TokenMessage[]): number | null {
  let anchorIndex = -1;
  let anchorInput = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (
      m.role === 'assistant' &&
      m.usage !== undefined &&
      typeof m.usage.input_tokens === 'number'
    ) {
      anchorIndex = i;
      anchorInput = m.usage.input_tokens;
      break;
    }
  }
  if (anchorIndex < 0) return null;
  const after = messages.slice(anchorIndex + 1);
  if (after.length === 0) return applyPadding(anchorInput);
  const delta = estimateMessageTokens(after);
  return applyPadding(anchorInput + delta);
}

export function estimateTokens(messages: readonly TokenMessage[]): EstimateResult {
  const tail = messages[messages.length - 1];
  if (tail?.role === 'assistant' && tail.usage !== undefined) {
    const usageTotal = apiUsageTokens(messages);
    if (usageTotal !== null) return { total: usageTotal, tier: 'usage' };
  }
  const hybrid = tokenCountWithEstimation(messages);
  if (hybrid !== null) return { total: hybrid, tier: 'hybrid' };
  const rough = estimateMessageTokens(messages);
  return { total: applyPadding(rough), tier: 'rough' };
}
