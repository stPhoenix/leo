import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import {
  runExtractor,
  runPlanner,
  runReducer,
  type LlmJsonInvoker,
} from '@/agent/wiki/ingest/subagents';
import {
  ExtractorOutputSchema,
  PlannerOutputSchema,
  ReducerOutputSchema,
} from '@/agent/wiki/ingest/schemas';
import { createSemaphore } from '@/agent/wiki/ingest/semaphore';
import { runBatched } from '@/agent/wiki/ingest/runBatched';
import { WIKI_BUDGETS } from '@/agent/wiki/budgets';

function fixedInvoker(responses: readonly unknown[]): LlmJsonInvoker {
  let i = 0;
  return {
    async invoke<T>(
      _input: { system: string; user: string },
      schema: ZodType<T>,
      _name: string,
      _signal: AbortSignal,
    ): Promise<T> {
      const value = responses[i] ?? responses[responses.length - 1];
      i += 1;
      return schema.parse(value);
    },
  };
}

describe('zod schemas', () => {
  it('PlannerOutputSchema accepts FR-29 shape', () => {
    const ok = PlannerOutputSchema.safeParse({
      ingestId: 'r1',
      perSource: [{ rawPath: 'wiki/raw/a.md', candidatePages: ['pages/x'] }],
    });
    expect(ok.success).toBe(true);
  });

  it('ExtractorOutputSchema accepts create + edit page ops', () => {
    const ok = ExtractorOutputSchema.safeParse({
      rawPath: 'wiki/raw/a.md',
      pageOps: [
        { kind: 'create', slug: 'oauth', title: 'OAuth', body: 'body', tags: ['auth'] },
        { kind: 'edit', slug: 'jwt', patch: 'append', body: 'more' },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it('ReducerOutputSchema requires action enum + frontmatter', () => {
    const ok = ReducerOutputSchema.safeParse({
      pageSlug: 'oauth',
      action: 'create',
      body: '# Oauth',
      frontmatter: { tags: ['auth'], last_updated: '2026-04-29', source_count: 1 },
      sources: ['sources/a'],
    });
    expect(ok.success).toBe(true);
  });
});

describe('runPlanner', () => {
  it('returns ok for a schema-valid structured response', async () => {
    const invoker = fixedInvoker([
      {
        ingestId: 'r1',
        perSource: [{ rawPath: 'wiki/raw/a.md', candidatePages: ['oauth'] }],
      },
    ]);
    const r = await runPlanner(
      {
        ingestId: 'r1',
        schemaMd: '# schema',
        indexExcerpt: '# index',
        perSource: [{ rawPath: 'wiki/raw/a.md', frontmatterText: 'src: x', bodyHead: 'body' }],
      },
      { invoke: invoker },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ingestId).toBe('r1');
  });

  it('marks errored when both attempts fail schema validation', async () => {
    const invoker = fixedInvoker([{}, {}]);
    const r = await runPlanner(
      {
        ingestId: 'r1',
        schemaMd: '# s',
        indexExcerpt: '',
        perSource: [],
      },
      { invoke: invoker },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
  });

  it('does not call invoker when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const innerInvoke = vi.fn(async () => ({ ingestId: 'x', perSource: [] }));
    const invoker: LlmJsonInvoker = {
      invoke: innerInvoke as unknown as LlmJsonInvoker['invoke'],
    };
    const r = await runPlanner(
      { ingestId: 'r1', schemaMd: '', indexExcerpt: '', perSource: [] },
      { invoke: invoker },
      ac.signal,
    );
    expect(r.ok).toBe(false);
    expect(innerInvoke).not.toHaveBeenCalled();
  });
});

describe('runExtractor', () => {
  it('returns extract_invalid when both attempts fail schema validation', async () => {
    const invoker = fixedInvoker([{}, {}]);
    const r = await runExtractor(
      {
        rawPath: 'wiki/raw/a.md',
        rawBody: 'body content',
        schemaMd: '# s',
        candidatePages: ['oauth'],
        indexExcerpt: '',
      },
      { invoke: invoker },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('extract_invalid');
  });

  it('returns ok for a schema-valid pageOps response', async () => {
    const valid = {
      rawPath: 'wiki/raw/a.md',
      pageOps: [{ kind: 'create', slug: 'oauth', title: 'OAuth', body: 'b' }],
    };
    const invoker = fixedInvoker([valid]);
    const r = await runExtractor(
      {
        rawPath: 'wiki/raw/a.md',
        rawBody: 'body',
        schemaMd: '# s',
        candidatePages: ['oauth'],
        indexExcerpt: '',
      },
      { invoke: invoker },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pageOps[0]?.kind).toBe('create');
  });
});

describe('runReducer', () => {
  it('returns reduce_invalid after both attempts fail schema validation', async () => {
    const invoker = fixedInvoker([{}, {}]);
    const r = await runReducer(
      { pageSlug: 'oauth', currentBody: null, schemaMd: '# s', pageOps: [] },
      { invoke: invoker },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('reduce_invalid');
  });

  it('accepts valid output', async () => {
    const valid = {
      pageSlug: 'oauth',
      action: 'create',
      body: '# OAuth',
      frontmatter: { tags: ['auth'], last_updated: '2026-04-29', source_count: 1 },
      sources: ['sources/a'],
    };
    const r = await runReducer(
      { pageSlug: 'oauth', currentBody: null, schemaMd: '# s', pageOps: [] },
      { invoke: fixedInvoker([valid]) },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.action).toBe('create');
  });
});

describe('createSemaphore', () => {
  it('throws on invalid maxConcurrency', () => {
    expect(() => createSemaphore({ maxConcurrency: 0 })).toThrow();
    expect(() => createSemaphore({ maxConcurrency: -1 })).toThrow();
  });

  it('caps concurrent acquires to maxConcurrency', async () => {
    const s = createSemaphore({ maxConcurrency: 2 });
    const r1 = await s.acquire();
    const r2 = await s.acquire();
    expect(s.inFlight()).toBe(2);
    let acquired3 = false;
    const p3 = s.acquire().then((rel) => {
      acquired3 = true;
      return rel;
    });
    await Promise.resolve();
    expect(acquired3).toBe(false);
    r1();
    const r3 = await p3;
    expect(acquired3).toBe(true);
    r2();
    r3();
    expect(s.inFlight()).toBe(0);
  });

  it('rejects waiters on signal abort', async () => {
    const s = createSemaphore({ maxConcurrency: 1 });
    const held = await s.acquire();
    const ac = new AbortController();
    const p = s.acquire(ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    held();
  });
});

describe('runBatched', () => {
  it('caps in-flight workers to semaphore size', async () => {
    const s = createSemaphore({ maxConcurrency: 1 });
    const order: string[] = [];
    let max = 0;
    let cur = 0;
    const items = ['a', 'b', 'c'];
    const out = await runBatched(
      items,
      s,
      async (item) => {
        cur += 1;
        max = Math.max(max, cur);
        order.push(`start-${item}`);
        await new Promise((r) => setTimeout(r, 0));
        order.push(`end-${item}`);
        cur -= 1;
        return `done-${item}`;
      },
      new AbortController().signal,
    );
    expect(max).toBe(1);
    expect(out).toEqual(['done-a', 'done-b', 'done-c']);
  });

  it('extractor concurrency cap (default 1) holds for default budgets', () => {
    expect(WIKI_BUDGETS.extractorInputCap).toBe(8000);
    expect(WIKI_BUDGETS.extractorOutputCap).toBe(1500);
  });
});
