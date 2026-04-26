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

interface State {
  nextStreamIndex: number;
  textIndex: number;
  textStarted: boolean;
  textClosed: boolean;
  toolByLangchainIdx: Map<number, ToolBuf>;
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
    toolByLangchainIdx: new Map(),
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
    yield* finalize(st);
  } catch (err) {
    yield* finalize(st);
    yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
  }
}

function* processChunk(chunk: AIMessageChunk, st: State): Iterable<StreamEvent> {
  const text = chunkText(chunk);
  if (text.length > 0) {
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

  const meta = chunk as unknown as ChunkWithMeta;
  const tcChunks = meta.tool_call_chunks;
  if (tcChunks !== undefined && tcChunks.length > 0) {
    for (const c of tcChunks) {
      const langchainIdx = c.index ?? 0;
      let buf = st.toolByLangchainIdx.get(langchainIdx);
      if (buf === undefined) {
        buf = {
          streamIndex: st.nextStreamIndex,
          id: '',
          name: '',
          args: '',
          started: false,
          closed: false,
        };
        st.nextStreamIndex += 1;
        st.toolByLangchainIdx.set(langchainIdx, buf);
      }
      if (typeof c.id === 'string' && c.id.length > 0) buf.id += c.id;
      if (typeof c.name === 'string' && c.name.length > 0) buf.name += c.name;
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
  }

  const usage = meta.usage_metadata;
  if (usage !== undefined) {
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
}

function* finalize(st: State): Iterable<StreamEvent> {
  if (st.textStarted && !st.textClosed) {
    st.textClosed = true;
    yield { type: 'block_stop', index: st.textIndex };
  }
  for (const buf of st.toolByLangchainIdx.values()) {
    if (!buf.started) continue;
    if (!buf.closed) {
      buf.closed = true;
      yield { type: 'block_stop', index: buf.streamIndex };
    }
  }
  if (
    st.finalInputTokens !== null ||
    st.finalOutputTokens !== null ||
    st.finalReasoningTokens !== null ||
    st.finalCacheCreationTokens !== null ||
    st.finalCacheReadTokens !== null
  ) {
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
  yield { type: 'done' };
}
