import { describe, expect, it } from 'vitest';
import { AIMessageChunk } from '@langchain/core/messages';
import { toStreamEvents } from '@/providers/langchainStream';
import type { StreamEvent } from '@/agent/streamEvents';

async function* fromArray<T>(arr: readonly T[]): AsyncIterable<T> {
  for (const x of arr) yield x;
}

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

describe('toStreamEvents — text-only stream', () => {
  it('emits block_start text → block_delta text_delta × N → block_stop → done', async () => {
    const chunks = [
      new AIMessageChunk({ content: 'Hello' }),
      new AIMessageChunk({ content: ' world' }),
      new AIMessageChunk({ content: '!' }),
    ];
    const events = await collect(toStreamEvents(fromArray(chunks)));
    expect(events.map((e) => e.type)).toEqual([
      'block_start',
      'block_delta',
      'block_delta',
      'block_delta',
      'block_stop',
      'done',
    ]);
    const start = events[0]!;
    if (start.type !== 'block_start') throw new Error('expected block_start');
    expect(start.block.type).toBe('text');
    expect(start.index).toBe(0);

    const text = events
      .filter((e) => e.type === 'block_delta')
      .map((e) => (e.type === 'block_delta' && e.delta.type === 'text_delta' ? e.delta.text : ''))
      .join('');
    expect(text).toBe('Hello world!');
  });

  it('forwards usage_metadata as message_delta.usage before done', async () => {
    const chunks = [
      new AIMessageChunk({ content: 'Hi' }),
      new AIMessageChunk({
        content: '',
        usage_metadata: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
      }),
    ];
    const events = await collect(toStreamEvents(fromArray(chunks)));
    const messageDelta = events.find((e) => e.type === 'message_delta');
    expect(messageDelta).toBeDefined();
    if (messageDelta?.type === 'message_delta') {
      expect(messageDelta.usage?.input).toBe(10);
      expect(messageDelta.usage?.output).toBe(3);
    }
    expect(events[events.length - 1]?.type).toBe('done');
    // No legacy `usage` event
    expect(events.some((e) => e.type === 'usage')).toBe(false);
  });

  it('emits no legacy token/tool_call/usage events', async () => {
    const chunks = [new AIMessageChunk({ content: 'hi' })];
    const events = await collect(toStreamEvents(fromArray(chunks)));
    for (const ev of events) {
      expect(['token', 'tool_call', 'usage']).not.toContain(ev.type);
    }
  });
});

describe('toStreamEvents — tool_use stream', () => {
  it('emits block_start tool_use → input_json_delta × N → block_stop → done', async () => {
    const chunks = [
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [{ id: 't1', name: 'readNote', args: '', index: 0 }],
      }),
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [{ args: '{"path":', index: 0 }],
      }),
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [{ args: '"a.md"}', index: 0 }],
      }),
    ];
    const events = await collect(toStreamEvents(fromArray(chunks)));
    expect(events[0]?.type).toBe('block_start');
    if (events[0]?.type === 'block_start') {
      expect(events[0].block.type).toBe('tool_use');
      if (events[0].block.type === 'tool_use') {
        expect(events[0].block.id).toBe('t1');
        expect(events[0].block.name).toBe('readNote');
      }
    }
    const deltas = events.filter(
      (e) => e.type === 'block_delta' && e.delta.type === 'input_json_delta',
    );
    expect(deltas.length).toBe(2);
    const stop = events.find((e) => e.type === 'block_stop');
    expect(stop).toBeDefined();
    expect(events[events.length - 1]?.type).toBe('done');
    // No legacy tool_call event
    expect(events.some((e) => e.type === 'tool_call')).toBe(false);
  });

  it('mixes text and tool_use blocks in order', async () => {
    const chunks = [
      new AIMessageChunk({ content: 'Reading…' }),
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [{ id: 't1', name: 'readNote', args: '{"x":1}', index: 0 }],
      }),
    ];
    const events = await collect(toStreamEvents(fromArray(chunks)));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('block_start');
    // First block_start is text, second is tool_use
    const blockStarts = events.filter((e) => e.type === 'block_start');
    expect(blockStarts.length).toBe(2);
    if (blockStarts[0]?.type === 'block_start') expect(blockStarts[0].block.type).toBe('text');
    if (blockStarts[1]?.type === 'block_start') expect(blockStarts[1].block.type).toBe('tool_use');
    expect(types[types.length - 1]).toBe('done');
  });
});

describe('toStreamEvents — thinking stream', () => {
  it('emits block_start thinking → thinking_delta × N → signature_delta → block_stop → done', async () => {
    const chunks = [
      new AIMessageChunk({
        content: [{ type: 'thinking', thinking: 'Let me think', index: 0 }],
      }),
      new AIMessageChunk({
        content: [{ type: 'thinking', thinking: ' carefully', index: 0 }],
      }),
      new AIMessageChunk({
        content: [{ type: 'thinking', thinking: ' about this.', index: 0 }],
      }),
      new AIMessageChunk({
        content: [{ type: 'thinking', signature: 'sig-abc', index: 0 }],
      }),
    ];
    const events = await collect(toStreamEvents(fromArray(chunks)));
    expect(events.map((e) => e.type)).toEqual([
      'block_start',
      'block_delta',
      'block_delta',
      'block_delta',
      'block_delta',
      'block_stop',
      'done',
    ]);
    const start = events[0]!;
    if (start.type !== 'block_start') throw new Error('expected block_start');
    expect(start.block.type).toBe('thinking');
    expect(start.index).toBe(0);

    const thinking = events
      .filter((e) => e.type === 'block_delta')
      .map((e) =>
        e.type === 'block_delta' && e.delta.type === 'thinking_delta' ? e.delta.thinking : '',
      )
      .join('');
    expect(thinking).toBe('Let me think carefully about this.');

    const sigDelta = events.find(
      (e) => e.type === 'block_delta' && e.delta.type === 'signature_delta',
    );
    expect(sigDelta).toBeDefined();
    if (sigDelta?.type === 'block_delta' && sigDelta.delta.type === 'signature_delta') {
      expect(sigDelta.delta.signature).toBe('sig-abc');
    }
  });

  it('mixes thinking then text with distinct stream indices', async () => {
    const chunks = [
      new AIMessageChunk({
        content: [{ type: 'thinking', thinking: 'reasoning…', index: 0 }],
      }),
      new AIMessageChunk({ content: 'final answer' }),
    ];
    const events = await collect(toStreamEvents(fromArray(chunks)));
    const blockStarts = events.filter((e) => e.type === 'block_start');
    expect(blockStarts.length).toBe(2);
    if (blockStarts[0]?.type === 'block_start') {
      expect(blockStarts[0].block.type).toBe('thinking');
      expect(blockStarts[0].index).toBe(0);
    }
    if (blockStarts[1]?.type === 'block_start') {
      expect(blockStarts[1].block.type).toBe('text');
      expect(blockStarts[1].index).toBe(1);
    }
    const stops = events.filter((e) => e.type === 'block_stop').map((e) => e.index);
    expect(stops.sort()).toEqual([0, 1]);
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('emits block_start redacted_thinking with full data → block_stop → done (no deltas)', async () => {
    const chunks = [
      new AIMessageChunk({
        content: [{ type: 'redacted_thinking', data: 'opaque-bytes', index: 0 }],
      }),
    ];
    const events = await collect(toStreamEvents(fromArray(chunks)));
    expect(events.map((e) => e.type)).toEqual(['block_start', 'block_stop', 'done']);
    const start = events[0]!;
    if (start.type !== 'block_start') throw new Error('expected block_start');
    expect(start.block.type).toBe('redacted_thinking');
    if (start.block.type === 'redacted_thinking') {
      expect(start.block.data).toBe('opaque-bytes');
    }
  });

  it('coexists with tool_use — both blocks open, both block_stop at drain', async () => {
    const chunks = [
      new AIMessageChunk({
        content: [{ type: 'thinking', thinking: 'planning the call', index: 0 }],
      }),
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [{ id: 't1', name: 'readNote', args: '{"path":"a.md"}', index: 0 }],
      }),
    ];
    const events = await collect(toStreamEvents(fromArray(chunks)));
    const blockStarts = events.filter((e) => e.type === 'block_start');
    expect(blockStarts.length).toBe(2);
    const kinds = blockStarts.map((e) => (e.type === 'block_start' ? e.block.type : ''));
    expect(kinds).toContain('thinking');
    expect(kinds).toContain('tool_use');
    const stops = events.filter((e) => e.type === 'block_stop').map((e) => e.index);
    expect(stops.sort()).toEqual([0, 1]);
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('maps additional_kwargs.reasoning_content (chat-completions) to thinking block', async () => {
    const chunks = [
      new AIMessageChunk({
        content: '',
        additional_kwargs: { reasoning_content: 'Step 1: parse the question. ' },
      }),
      new AIMessageChunk({
        content: '',
        additional_kwargs: { reasoning_content: 'Step 2: choose a tool.' },
      }),
      new AIMessageChunk({ content: 'final answer text' }),
    ];
    const events = await collect(toStreamEvents(fromArray(chunks)));
    const blockStarts = events.filter((e) => e.type === 'block_start');
    expect(blockStarts.length).toBe(2);
    if (blockStarts[0]?.type === 'block_start') {
      expect(blockStarts[0].block.type).toBe('thinking');
      expect(blockStarts[0].index).toBe(0);
    }
    if (blockStarts[1]?.type === 'block_start') {
      expect(blockStarts[1].block.type).toBe('text');
      expect(blockStarts[1].index).toBe(1);
    }
    const thinkingText = events
      .filter(
        (e) =>
          e.type === 'block_delta' &&
          e.delta.type === 'thinking_delta' &&
          (e as { index: number }).index === 0,
      )
      .map((e) =>
        e.type === 'block_delta' && e.delta.type === 'thinking_delta' ? e.delta.thinking : '',
      )
      .join('');
    expect(thinkingText).toBe('Step 1: parse the question. Step 2: choose a tool.');
    const stops = events.filter((e) => e.type === 'block_stop').map((e) => e.index);
    expect(stops.sort()).toEqual([0, 1]);
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('maps content array type:"reasoning" parts (Responses API) to thinking deltas', async () => {
    const chunks = [
      new AIMessageChunk({
        content: [{ type: 'reasoning', reasoning: 'Considering options', index: 0 }],
      }),
      new AIMessageChunk({
        content: [{ type: 'reasoning', reasoning: ' carefully.', index: 0 }],
      }),
    ];
    const events = await collect(toStreamEvents(fromArray(chunks)));
    expect(events[0]?.type).toBe('block_start');
    if (events[0]?.type === 'block_start') {
      expect(events[0].block.type).toBe('thinking');
      expect(events[0].index).toBe(0);
    }
    const thinkingText = events
      .filter((e) => e.type === 'block_delta' && e.delta.type === 'thinking_delta')
      .map((e) =>
        e.type === 'block_delta' && e.delta.type === 'thinking_delta' ? e.delta.thinking : '',
      )
      .join('');
    expect(thinkingText).toBe('Considering options carefully.');
    expect(events.some((e) => e.type === 'block_stop' && e.index === 0)).toBe(true);
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('error mid-thinking: drains block_stop, then error, no done', async () => {
    async function* boom(): AsyncIterable<AIMessageChunk> {
      yield new AIMessageChunk({
        content: [{ type: 'thinking', thinking: 'partial reasoning', index: 0 }],
      });
      throw new Error('mid-thinking timeout');
    }
    const events = await collect(toStreamEvents(boom()));
    const types = events.map((e) => e.type);
    expect(types).not.toContain('done');
    expect(types).toContain('block_stop');
    expect(types[types.length - 1]).toBe('error');
    const stop = events.find((e) => e.type === 'block_stop');
    if (stop?.type === 'block_stop') expect(stop.index).toBe(0);
  });
});

describe('toStreamEvents — error path', () => {
  it('finalises and emits an error event when the upstream throws', async () => {
    async function* boom(): AsyncIterable<AIMessageChunk> {
      yield new AIMessageChunk({ content: 'partial' });
      throw new Error('upstream blew up');
    }
    const events = await collect(toStreamEvents(boom()));
    const last = events[events.length - 1]!;
    expect(last.type).toBe('error');
    if (last.type === 'error') expect(last.error.message).toBe('upstream blew up');
    expect(events.some((e) => e.type === 'block_stop')).toBe(true);
  });

  it('does NOT emit a done event on the error path (otherwise providerManager swallows the error)', async () => {
    const boomEmpty: AsyncIterable<AIMessageChunk> = {
      // eslint-disable-next-line @typescript-eslint/require-await
      [Symbol.asyncIterator](): AsyncIterator<AIMessageChunk> {
        return {
          next: async (): Promise<IteratorResult<AIMessageChunk>> => {
            throw new Error('timeout');
          },
        };
      },
    };
    const events = await collect(toStreamEvents(boomEmpty));
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(events[events.length - 1]?.type).toBe('error');
  });

  it('error after partial text: drains block_stop, then error, no done', async () => {
    async function* boomPartial(): AsyncIterable<AIMessageChunk> {
      yield new AIMessageChunk({ content: 'partial' });
      throw new Error('mid-stream timeout');
    }
    const events = await collect(toStreamEvents(boomPartial()));
    const types = events.map((e) => e.type);
    expect(types).not.toContain('done');
    expect(types).toContain('block_stop');
    expect(types[types.length - 1]).toBe('error');
  });
});
