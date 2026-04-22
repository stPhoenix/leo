import { describe, expect, it } from 'vitest';
import { parseSseDataFrames } from '@/providers/sseParser';

function streamFrom(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(chunks[i]!));
      i += 1;
    },
  });
}

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('parseSseDataFrames', () => {
  it('extracts data frames split by blank lines', async () => {
    const stream = streamFrom(['data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n']);
    const frames = await collect(parseSseDataFrames(stream, new AbortController().signal));
    expect(frames).toEqual(['{"a":1}', '{"b":2}', '[DONE]']);
  });

  it('joins multi-line data within one frame', async () => {
    const stream = streamFrom(['data: line1\ndata: line2\n\n']);
    const frames = await collect(parseSseDataFrames(stream, new AbortController().signal));
    expect(frames).toEqual(['line1\nline2']);
  });

  it('handles chunks that split mid-frame', async () => {
    const stream = streamFrom(['data: {"hel', 'lo":"world"}\n', '\n']);
    const frames = await collect(parseSseDataFrames(stream, new AbortController().signal));
    expect(frames).toEqual(['{"hello":"world"}']);
  });

  it('normalises CRLF to LF', async () => {
    const stream = streamFrom(['data: a\r\n\r\ndata: b\r\n\r\n']);
    const frames = await collect(parseSseDataFrames(stream, new AbortController().signal));
    expect(frames).toEqual(['a', 'b']);
  });

  it('flushes a trailing frame without final blank line', async () => {
    const stream = streamFrom(['data: tail']);
    const frames = await collect(parseSseDataFrames(stream, new AbortController().signal));
    expect(frames).toEqual(['tail']);
  });
});
