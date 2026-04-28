import { describe, expect, it, vi } from 'vitest';
import {
  createSearchWebTool,
  type SearchWebConfig,
  type SearchWebMetricsEvent,
} from '@/agent/externalAgent/adapters/inlineAgent/tools/searchWeb';
import type { InlineAgentLoggerLite } from '@/agent/externalAgent/adapters/inlineAgent/eventBridge';

interface CapturedLog {
  level: string;
  event: string;
  fields: Record<string, unknown> | undefined;
}

function makeLogger(): { logger: InlineAgentLoggerLite; calls: CapturedLog[] } {
  const calls: CapturedLog[] = [];
  const logger: InlineAgentLoggerLite = {
    debug: (event, fields) => calls.push({ level: 'debug', event, fields }),
    info: (event, fields) => calls.push({ level: 'info', event, fields }),
    warn: (event, fields) => calls.push({ level: 'warn', event, fields }),
    error: (event, fields) => calls.push({ level: 'error', event, fields }),
  };
  return { logger, calls };
}

function makeConfig(over: Partial<SearchWebConfig> = {}): SearchWebConfig {
  return {
    enabled: true,
    apiKey: 'tav-key-123',
    defaultMaxResults: 5,
    defaultSearchDepth: 'basic',
    defaultTopic: 'general',
    includeAnswer: true,
    timeoutMs: 5_000,
    maxBytes: 256 * 1024,
    endpoint: 'https://api.tavily.com/search',
    ...over,
  };
}

const HAPPY_PAYLOAD = {
  answer: 'World is round.',
  results: [
    {
      title: 'Wikipedia: Earth',
      url: 'https://en.wikipedia.org/wiki/Earth',
      content: 'Earth content',
      score: 0.9,
      raw_content: 'should be dropped',
    },
    {
      title: 'NASA',
      url: 'https://nasa.gov/earth',
      content: 'NASA content',
      score: 0.8,
    },
  ],
  images: ['should-be-dropped'],
};

describe('search_web tool (F07)', () => {
  it('AC1 — query length 1..400 enforced (Zod boundary)', async () => {
    const { logger } = makeLogger();
    const tool = createSearchWebTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger,
      fetchImpl: vi.fn(),
    });
    expect(await tool.invoke({ query: '' })).toMatchObject({ ok: false, error: 'invalid_args' });
    expect(await tool.invoke({ query: 'x'.repeat(401) })).toMatchObject({
      ok: false,
      error: 'invalid_args',
    });
  });

  it('AC2 — missing apiKey → not_configured + one-shot warn', async () => {
    const { logger, calls } = makeLogger();
    const tool = createSearchWebTool({
      config: makeConfig({ apiKey: '' }),
      signal: new AbortController().signal,
      logger,
      fetchImpl: vi.fn(),
    });
    expect(await tool.invoke({ query: 'a' })).toMatchObject({ ok: false, error: 'not_configured' });
    expect(await tool.invoke({ query: 'b' })).toMatchObject({ ok: false, error: 'not_configured' });
    const warns = calls.filter((c) => c.level === 'warn' && c.event.includes('api-key-missing'));
    expect(warns).toHaveLength(1);
  });

  it('AC4 — POST body forces include_raw_content/images false; query/depth carried', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body.include_raw_content).toBe(false);
      expect(body.include_images).toBe(false);
      expect(body.api_key).toBe('tav-key-123');
      expect(body.query).toBe('hello');
      expect(body.search_depth).toBe('advanced');
      return new Response(JSON.stringify(HAPPY_PAYLOAD), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const { logger } = makeLogger();
    const tool = createSearchWebTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await tool.invoke({ query: 'hello', searchDepth: 'advanced' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.answer).toBe('World is round.');
      expect(out.data.results).toHaveLength(2);
      expect(out.data.results[0]).toMatchObject({ url: 'https://en.wikipedia.org/wiki/Earth' });
      // raw_content / images dropped
      expect(
        (out.data.results[0] as unknown as Record<string, unknown>).raw_content,
      ).toBeUndefined();
    }
  });

  it('AC5 — body > maxBytes → too_large', async () => {
    const big = JSON.stringify({
      results: Array.from({ length: 1000 }, () => ({
        title: 'a'.repeat(2000),
        url: 'https://x',
        content: 'a'.repeat(500),
        score: 0.1,
      })),
    });
    const fetchImpl: typeof fetch = async () =>
      new Response(big, { status: 200, headers: { 'content-type': 'application/json' } });
    const { logger } = makeLogger();
    const tool = createSearchWebTool({
      config: makeConfig({ maxBytes: 100 }),
      signal: new AbortController().signal,
      logger,
      fetchImpl,
    });
    expect(await tool.invoke({ query: 'big' })).toMatchObject({ ok: false, error: 'too_large' });
  });

  it.each([
    [401, 'auth_failed'],
    [403, 'auth_failed'],
    [429, 'rate_limited'],
    [503, 'upstream_error'],
    [418, 'http_error'],
  ])('AC6 — status %i → %s', async (status, mapped) => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'x' }), { status });
    const { logger } = makeLogger();
    const tool = createSearchWebTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger,
      fetchImpl,
    });
    const out = await tool.invoke({ query: 'x' });
    expect(out).toMatchObject({ ok: false, error: mapped, status });
  });

  it('AC7 — raw_content/images dropped from results', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(HAPPY_PAYLOAD), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const { logger } = makeLogger();
    const tool = createSearchWebTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger,
      fetchImpl,
    });
    const out = await tool.invoke({ query: 'x' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      for (const r of out.data.results) {
        expect((r as unknown as Record<string, unknown>).raw_content).toBeUndefined();
      }
      expect((out.data as Record<string, unknown>).images).toBeUndefined();
    }
  });

  it('AC8 — metrics event has lengths/counts only — no raw query/answer/urls', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(HAPPY_PAYLOAD), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const metrics: SearchWebMetricsEvent[] = [];
    const { logger } = makeLogger();
    const tool = createSearchWebTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger,
      fetchImpl,
    });
    tool.withMetrics((m) => metrics.push(m));
    await tool.invoke({ query: 'a special phrase' });
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      queryLength: 'a special phrase'.length,
      maxResults: 5,
      depth: 'basic',
      status: 200,
      resultCount: 2,
    });
    expect(metrics[0]).not.toHaveProperty('query');
    expect(metrics[0]).not.toHaveProperty('answer');
  });

  it('AC9 — abort signal triggers timeout', async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
      });
    const { logger } = makeLogger();
    const ac = new AbortController();
    const tool = createSearchWebTool({
      config: makeConfig({ timeoutMs: 60_000 }),
      signal: ac.signal,
      logger,
      fetchImpl,
    });
    const promise = tool.invoke({ query: 'slow' });
    ac.abort();
    expect(await promise).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('strips zero-width chars from Tavily title / content / answer', async () => {
    const dirty = {
      answer: `top\u200Bline`,
      results: [
        {
          title: `T\u200Bitle`,
          url: 'https://x.example/1',
          content: `con\u200Ctent`,
          score: 0.5,
        },
      ],
    };
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(dirty), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const { logger } = makeLogger();
    const tool = createSearchWebTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger,
      fetchImpl,
    });
    const out = await tool.invoke({ query: 'q' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.answer).toBe('topline');
      const row0 = out.data.results[0];
      if (row0 === undefined) throw new Error('expected one result');
      expect(row0.title).toBe('Title');
      expect(row0.content).toBe('content');
    }
  });
});
