import { describe, expect, it } from 'vitest';
import {
  chunkText,
  createPiiDetectAgent,
  type PiiDetectProvider,
} from '@/agent/externalAgent/piiDetectAgent';
import type { ProviderChatRequest, StreamEvent, ToolCallRequest } from '@/providers/types';

interface ScriptedResponse {
  readonly findings?: ReadonlyArray<{
    readonly kind: string;
    readonly text: string;
    readonly suggestion: 'mask' | 'remove';
    readonly note?: string;
  }>;
  readonly throw?: Error;
  readonly extraEvents?: readonly StreamEvent[];
}

function fakeProvider(
  responses: readonly ScriptedResponse[],
  onCall?: (req: ProviderChatRequest, signal: AbortSignal) => void,
): PiiDetectProvider {
  let i = 0;
  return {
    stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
      onCall?.(req, signal);
      const response = responses[i++] ?? {};
      const events: StreamEvent[] = [];
      if (response.throw !== undefined) {
        const err = response.throw;
        return {
          [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
            return {
              next: async (): Promise<IteratorResult<StreamEvent>> => {
                throw err;
              },
            };
          },
        };
      }
      if (response.extraEvents !== undefined) events.push(...response.extraEvents);
      if (response.findings !== undefined) {
        const tc: ToolCallRequest = {
          id: `tc-${i}`,
          name: 'report_findings',
          argsJson: JSON.stringify({ findings: response.findings }),
        };
        events.push({ type: 'tool_call', call: tc });
      }
      events.push({ type: 'done' });
      return {
        [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
          let j = 0;
          return {
            next: async (): Promise<IteratorResult<StreamEvent>> => {
              if (signal.aborted) return { value: undefined as unknown as StreamEvent, done: true };
              if (j >= events.length)
                return { value: undefined as unknown as StreamEvent, done: true };
              const value = events[j++] as StreamEvent;
              return { value, done: false };
            },
          };
        },
      };
    },
  };
}

describe('createPiiDetectAgent', () => {
  it('returns empty array on empty input', async () => {
    const agent = createPiiDetectAgent({
      provider: fakeProvider([]),
      model: () => 'm',
    });
    const out = await agent.detect('   \n  ', new AbortController().signal);
    expect(out).toEqual([]);
  });

  it('parses report_findings tool call and locates substring', async () => {
    const agent = createPiiDetectAgent({
      provider: fakeProvider([
        {
          findings: [{ kind: 'email', text: 'jane@x.com', suggestion: 'mask' }],
        },
      ]),
      model: () => 'm',
    });
    const text = 'send a copy to jane@x.com please';
    const out = await agent.detect(text, new AbortController().signal);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('email');
    expect(out[0]?.start).toBe(text.indexOf('jane@x.com'));
    expect(out[0]?.end).toBe(text.indexOf('jane@x.com') + 'jane@x.com'.length);
    expect(out[0]?.suggestion).toBe('mask');
    expect(out[0]?.sample).toBe('jane@x.com');
  });

  it('reports every occurrence when text appears multiple times', async () => {
    const agent = createPiiDetectAgent({
      provider: fakeProvider([
        {
          findings: [{ kind: 'email', text: 'a@x.com', suggestion: 'mask' }],
        },
      ]),
      model: () => 'm',
    });
    const text = 'a@x.com and a@x.com again';
    const out = await agent.detect(text, new AbortController().signal);
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.start)).toEqual([0, text.indexOf('a@x.com', 1)]);
  });

  it('drops findings whose text is not present in the input (hallucination guard)', async () => {
    const agent = createPiiDetectAgent({
      provider: fakeProvider([
        {
          findings: [
            { kind: 'email', text: 'real@x.com', suggestion: 'mask' },
            { kind: 'apiKey', text: 'AKIAFAKE-not-present', suggestion: 'remove' },
          ],
        },
      ]),
      model: () => 'm',
    });
    const text = 'mail real@x.com';
    const out = await agent.detect(text, new AbortController().signal);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('email');
  });

  it('throws pii_detect_invalid_tool when no tool call returned', async () => {
    const agent = createPiiDetectAgent({
      provider: fakeProvider([{}]),
      model: () => 'm',
    });
    await expect(agent.detect('foo', new AbortController().signal)).rejects.toThrow(
      /pii_detect_invalid_tool/,
    );
  });

  it('throws pii_detect_invalid_tool on schema-invalid payload', async () => {
    const agent = createPiiDetectAgent({
      provider: fakeProvider([
        {
          findings: [
            // missing suggestion
            { kind: 'email', text: 'a@x.com' } as unknown as {
              kind: string;
              text: string;
              suggestion: 'mask' | 'remove';
            },
          ],
        },
      ]),
      model: () => 'm',
    });
    await expect(agent.detect('hi a@x.com', new AbortController().signal)).rejects.toThrow(
      /pii_detect_invalid_tool/,
    );
  });

  it('parses streaming block_start/block_delta/block_stop tool_use events', async () => {
    const text = 'mail j@x.com';
    const json = JSON.stringify({
      findings: [{ kind: 'email', text: 'j@x.com', suggestion: 'mask' }],
    });
    const provider: PiiDetectProvider = {
      stream(): AsyncIterable<StreamEvent> {
        const events: StreamEvent[] = [
          {
            type: 'block_start',
            index: 0,
            block: { type: 'tool_use', id: 'tc-1', name: 'report_findings' },
          },
          {
            type: 'block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: json },
          },
          { type: 'block_stop', index: 0 },
          { type: 'done' },
        ];
        return {
          [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
            let j = 0;
            return {
              next: async (): Promise<IteratorResult<StreamEvent>> => {
                if (j >= events.length) {
                  return { value: undefined as unknown as StreamEvent, done: true };
                }
                return { value: events[j++] as StreamEvent, done: false };
              },
            };
          },
        };
      },
    };
    const agent = createPiiDetectAgent({ provider, model: () => 'm' });
    const out = await agent.detect(text, new AbortController().signal);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('email');
  });

  it('honours abort signal between chunks', async () => {
    const ac = new AbortController();
    const agent = createPiiDetectAgent({
      provider: fakeProvider([{ findings: [] }]),
      model: () => 'm',
    });
    ac.abort();
    const out = await agent.detect('text', ac.signal);
    expect(out).toEqual([]);
  });

  it('chunks long text and aggregates findings from each chunk', async () => {
    const long =
      'a'.repeat(800) + ' first@x.com ' + 'b'.repeat(800) + ' second@x.com ' + 'c'.repeat(200);
    const agent = createPiiDetectAgent({
      provider: fakeProvider([
        { findings: [{ kind: 'email', text: 'first@x.com', suggestion: 'mask' }] },
        { findings: [{ kind: 'email', text: 'second@x.com', suggestion: 'mask' }] },
      ]),
      model: () => 'm',
      chunkBudgetChars: 1000,
      chunkOverlapChars: 64,
      maxParallelChunks: 2,
    });
    const out = await agent.detect(long, new AbortController().signal);
    const kinds = out.map((f) => `${f.kind}:${long.slice(f.start, f.end)}`);
    expect(kinds).toContain('email:first@x.com');
    expect(kinds).toContain('email:second@x.com');
    expect(out).toHaveLength(2);
  });

  it('dedupes overlapping reports across chunks (overlap window)', async () => {
    const text = 'pad ' + 'x'.repeat(700) + ' edge@x.com ' + 'y'.repeat(280);
    const agent = createPiiDetectAgent({
      provider: fakeProvider([
        { findings: [{ kind: 'email', text: 'edge@x.com', suggestion: 'mask' }] },
        { findings: [{ kind: 'email', text: 'edge@x.com', suggestion: 'mask' }] },
      ]),
      model: () => 'm',
      chunkBudgetChars: 800,
      chunkOverlapChars: 256,
    });
    const out = await agent.detect(text, new AbortController().signal);
    expect(out.filter((f) => f.kind === 'email')).toHaveLength(1);
  });

  it('passes the same abort signal through to the provider', async () => {
    const seenSignals: AbortSignal[] = [];
    const agent = createPiiDetectAgent({
      provider: fakeProvider([{ findings: [] }], (_req, signal) => {
        seenSignals.push(signal);
      }),
      model: () => 'm',
    });
    const ac = new AbortController();
    await agent.detect('hello', ac.signal);
    expect(seenSignals[0]).toBe(ac.signal);
  });
});

describe('chunkText', () => {
  it('returns single chunk when text fits in budget', () => {
    const out = chunkText('short text', 100, 16);
    expect(out).toHaveLength(1);
    expect(out[0]?.offset).toBe(0);
  });

  it('splits long text and overlaps subsequent chunks', () => {
    const text = 'a'.repeat(2500);
    const out = chunkText(text, 1000, 100);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0]?.offset).toBe(0);
    expect(out[1]?.offset).toBeLessThan(1000);
  });

  it('prefers paragraph / sentence boundary over hard cut', () => {
    const para = 'sentence one. sentence two.\n\nnew paragraph here.';
    const text = para.repeat(50);
    const out = chunkText(text, 200, 16);
    for (const c of out.slice(0, -1)) {
      const tail = c.text.slice(-3);
      expect(/[.\n]/.test(tail)).toBe(true);
    }
  });
});
