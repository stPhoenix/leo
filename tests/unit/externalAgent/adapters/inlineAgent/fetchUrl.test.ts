import { describe, expect, it, vi } from 'vitest';
import {
  createFetchUrlTool,
  checkHost,
  matchHostPattern,
  type FetchUrlConfig,
  type FetchUrlMetricsEvent,
} from '@/agent/externalAgent/adapters/inlineAgent/tools/fetchUrl';
import type { InlineAgentLoggerLite } from '@/agent/externalAgent/adapters/inlineAgent/eventBridge';

const noopLogger: InlineAgentLoggerLite = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const DEFAULT_BLOCK = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.0.0/16', '*.local'];

function makeConfig(over: Partial<FetchUrlConfig> = {}): FetchUrlConfig {
  return {
    enabled: true,
    allowlist: [],
    blocklist: [...DEFAULT_BLOCK],
    timeoutMs: 5_000,
    maxBytes: 5 * 1024 * 1024,
    followRedirects: true,
    maxRedirects: 5,
    // Legacy tests run without DNS guard so they don't depend on the network
    // or the renderer's `node:dns/promises` shape. New DNS-specific tests
    // override this and inject a stub via `dnsLookup`.
    requireDnsResolveCheck: false,
    headerDenylist: [],
    ...over,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('matchHostPattern + checkHost (F06, AC2/AC3)', () => {
  it('matches glob suffix patterns', () => {
    expect(matchHostPattern('foo.local', '*.local')).toBe(true);
    expect(matchHostPattern('local', '*.local')).toBe(false);
    expect(matchHostPattern('foo.bar.local', '*.local')).toBe(true);
  });

  it('matches CIDR ranges', () => {
    expect(matchHostPattern('169.254.0.1', '169.254.0.0/16')).toBe(true);
    expect(matchHostPattern('169.255.0.1', '169.254.0.0/16')).toBe(false);
  });

  it('matches plain hostnames', () => {
    expect(matchHostPattern('example.com', 'example.com')).toBe(true);
    expect(matchHostPattern('eXamPLE.com', 'example.com')).toBe(true);
  });

  it('checkHost: allowlist takes precedence', () => {
    const cfg = makeConfig({ allowlist: ['example.com'], blocklist: ['*.com'] });
    expect(checkHost('example.com', cfg)).toBe(false); // blocklist still filters
    expect(checkHost('example.com', { ...cfg, blocklist: [] })).toBe(true);
    expect(checkHost('other.com', cfg)).toBe(false); // allowlist excludes
  });

  it('checkHost denies default blocklist hosts', () => {
    const cfg = makeConfig();
    expect(checkHost('localhost', cfg)).toBe(false);
    expect(checkHost('127.0.0.1', cfg)).toBe(false);
    expect(checkHost('0.0.0.0', cfg)).toBe(false);
    expect(checkHost('169.254.5.10', cfg)).toBe(false);
    expect(checkHost('foo.local', cfg)).toBe(false);
    expect(checkHost('example.com', cfg)).toBe(true);
  });
});

describe('fetch_url tool (F06)', () => {
  it('AC1 — non-http(s) URL → invalid_url', async () => {
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl: vi.fn(),
    });
    const out = await tool.invoke({ url: 'file:///etc/passwd' });
    expect(out).toMatchObject({ ok: false, error: 'invalid_url' });
  });

  it('AC1 — malformed URL → invalid_url', async () => {
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
    });
    const out = await tool.invoke({ url: 'not-a-url' });
    expect(out).toMatchObject({ ok: false, error: 'invalid_url' });
  });

  it('AC2/AC3 — blocked host → blocked', async () => {
    const fetchImpl = vi.fn();
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    const out = await tool.invoke({ url: 'http://localhost/x' });
    expect(out).toMatchObject({ ok: false, error: 'blocked' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC4 — timeout → timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl: typeof fetch = (_url, init) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
        });
      const tool = createFetchUrlTool({
        config: makeConfig({ timeoutMs: 100 }),
        signal: new AbortController().signal,
        logger: noopLogger,
        fetchImpl,
      });
      const promise = tool.invoke({ url: 'https://example.com/x' });
      await vi.advanceTimersByTimeAsync(150);
      const out = await promise;
      expect(out).toMatchObject({ ok: false, error: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('AC5 — body cap → truncated:true with totalBytes', async () => {
    const big = 'x'.repeat(10_000);
    const fetchImpl: typeof fetch = async () =>
      new Response(big, { status: 200, headers: { 'content-type': 'text/plain' } });
    const metrics: FetchUrlMetricsEvent[] = [];
    const tool = createFetchUrlTool({
      config: makeConfig({ maxBytes: 5_000 }),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    tool.withMetrics((m) => metrics.push(m));
    const out = await tool.invoke({ url: 'https://example.com/big' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.truncated).toBe(true);
      expect(out.data.totalBytes).toBeGreaterThan(5_000);
      expect(typeof out.data.body).toBe('string');
      expect((out.data.body as string).length).toBeLessThanOrEqual(5_000);
    }
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({ status: 200, truncated: true, method: 'GET' });
  });

  it('AC6 — emits one metrics event with non-payload fields', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ ok: true });
    const metrics: FetchUrlMetricsEvent[] = [];
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    tool.withMetrics((m) => metrics.push(m));
    await tool.invoke({ url: 'https://example.com/api', responseFormat: 'json' });
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      url: 'https://example.com/api',
      method: 'GET',
      status: 200,
    });
    expect(metrics[0]).not.toHaveProperty('body');
    expect(metrics[0]).not.toHaveProperty('headers');
  });

  it('AC7 — redirect chain re-validates against blocklist', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u === 'https://example.com/start') {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://localhost/inside' },
        });
      }
      return jsonResponse({});
    };
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    const out = await tool.invoke({ url: 'https://example.com/start' });
    expect(out).toMatchObject({ ok: false, error: 'blocked' });
    expect(calls).toEqual(['https://example.com/start']);
  });

  it('AC7 — redirect over hop limit → http_error', async () => {
    let i = 0;
    const fetchImpl: typeof fetch = async () => {
      i += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.com/hop${i}` },
      });
    };
    const tool = createFetchUrlTool({
      config: makeConfig({ maxRedirects: 2 }),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    const out = await tool.invoke({ url: 'https://example.com/start' });
    expect(out).toMatchObject({ ok: false, error: 'http_error', status: 302 });
  });

  it('parses JSON when responseFormat=json', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ hello: 'world' });
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    const out = await tool.invoke({ url: 'https://api.example.com/x', responseFormat: 'json' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.body).toEqual({ hello: 'world' });
  });

  it('JSON parse failure → invalid_json', async () => {
    const fetchImpl: typeof fetch = async () => new Response('not json', { status: 200 });
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    const out = await tool.invoke({ url: 'https://api.example.com/x', responseFormat: 'json' });
    expect(out).toMatchObject({ ok: false, error: 'invalid_json', status: 200 });
  });

  it('AC8 — Zod parse rejects malformed input', async () => {
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl: vi.fn(),
    });
    expect(await tool.invoke({})).toMatchObject({ ok: false, error: 'invalid_args' });
    expect(await tool.invoke({ url: 'https://x', method: 'TRACE' })).toMatchObject({
      ok: false,
      error: 'invalid_args',
    });
  });

  it('HTTP 4xx/5xx → http_error with status', async () => {
    const fetchImpl: typeof fetch = async () => new Response('nope', { status: 404 });
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    const out = await tool.invoke({ url: 'https://example.com/missing' });
    expect(out).toMatchObject({ ok: false, error: 'http_error', status: 404 });
  });
});

describe('fetch_url body sanitize + untrusted handling', () => {
  it('strips zero-width chars from text body', async () => {
    const dirty = `hi\u200Bthere\u200Cworld\uFEFF`;
    const fetchImpl: typeof fetch = async () =>
      new Response(dirty, { status: 200, headers: { 'content-type': 'text/plain' } });
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    const out = await tool.invoke({ url: 'https://example.com/x' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.body).toBe('hithereworld');
  });

  it('strips <script> / <style> / <!--…--> from text/html body', async () => {
    const html =
      '<html><head><style>x{}</style></head><body>hi<script>steal()</script><!--bad--></body></html>';
    const fetchImpl: typeof fetch = async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    const out = await tool.invoke({ url: 'https://example.com/page' });
    expect(out.ok).toBe(true);
    if (out.ok && typeof out.data.body === 'string') {
      expect(out.data.body).not.toMatch(/<script/i);
      expect(out.data.body).not.toMatch(/<style/i);
      expect(out.data.body).not.toMatch(/<!--/);
      expect(out.data.body).toContain('hi');
    }
  });

  it('does not strip HTML when content-type is application/json', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('{"v":"<script>x</script>"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const tool = createFetchUrlTool({
      config: makeConfig(),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    const out = await tool.invoke({ url: 'https://example.com/api', responseFormat: 'json' });
    expect(out.ok).toBe(true);
    if (out.ok) expect((out.data.body as { v: string }).v).toBe('<script>x</script>');
  });
});

describe('fetch_url DNS-resolve guard (SSRF / DNS-rebind)', () => {
  it('rejects host that resolves to a private IP', async () => {
    const fetchImpl = vi.fn();
    const tool = createFetchUrlTool({
      config: makeConfig({ requireDnsResolveCheck: true }),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
      dnsLookup: async () => [{ address: '10.0.0.5', family: 4 }],
    });
    const out = await tool.invoke({ url: 'https://attacker.example/path' });
    expect(out).toMatchObject({ ok: false, error: 'blocked', reason: 'private_ip' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects host that resolves to cloud-metadata IP', async () => {
    const tool = createFetchUrlTool({
      config: makeConfig({ requireDnsResolveCheck: true }),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl: vi.fn(),
      dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
    });
    const out = await tool.invoke({ url: 'https://attacker.example/' });
    expect(out).toMatchObject({ ok: false, error: 'blocked', reason: 'private_ip' });
  });

  it('rejects host that resolves to IPv6 loopback', async () => {
    const tool = createFetchUrlTool({
      config: makeConfig({ requireDnsResolveCheck: true }),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl: vi.fn(),
      dnsLookup: async () => [{ address: '::1', family: 6 }],
    });
    const out = await tool.invoke({ url: 'https://attacker.example/' });
    expect(out).toMatchObject({ ok: false, error: 'blocked', reason: 'private_ip' });
  });

  it('rejects redirect target whose host resolves private', async () => {
    let i = 0;
    const fetchImpl: typeof fetch = async () => {
      i += 1;
      if (i === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/inside' },
        });
      }
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    };
    const lookup = vi.fn(async (host: string) => {
      if (host === 'public.example') return [{ address: '93.184.216.34', family: 4 }];
      if (host === 'evil.example') return [{ address: '10.0.0.1', family: 4 }];
      return [];
    });
    const tool = createFetchUrlTool({
      config: makeConfig({ requireDnsResolveCheck: true }),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
      dnsLookup: lookup,
    });
    const out = await tool.invoke({ url: 'https://public.example/start' });
    expect(out).toMatchObject({ ok: false, error: 'blocked', reason: 'private_ip' });
  });

  it('treats DNS resolve failure as fail-closed', async () => {
    const tool = createFetchUrlTool({
      config: makeConfig({ requireDnsResolveCheck: true }),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl: vi.fn(),
      dnsLookup: async () => {
        throw new Error('NXDOMAIN');
      },
    });
    const out = await tool.invoke({ url: 'https://attacker.example/' });
    expect(out).toMatchObject({ ok: false, error: 'blocked', reason: 'dns_resolve_failed' });
  });

  it('passes through to fetch when host resolves public', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('hi', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    const tool = createFetchUrlTool({
      config: makeConfig({ requireDnsResolveCheck: true }),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
      dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    const out = await tool.invoke({ url: 'https://example.com/x' });
    expect(out.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects literal IPv6 loopback URL', async () => {
    const tool = createFetchUrlTool({
      config: makeConfig({
        requireDnsResolveCheck: true,
        blocklist: [...DEFAULT_BLOCK, '::1', 'fc00::/7', 'fe80::/10'],
      }),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl: vi.fn(),
      dnsLookup: async () => {
        throw new Error('should not be called for IP literal');
      },
    });
    const out = await tool.invoke({ url: 'http://[::1]/path' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('blocked');
  });
});

describe('fetch_url outbound header denylist', () => {
  it('strips Authorization, Cookie by default', async () => {
    const seen: Headers[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      seen.push(new Headers(init?.headers));
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    };
    const tool = createFetchUrlTool({
      config: makeConfig({
        headerDenylist: ['authorization', 'cookie', 'proxy-authorization', 'set-cookie'],
      }),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    await tool.invoke({
      url: 'https://example.com/x',
      headers: { Authorization: 'Bearer secret', Cookie: 'sid=1', 'X-Allowed': 'ok' },
    });
    expect(seen).toHaveLength(1);
    const headers0 = seen[0];
    if (headers0 === undefined) throw new Error('expected captured headers');
    expect(headers0.get('authorization')).toBeNull();
    expect(headers0.get('cookie')).toBeNull();
    expect(headers0.get('x-allowed')).toBe('ok');
  });

  it('respects custom denylist override', async () => {
    const seen: Headers[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      seen.push(new Headers(init?.headers));
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    };
    const tool = createFetchUrlTool({
      config: makeConfig({ headerDenylist: ['x-secret'] }),
      signal: new AbortController().signal,
      logger: noopLogger,
      fetchImpl,
    });
    await tool.invoke({
      url: 'https://example.com/x',
      headers: { 'X-Secret': 'a', Authorization: 'Bearer ok' },
    });
    const headers0 = seen[0];
    if (headers0 === undefined) throw new Error('expected captured headers');
    expect(headers0.get('x-secret')).toBeNull();
    expect(headers0.get('authorization')).toBe('Bearer ok');
  });

  it('logs dropped header names without values', async () => {
    const logged: Array<{ msg: string; data: unknown }> = [];
    const logger = {
      ...noopLogger,
      info: (msg: string, data?: unknown) => {
        logged.push({ msg, data });
      },
    };
    const tool = createFetchUrlTool({
      config: makeConfig({ headerDenylist: ['authorization'] }),
      signal: new AbortController().signal,
      logger,
      fetchImpl: async () =>
        new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    });
    await tool.invoke({
      url: 'https://example.com/x',
      headers: { Authorization: 'Bearer leak-this-token' },
    });
    const drop = logged.find((l) => l.msg.endsWith('header-dropped'));
    expect(drop).toBeDefined();
    expect(JSON.stringify(drop?.data)).not.toContain('leak-this-token');
    expect(JSON.stringify(drop?.data)).toContain('authorization');
  });
});
