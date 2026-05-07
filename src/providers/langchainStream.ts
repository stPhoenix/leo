import type { AIMessageChunk } from '@langchain/core/messages';
import type { StreamEvent } from '@/agent/streamEvents';

interface ToolBuf {
  readonly streamIndex: number;
  id: string;
  name: string;
  args: string;
  started: boolean;
  closed: boolean;
}

interface ThinkingBuf {
  readonly streamIndex: number;
  started: boolean;
  closed: boolean;
  redacted: boolean;
}

interface State {
  nextStreamIndex: number;
  textIndex: number;
  textStarted: boolean;
  textClosed: boolean;
  reasoningKwargIndex: number;
  reasoningKwargStarted: boolean;
  reasoningKwargClosed: boolean;
  toolByLangchainIdx: Map<number, ToolBuf>;
  toolById: Map<string, ToolBuf>;
  thinkingByLangchainIdx: Map<number, ThinkingBuf>;
  finalInputTokens: number | null;
  finalOutputTokens: number | null;
  finalReasoningTokens: number | null;
  finalCacheCreationTokens: number | null;
  finalCacheReadTokens: number | null;
}

function makeState(): State {
  return {
    nextStreamIndex: 0,
    textIndex: -1,
    textStarted: false,
    textClosed: false,
    reasoningKwargIndex: -1,
    reasoningKwargStarted: false,
    reasoningKwargClosed: false,
    toolByLangchainIdx: new Map(),
    toolById: new Map(),
    thinkingByLangchainIdx: new Map(),
    finalInputTokens: null,
    finalOutputTokens: null,
    finalReasoningTokens: null,
    finalCacheCreationTokens: null,
    finalCacheReadTokens: null,
  };
}

interface TextLikeBlock {
  readonly type: string;
  readonly text?: unknown;
}

interface ContentPart {
  readonly type: string;
  readonly text?: unknown;
  readonly thinking?: unknown;
  readonly reasoning?: unknown;
  readonly signature?: unknown;
  readonly data?: unknown;
  readonly index?: unknown;
}

interface ChunkWithKwargs {
  readonly additional_kwargs?: {
    readonly reasoning_content?: unknown;
  };
}

function chunkText(chunk: AIMessageChunk): string {
  const c = chunk.content as unknown;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    let out = '';
    for (const part of c as TextLikeBlock[]) {
      if (part.type === 'text' && typeof part.text === 'string') out += part.text;
    }
    return out;
  }
  return '';
}

interface ChunkWithMeta {
  readonly tool_call_chunks?: ReadonlyArray<{
    readonly id?: string;
    readonly name?: string;
    readonly args?: string;
    readonly index?: number;
  }>;
  readonly usage_metadata?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly input_token_details?: {
      readonly cache_creation?: number;
      readonly cache_read?: number;
    };
    readonly output_token_details?: {
      readonly reasoning?: number;
    };
  };
}

export async function* toStreamEvents(
  source: AsyncIterable<AIMessageChunk>,
): AsyncIterable<StreamEvent> {
  const st = makeState();
  try {
    for await (const chunk of source) {
      yield* processChunk(chunk, st);
    }
    yield* drain(st);
    yield { type: 'done' };
  } catch (err) {
    yield* drain(st);
    yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
  }
}

function* processChunk(chunk: AIMessageChunk, st: State): Iterable<StreamEvent> {
  yield* processThinkingParts(chunk, st);
  yield* emitTextDelta(chunk, st);
  yield* emitToolCallDeltas(chunk, st);
  captureUsageMetadata(chunk, st);
}

function* emitTextDelta(chunk: AIMessageChunk, st: State): Iterable<StreamEvent> {
  const text = chunkText(chunk);
  if (text.length === 0) return;
  if (!st.textStarted) {
    st.textIndex = st.nextStreamIndex;
    st.nextStreamIndex += 1;
    st.textStarted = true;
    yield { type: 'block_start', index: st.textIndex, block: { type: 'text' } };
  }
  yield {
    type: 'block_delta',
    index: st.textIndex,
    delta: { type: 'text_delta', text },
  };
}

function* emitToolCallDeltas(chunk: AIMessageChunk, st: State): Iterable<StreamEvent> {
  const meta = chunk as unknown as ChunkWithMeta;
  const tcChunks = meta.tool_call_chunks;
  if (tcChunks === undefined || tcChunks.length === 0) return;
  for (const c of tcChunks) {
    yield* emitOneToolCallDelta(c, st);
  }
}

function* emitOneToolCallDelta(
  c: NonNullable<ChunkWithMeta['tool_call_chunks']>[number],
  st: State,
): Iterable<StreamEvent> {
  const buf = resolveToolBuf(c, st);
  if (typeof c.id === 'string' && c.id.length > 0 && buf.id.length === 0) buf.id = c.id;
  if (typeof c.name === 'string' && c.name.length > 0 && buf.name.length === 0) buf.name = c.name;
  const argsPart = typeof c.args === 'string' ? c.args : '';

  if (!buf.started && buf.id.length > 0 && buf.name.length > 0) {
    buf.started = true;
    yield {
      type: 'block_start',
      index: buf.streamIndex,
      block: { type: 'tool_use', id: buf.id, name: buf.name },
    };
  }
  if (argsPart.length > 0) {
    buf.args += argsPart;
    if (buf.started) {
      yield {
        type: 'block_delta',
        index: buf.streamIndex,
        delta: { type: 'input_json_delta', partial_json: argsPart },
      };
    }
  }
}

// Some providers (Google) emit parallel tool calls without an `index` on
// each chunk — every chunk falls into idx 0 and our accumulator concatenates
// their args into invalid JSON. Prefer the `id` key when present so each
// distinct tool call gets its own buffer; fall back to `index` for streaming
// providers (OpenAI/Anthropic) whose follow-up arg chunks carry only `index`.
function resolveToolBuf(
  c: NonNullable<ChunkWithMeta['tool_call_chunks']>[number],
  st: State,
): ToolBuf {
  const id = typeof c.id === 'string' ? c.id : '';
  if (id.length > 0) {
    const existing = st.toolById.get(id);
    if (existing !== undefined) return existing;
    const buf = newToolBuf(st);
    st.toolById.set(id, buf);
    if (typeof c.index === 'number') st.toolByLangchainIdx.set(c.index, buf);
    return buf;
  }
  const idx = c.index ?? 0;
  const existing = st.toolByLangchainIdx.get(idx);
  if (existing !== undefined) return existing;
  const buf = newToolBuf(st);
  st.toolByLangchainIdx.set(idx, buf);
  return buf;
}

function newToolBuf(st: State): ToolBuf {
  const buf: ToolBuf = {
    streamIndex: st.nextStreamIndex,
    id: '',
    name: '',
    args: '',
    started: false,
    closed: false,
  };
  st.nextStreamIndex += 1;
  return buf;
}

function captureUsageMetadata(chunk: AIMessageChunk, st: State): void {
  const meta = chunk as unknown as ChunkWithMeta;
  const usage = meta.usage_metadata;
  if (usage === undefined) return;
  if (typeof usage.input_tokens === 'number') st.finalInputTokens = usage.input_tokens;
  if (typeof usage.output_tokens === 'number') st.finalOutputTokens = usage.output_tokens;
  const outDetails = usage.output_token_details;
  if (outDetails !== undefined && typeof outDetails.reasoning === 'number') {
    st.finalReasoningTokens = outDetails.reasoning;
  }
  const inDetails = usage.input_token_details;
  if (inDetails !== undefined) {
    if (typeof inDetails.cache_creation === 'number') {
      st.finalCacheCreationTokens = inDetails.cache_creation;
    }
    if (typeof inDetails.cache_read === 'number') {
      st.finalCacheReadTokens = inDetails.cache_read;
    }
  }
}

function* processThinkingParts(chunk: AIMessageChunk, st: State): Iterable<StreamEvent> {
  yield* emitReasoningKwarg(chunk, st);
  const c = chunk.content as unknown;
  if (!Array.isArray(c)) return;
  for (const part of c as ContentPart[]) {
    if (part.type === 'thinking') yield* emitThinkingPart(part, st);
    else if (part.type === 'reasoning') yield* emitReasoningPart(part, st);
    else if (part.type === 'redacted_thinking') yield* emitRedactedThinkingPart(part, st);
  }
}

function* emitReasoningKwarg(chunk: AIMessageChunk, st: State): Iterable<StreamEvent> {
  const ak = (chunk as unknown as ChunkWithKwargs).additional_kwargs;
  if (
    ak === undefined ||
    typeof ak.reasoning_content !== 'string' ||
    ak.reasoning_content.length === 0
  ) {
    return;
  }
  if (!st.reasoningKwargStarted) {
    st.reasoningKwargIndex = st.nextStreamIndex;
    st.nextStreamIndex += 1;
    st.reasoningKwargStarted = true;
    yield { type: 'block_start', index: st.reasoningKwargIndex, block: { type: 'thinking' } };
  }
  yield {
    type: 'block_delta',
    index: st.reasoningKwargIndex,
    delta: { type: 'thinking_delta', thinking: ak.reasoning_content },
  };
}

function* emitThinkingPart(part: ContentPart, st: State): Iterable<StreamEvent> {
  const buf = ensureThinkingBuf(st, part.index, false);
  if (!buf.started) {
    buf.started = true;
    yield { type: 'block_start', index: buf.streamIndex, block: { type: 'thinking' } };
  }
  if (typeof part.thinking === 'string' && part.thinking.length > 0) {
    yield {
      type: 'block_delta',
      index: buf.streamIndex,
      delta: { type: 'thinking_delta', thinking: part.thinking },
    };
  }
  if (typeof part.signature === 'string' && part.signature.length > 0) {
    yield {
      type: 'block_delta',
      index: buf.streamIndex,
      delta: { type: 'signature_delta', signature: part.signature },
    };
  }
}

function* emitReasoningPart(part: ContentPart, st: State): Iterable<StreamEvent> {
  const buf = ensureThinkingBuf(st, part.index, false);
  if (!buf.started) {
    buf.started = true;
    yield { type: 'block_start', index: buf.streamIndex, block: { type: 'thinking' } };
  }
  if (typeof part.reasoning === 'string' && part.reasoning.length > 0) {
    yield {
      type: 'block_delta',
      index: buf.streamIndex,
      delta: { type: 'thinking_delta', thinking: part.reasoning },
    };
  }
}

function* emitRedactedThinkingPart(part: ContentPart, st: State): Iterable<StreamEvent> {
  if (typeof part.data !== 'string' || part.data.length === 0) return;
  const buf = ensureThinkingBuf(st, part.index, true);
  if (!buf.started) {
    buf.started = true;
    buf.redacted = true;
    yield {
      type: 'block_start',
      index: buf.streamIndex,
      block: { type: 'redacted_thinking', data: part.data },
    };
  }
}

function ensureThinkingBuf(st: State, rawIdx: unknown, redacted: boolean): ThinkingBuf {
  const langchainIdx = typeof rawIdx === 'number' ? rawIdx : 0;
  let buf = st.thinkingByLangchainIdx.get(langchainIdx);
  if (buf === undefined) {
    buf = {
      streamIndex: st.nextStreamIndex,
      started: false,
      closed: false,
      redacted,
    };
    st.nextStreamIndex += 1;
    st.thinkingByLangchainIdx.set(langchainIdx, buf);
  }
  return buf;
}

function* drain(st: State): Iterable<StreamEvent> {
  yield* closeStandaloneBlocks(st);
  yield* closeBufferedBlocks(st.thinkingByLangchainIdx.values());
  // Tool bufs may live in `toolByLangchainIdx`, `toolById`, or both
  // (depending on whether the provider supplies `index`, `id`, or both per
  // chunk). Iterate both maps; `closed` flag dedupes the overlap.
  yield* closeBufferedBlocks(st.toolByLangchainIdx.values());
  yield* closeBufferedBlocks(st.toolById.values());
  yield* emitFinalUsageMessage(st);
}

function* closeStandaloneBlocks(st: State): Iterable<StreamEvent> {
  if (st.textStarted && !st.textClosed) {
    st.textClosed = true;
    yield { type: 'block_stop', index: st.textIndex };
  }
  if (st.reasoningKwargStarted && !st.reasoningKwargClosed) {
    st.reasoningKwargClosed = true;
    yield { type: 'block_stop', index: st.reasoningKwargIndex };
  }
}

function* closeBufferedBlocks(
  bufs: Iterable<{ started: boolean; closed: boolean; streamIndex: number }>,
): Iterable<StreamEvent> {
  for (const buf of bufs) {
    if (!buf.started || buf.closed) continue;
    buf.closed = true;
    yield { type: 'block_stop', index: buf.streamIndex };
  }
}

function* emitFinalUsageMessage(st: State): Iterable<StreamEvent> {
  if (
    st.finalInputTokens === null &&
    st.finalOutputTokens === null &&
    st.finalReasoningTokens === null &&
    st.finalCacheCreationTokens === null &&
    st.finalCacheReadTokens === null
  ) {
    return;
  }
  yield {
    type: 'message_delta',
    usage: {
      input: st.finalInputTokens ?? 0,
      output: st.finalOutputTokens ?? 0,
      ...(st.finalReasoningTokens !== null ? { reasoning: st.finalReasoningTokens } : {}),
      ...(st.finalCacheCreationTokens !== null
        ? { cacheCreation: st.finalCacheCreationTokens }
        : {}),
      ...(st.finalCacheReadTokens !== null ? { cacheRead: st.finalCacheReadTokens } : {}),
    },
  };
}
