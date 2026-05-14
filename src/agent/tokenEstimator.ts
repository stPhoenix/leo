// Block-typed token tally. Three tiers:
//   - 'usage': anchor on most recent assistant `usage` and no tail messages after it
//   - 'hybrid': anchor on most recent assistant `usage` + estimated tail
//   - 'rough':  no anchor available; full-history rough estimate × CONSERVATIVE_MULTIPLIER
// Anchor sums input + cache_creation + cache_read (every byte the provider counted toward
// the input window). LangChain `BaseChatModel.getNumTokens()` would be accurate but pulls
// a per-model tokenizer (~600 KB) that violates `pnpm check:bundle`.
export type TokenBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly width?: number; readonly height?: number }
  | { readonly type: 'document'; readonly pages?: number }
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
export const IMAGE_DOCUMENT_TOKENS = 1500;
export const IMAGE_TOKENS_MAX = 1600;
export const DOCUMENT_PAGE_TOKENS = 1500;
export const DOCUMENT_TOKENS_FALLBACK = 2200;
export const TOOL_USE_OVERHEAD = 8;
export const TOOL_RESULT_OVERHEAD_PER_BLOCK = 4;

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
    case 'image': {
      const w = (block as { width?: unknown }).width;
      const h = (block as { height?: unknown }).height;
      if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
        return Math.min(IMAGE_TOKENS_MAX, Math.ceil((w * h) / 750));
      }
      return IMAGE_DOCUMENT_TOKENS;
    }
    case 'document': {
      const pages = (block as { pages?: unknown }).pages;
      if (typeof pages === 'number' && pages > 0) {
        return pages * DOCUMENT_PAGE_TOKENS;
      }
      return DOCUMENT_TOKENS_FALLBACK;
    }
    case 'tool_result': {
      const contents = (block as { content?: readonly TokenBlock[] }).content ?? [];
      let sum = 0;
      for (const child of contents) {
        sum += estimateBlockTokens(child) + TOOL_RESULT_OVERHEAD_PER_BLOCK;
      }
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
      const serialized = name + JSON.stringify(input ?? null);
      return Math.ceil(serialized.length / 3) + TOOL_USE_OVERHEAD;
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

interface AnchorInfo {
  readonly index: number;
  readonly total: number;
}

function pickAnchor(messages: readonly TokenMessage[]): AnchorInfo | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const usage = m.usage;
    if (usage === undefined || typeof usage.input_tokens !== 'number') continue;
    const cacheCreate =
      typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
    const cacheRead =
      typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
    return { index: i, total: usage.input_tokens + cacheCreate + cacheRead };
  }
  return null;
}

export function apiUsageTokens(messages: readonly TokenMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const usage = m.usage;
    if (usage === undefined || typeof usage.input_tokens !== 'number') return null;
    const cacheCreate =
      typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
    const cacheRead =
      typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
    return usage.input_tokens + cacheCreate + cacheRead;
  }
  return null;
}

export function tokenCountWithEstimation(messages: readonly TokenMessage[]): number | null {
  const anchor = pickAnchor(messages);
  if (anchor === null) return null;
  const tail = messages.slice(anchor.index + 1);
  if (tail.length === 0) return anchor.total;
  return anchor.total + estimateMessageTokens(tail);
}

export function estimateTokens(messages: readonly TokenMessage[]): EstimateResult {
  const anchor = pickAnchor(messages);
  if (anchor !== null) {
    const tail = messages.slice(anchor.index + 1);
    if (tail.length === 0) return { total: anchor.total, tier: 'usage' };
    return { total: anchor.total + estimateMessageTokens(tail), tier: 'hybrid' };
  }
  const rough = estimateMessageTokens(messages);
  return { total: applyPadding(rough), tier: 'rough' };
}
