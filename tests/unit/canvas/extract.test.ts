import { describe, expect, it, vi } from 'vitest';
import { runExtractors } from '@/agent/canvas/extract';
import type { CanvasExtractorProvider } from '@/agent/canvas/extract';
import { getCanvasExtractorSystemPrompt } from '@/prompts/agent/canvas/extractPrompt';
import type { FetchedCanvasItem } from '@/agent/canvas/fetch';
import type { ProviderChatRequest, StreamEvent } from '@/providers/types';
import { createSemaphore } from '@/agent/wiki/ingest/semaphore';

function streamEvents(events: readonly StreamEvent[]): AsyncIterable<StreamEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
  };
}

function fetchedItem(ref: string, body = '# body'): FetchedCanvasItem {
  return {
    source: { kind: 'vaultPath', resolvedRef: ref, hint: { kind: 'mention', path: ref } },
    status: 'fetched',
    fetched: {
      sourceRef: ref,
      originalPath: ref,
      contentType: 'text/markdown',
      body,
      bytes: body.length,
    },
  };
}

function toolCallEvents(name: string, args: unknown): StreamEvent[] {
  return [
    { type: 'tool_call', call: { name, argsJson: JSON.stringify(args) } },
    { type: 'done' },
  ] as unknown as StreamEvent[];
}

function provider(scripts: ReadonlyArray<readonly StreamEvent[]>): {
  provider: CanvasExtractorProvider;
  calls: ProviderChatRequest[];
} {
  const calls: ProviderChatRequest[] = [];
  let i = 0;
  return {
    provider: {
      stream(req) {
        calls.push(req);
        return streamEvents(scripts[i++] ?? []);
      },
    },
    calls,
  };
}

const validOutput = (ref: string) => ({
  schemaVersion: 1,
  sourceRef: ref,
  entities: [{ tempId: 'e1', type: 'event', name: 'Conf' }],
  edges: [],
});

describe('getCanvasExtractorSystemPrompt — relevance filter', () => {
  it('embeds the user ask verbatim and includes a Relevance filter section', () => {
    const ask = 'silicon commandments casebook relations';
    const prompt = getCanvasExtractorSystemPrompt({
      entityTypes: [],
      relationTypes: [],
      originalAsk: ask,
    });
    expect(prompt).toContain('Relevance filter');
    expect(prompt).toContain('User ask:');
    expect(prompt).toContain(ask);
  });

  it('falls back to a placeholder when ask is empty', () => {
    const prompt = getCanvasExtractorSystemPrompt({
      entityTypes: [],
      relationTypes: [],
      originalAsk: '   ',
    });
    expect(prompt).toContain('User ask:');
    expect(prompt).toContain('(none provided)');
  });

  it('forbids self-loops', () => {
    const prompt = getCanvasExtractorSystemPrompt({
      entityTypes: [],
      relationTypes: [],
      originalAsk: 'x',
    });
    expect(prompt).toContain('Self-loops are not allowed');
  });
});

describe('runExtractors — relevance filter wiring', () => {
  it('threads originalAsk into the system prompt of every chunk call', async () => {
    const { provider: p, calls } = provider([
      toolCallEvents('report_extraction', validOutput('a.md')),
    ]);
    const ask = 'how do commandments map to casebook?';
    await runExtractors(
      {
        items: [fetchedItem('a.md')],
        schema: { entityTypes: [{ name: 'event', description: 'e' }], relationTypes: [] },
        originalAsk: ask,
        signal: new AbortController().signal,
      },
      { provider: p, model: () => 'qwen3' },
    );
    const sys = String(calls[0]!.messages[0]!.content);
    expect(sys).toContain(ask);
    expect(sys).toContain('Relevance filter');
  });
});

describe('runExtractors — happy path', () => {
  it('returns one ExtractorOutput keyed by sourceRef', async () => {
    const { provider: p } = provider([toolCallEvents('report_extraction', validOutput('a.md'))]);
    const result = await runExtractors(
      {
        items: [fetchedItem('a.md')],
        schema: { entityTypes: [{ name: 'event', description: 'e' }], relationTypes: [] },
        originalAsk: 'test ask',
        signal: new AbortController().signal,
      },
      { provider: p, model: () => 'qwen3' },
    );
    expect(result.outputs.size).toBe(1);
    expect(result.outputs.get('a.md')?.entities[0]!.name).toBe('Conf');
    expect(result.perSourceErrors).toEqual([]);
  });
});

describe('runExtractors — single retry on parse failure', () => {
  it('retries once with parser-error injected and succeeds', async () => {
    const bad = { schemaVersion: 1, sourceRef: 'a.md', entities: 'not-an-array', edges: [] };
    const { provider: p, calls } = provider([
      toolCallEvents('report_extraction', bad),
      toolCallEvents('report_extraction', validOutput('a.md')),
    ]);
    const result = await runExtractors(
      {
        items: [fetchedItem('a.md')],
        schema: { entityTypes: [{ name: 'event', description: 'e' }], relationTypes: [] },
        originalAsk: 'test ask',
        signal: new AbortController().signal,
      },
      { provider: p, model: () => 'qwen3' },
    );
    expect(result.outputs.size).toBe(1);
    expect(calls.length).toBe(2);
    expect(String(calls[1]!.messages.at(-1)?.content)).toMatch(/Validation error/);
  });

  it('two consecutive parse failures → extract_invalid; not in outputs', async () => {
    const bad = { schemaVersion: 1, sourceRef: 'a.md', entities: 'x', edges: [] };
    const { provider: p } = provider([
      toolCallEvents('report_extraction', bad),
      toolCallEvents('report_extraction', bad),
    ]);
    const result = await runExtractors(
      {
        items: [fetchedItem('a.md')],
        schema: { entityTypes: [], relationTypes: [] },
        originalAsk: 'test ask',
        signal: new AbortController().signal,
      },
      { provider: p, model: () => 'qwen3' },
    );
    expect(result.outputs.size).toBe(0);
    expect(result.perSourceErrors[0]?.code).toBe('extract_invalid');
  });
});

describe('runExtractors — concurrency', () => {
  it('serializes calls via source-level semaphore (extractorConcurrency = 1)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const provider2: CanvasExtractorProvider = {
      stream() {
        return {
          async *[Symbol.asyncIterator]() {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            try {
              await new Promise((r) => setTimeout(r, 1));
              yield {
                type: 'tool_call',
                call: { name: 'report_extraction', argsJson: JSON.stringify(validOutput('x')) },
              } as unknown as StreamEvent;
              inFlight -= 1;
              yield { type: 'done' } as unknown as StreamEvent;
            } finally {
              if (inFlight > 0) inFlight = Math.max(0, inFlight - 1);
            }
          },
        };
      },
    };
    const sem = createSemaphore({ maxConcurrency: 1 });
    const acquireSpy = vi.spyOn(sem, 'acquire');
    await runExtractors(
      {
        items: [fetchedItem('a'), fetchedItem('b'), fetchedItem('c')],
        schema: { entityTypes: [], relationTypes: [] },
        originalAsk: 'test ask',
        signal: new AbortController().signal,
      },
      { provider: provider2, model: () => 'qwen3', semaphoreOverride: sem },
    );
    expect(maxInFlight).toBe(1);
    expect(acquireSpy).toHaveBeenCalledTimes(3);
  });

  it('chunk-level semaphore parallelizes within one source up to chunkConcurrency', async () => {
    // Body is a 3-section markdown doc, total > 4000 tokens, so the chunker
    // emits exactly three chunks (one per section).
    const filler = 'x'.repeat(5500);
    const body = `# A\n${filler}\n# B\n${filler}\n# C\n${filler}\n`;

    let inFlight = 0;
    let maxInFlight = 0;
    const provider2: CanvasExtractorProvider = {
      stream() {
        return {
          async *[Symbol.asyncIterator]() {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            try {
              await new Promise((r) => setTimeout(r, 5));
              yield {
                type: 'tool_call',
                call: {
                  name: 'report_extraction',
                  argsJson: JSON.stringify(validOutput('big.md')),
                },
              } as unknown as StreamEvent;
              yield { type: 'done' } as unknown as StreamEvent;
            } finally {
              inFlight = Math.max(0, inFlight - 1);
            }
          },
        };
      },
    };
    const chunkSem = createSemaphore({ maxConcurrency: 2 });
    await runExtractors(
      {
        items: [fetchedItem('big.md', body)],
        schema: { entityTypes: [], relationTypes: [] },
        originalAsk: 'test ask',
        signal: new AbortController().signal,
      },
      { provider: provider2, model: () => 'qwen3', chunkSemaphoreOverride: chunkSem },
    );
    expect(maxInFlight).toBe(2);
  });
});

describe('runExtractors — multi-chunk merge', () => {
  it('extracts each chunk and merges entities by synth id', async () => {
    const filler = 'x'.repeat(8500);
    const body = `# A\n${filler}\n# B\n${filler}\n`;

    const chunkA = {
      schemaVersion: 1,
      sourceRef: 'big.md',
      entities: [
        { tempId: 'e1', type: 'event', name: 'Conf' },
        { tempId: 'e2', type: 'person', name: 'Alice' },
      ],
      edges: [{ fromTempId: 'e2', toTempId: 'e1', type: 'attended' }],
    };
    const chunkB = {
      schemaVersion: 1,
      sourceRef: 'big.md',
      entities: [
        { tempId: 'e1', type: 'event', name: 'Conf' },
        { tempId: 'e2', type: 'person', name: 'Bob' },
      ],
      edges: [{ fromTempId: 'e2', toTempId: 'e1', type: 'attended' }],
    };
    const { provider: p, calls } = provider([
      toolCallEvents('report_extraction', chunkA),
      toolCallEvents('report_extraction', chunkB),
    ]);
    const result = await runExtractors(
      {
        items: [fetchedItem('big.md', body)],
        schema: {
          entityTypes: [
            { name: 'event', description: 'e' },
            { name: 'person', description: 'p' },
          ],
          relationTypes: [{ name: 'attended', from: 'person', to: 'event', description: 'r' }],
        },
        originalAsk: 'test ask',
        signal: new AbortController().signal,
      },
      { provider: p, model: () => 'qwen3' },
    );
    expect(calls.length).toBe(2);
    const merged = result.outputs.get('big.md');
    expect(merged?.entities.map((e) => e.tempId).sort()).toEqual([
      'event::conf',
      'person::alice',
      'person::bob',
    ]);
    expect(merged?.edges.length).toBe(2);
  });

  it('logs canvas.extract.chunked when source produces > 1 chunk', async () => {
    const filler = 'x'.repeat(8500);
    const body = `# A\n${filler}\n# B\n${filler}\n`;
    const { provider: p } = provider([
      toolCallEvents('report_extraction', validOutput('big.md')),
      toolCallEvents('report_extraction', validOutput('big.md')),
    ]);
    const info = vi.fn();
    const logger = { debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() };
    await runExtractors(
      {
        items: [fetchedItem('big.md', body)],
        schema: { entityTypes: [], relationTypes: [] },
        originalAsk: 'test ask',
        signal: new AbortController().signal,
      },
      {
        provider: p,
        model: () => 'qwen3',
        logger: logger as unknown as Parameters<typeof runExtractors>[1]['logger'],
      },
    );
    expect(info).toHaveBeenCalledWith(
      'canvas.extract.chunked',
      expect.objectContaining({ ref: 'big.md', chunkCount: 2 }),
    );
  });
});

describe('runExtractors — partial chunk failure', () => {
  it('keeps merged successes, logs partial, no perSourceErrors entry', async () => {
    const filler = 'x'.repeat(5500);
    const body = `# A\n${filler}\n# B\n${filler}\n# C\n${filler}\n`;
    const ok = (name: string) => ({
      schemaVersion: 1,
      sourceRef: 'big.md',
      entities: [{ tempId: 'e1', type: 'event', name }],
      edges: [],
    });
    const bad = { schemaVersion: 1, sourceRef: 'big.md', entities: 'x', edges: [] };
    // Order is determined by runBatched + chunkConcurrency=2; both retries
    // for the failing chunk happen consecutively before resolving. Provide
    // enough scripts so each chunk has its 2 attempts available.
    const { provider: p } = provider([
      toolCallEvents('report_extraction', ok('A')),
      toolCallEvents('report_extraction', bad),
      toolCallEvents('report_extraction', bad),
      toolCallEvents('report_extraction', ok('C')),
    ]);
    const warn = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
    const chunkSem = createSemaphore({ maxConcurrency: 1 });
    const result = await runExtractors(
      {
        items: [fetchedItem('big.md', body)],
        schema: {
          entityTypes: [{ name: 'event', description: 'e' }],
          relationTypes: [],
        },
        originalAsk: 'test ask',
        signal: new AbortController().signal,
      },
      {
        provider: p,
        model: () => 'qwen3',
        chunkSemaphoreOverride: chunkSem,
        logger: logger as unknown as Parameters<typeof runExtractors>[1]['logger'],
      },
    );
    expect(result.perSourceErrors).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'canvas.extract.partial',
      expect.objectContaining({ ref: 'big.md', ok: 2, total: 3 }),
    );
    const merged = result.outputs.get('big.md');
    expect(merged?.entities.map((e) => e.name).sort()).toEqual(['A', 'C']);
  });
});

describe('runExtractors — abort', () => {
  it('pre-aborted signal: outputs empty, error code aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { provider: p } = provider([toolCallEvents('report_extraction', validOutput('a'))]);
    const result = await runExtractors(
      {
        items: [fetchedItem('a')],
        schema: { entityTypes: [], relationTypes: [] },
        originalAsk: 'test ask',
        signal: ctrl.signal,
      },
      { provider: p, model: () => 'qwen3' },
    );
    expect(result.outputs.size).toBe(0);
    expect(result.perSourceErrors[0]?.code).toBe('aborted');
  });

  it('abort mid-source after one chunk completes: no crash, source flagged aborted', async () => {
    const ctrl = new AbortController();
    const filler = 'x'.repeat(8500);
    const body = `# A\n${filler}\n# B\n${filler}\n`;

    let callIndex = 0;
    const provider2: CanvasExtractorProvider = {
      stream() {
        const idx = callIndex++;
        return {
          async *[Symbol.asyncIterator]() {
            if (idx === 0) {
              yield {
                type: 'tool_call',
                call: {
                  name: 'report_extraction',
                  argsJson: JSON.stringify(validOutput('big.md')),
                },
              } as unknown as StreamEvent;
              ctrl.abort();
              yield { type: 'done' } as unknown as StreamEvent;
              return;
            }
            yield { type: 'done' } as unknown as StreamEvent;
          },
        };
      },
    };
    const chunkSem = createSemaphore({ maxConcurrency: 1 });
    const result = await runExtractors(
      {
        items: [fetchedItem('big.md', body)],
        schema: { entityTypes: [], relationTypes: [] },
        originalAsk: 'test ask',
        signal: ctrl.signal,
      },
      { provider: provider2, model: () => 'qwen3', chunkSemaphoreOverride: chunkSem },
    );
    expect(result.perSourceErrors[0]?.code).toBe('aborted');
  });
});

describe('runExtractors — schema-scope filter', () => {
  it('drops entities whose type is not in entityTypes; drops edges that reference them', async () => {
    const off = {
      schemaVersion: 1,
      sourceRef: 'a.md',
      entities: [
        { tempId: 'e1', type: 'commandment', name: 'be-truthful' },
        { tempId: 'e2', type: 'parable', name: 'the-blind-mirror' }, // off-schema
        { tempId: 'e3', type: 'case', name: 'request-to-deceive' },
      ],
      edges: [
        { fromTempId: 'e1', toTempId: 'e3', type: 'tested_in' },
        { fromTempId: 'e1', toTempId: 'e2', type: 'illustrated_by' }, // dangling after parable drop
      ],
    };
    const { provider: p } = provider([toolCallEvents('report_extraction', off)]);
    const result = await runExtractors(
      {
        items: [fetchedItem('a.md')],
        schema: {
          entityTypes: [
            { name: 'commandment', description: 'c' },
            { name: 'case', description: 'c' },
          ],
          relationTypes: [
            { name: 'tested_in', from: 'commandment', to: 'case', description: 'r' },
            { name: 'illustrated_by', from: 'commandment', to: 'parable', description: 'r' },
          ],
        },
        originalAsk: 'commandments × cases',
        signal: new AbortController().signal,
      },
      { provider: p, model: () => 'qwen3' },
    );
    const merged = result.outputs.get('a.md')!;
    expect(merged.entities.map((e) => e.type).sort()).toEqual(['case', 'commandment']);
    expect(merged.edges.length).toBe(1);
    expect(merged.edges[0]!.type).toBe('tested_in');
  });

  it('drops edges whose type is not in relationTypes even when endpoints kept', async () => {
    const off = {
      schemaVersion: 1,
      sourceRef: 'a.md',
      entities: [
        { tempId: 'e1', type: 'commandment', name: 'a' },
        { tempId: 'e2', type: 'commandment', name: 'b' },
      ],
      edges: [{ fromTempId: 'e1', toTempId: 'e2', type: 'invented_relation' }],
    };
    const { provider: p } = provider([toolCallEvents('report_extraction', off)]);
    const result = await runExtractors(
      {
        items: [fetchedItem('a.md')],
        schema: {
          entityTypes: [{ name: 'commandment', description: 'c' }],
          relationTypes: [],
        },
        originalAsk: 'x',
        signal: new AbortController().signal,
      },
      { provider: p, model: () => 'qwen3' },
    );
    const merged = result.outputs.get('a.md')!;
    expect(merged.entities.length).toBe(2);
    expect(merged.edges.length).toBe(0);
  });
});

describe('runExtractors — entities cap', () => {
  it('entities > 100 trips Zod cap; retry path engaged', async () => {
    const bigEntities = Array.from({ length: 101 }, (_, i) => ({
      tempId: `e${i}`,
      type: 'event',
      name: `n${i}`,
    }));
    const overflow = { schemaVersion: 1, sourceRef: 'a.md', entities: bigEntities, edges: [] };
    const { provider: p, calls } = provider([
      toolCallEvents('report_extraction', overflow),
      toolCallEvents('report_extraction', validOutput('a.md')),
    ]);
    const result = await runExtractors(
      {
        items: [fetchedItem('a.md')],
        schema: { entityTypes: [{ name: 'event', description: 'e' }], relationTypes: [] },
        originalAsk: 'test ask',
        signal: new AbortController().signal,
      },
      { provider: p, model: () => 'qwen3' },
    );
    expect(result.outputs.size).toBe(1);
    expect(calls.length).toBe(2);
  });
});
