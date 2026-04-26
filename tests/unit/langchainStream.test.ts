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
