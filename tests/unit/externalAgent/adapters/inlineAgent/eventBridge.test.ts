import { describe, expect, it } from 'vitest';
import {
  bridgeStream,
  elideArgs,
  mapAdapterError,
  mapNodeComplete,
  mapTextDelta,
  mapToolEnd,
  mapToolStart,
  ARG_ELISION_THRESHOLD,
  type BridgeChunk,
  type InlineAgentLoggerLite,
} from '@/agent/externalAgent/adapters/inlineAgent/eventBridge';

function makeLogger(): {
  logger: InlineAgentLoggerLite;
  calls: Array<{ level: string; event: string; fields: Record<string, unknown> | undefined }>;
} {
  const calls: Array<{
    level: string;
    event: string;
    fields: Record<string, unknown> | undefined;
  }> = [];
  const logger: InlineAgentLoggerLite = {
    debug: (event, fields) => calls.push({ level: 'debug', event, fields }),
    info: (event, fields) => calls.push({ level: 'info', event, fields }),
    warn: (event, fields) => calls.push({ level: 'warn', event, fields }),
    error: (event, fields) => calls.push({ level: 'error', event, fields }),
  };
  return { logger, calls };
}

async function* fromArray(items: readonly BridgeChunk[]): AsyncGenerator<BridgeChunk> {
  for (const item of items) yield item;
}

describe('elideArgs (F05, AC6, NFR-IA-05)', () => {
  it('elides string fields > 256 chars', () => {
    const long = 'a'.repeat(ARG_ELISION_THRESHOLD + 100);
    const out = elideArgs('any_tool', { foo: long, bar: 'short' });
    expect(out.foo).toEqual({ length: ARG_ELISION_THRESHOLD + 100, elided: true });
    expect(out.bar).toBe('short');
  });

  it('always elides fetch_url.body to length only', () => {
    const out = elideArgs('fetch_url', { body: 'tiny' });
    expect(out.body).toEqual({ length: 4, elided: true });
  });

  it('always elides search_web.query to length only', () => {
    const out = elideArgs('search_web', { query: 'tiny' });
    expect(out.query).toEqual({ length: 4, elided: true });
  });

  it('elides search_web.includeDomains/excludeDomains to count only', () => {
    const out = elideArgs('search_web', {
      includeDomains: ['a.com', 'b.com', 'c.com'],
      excludeDomains: ['x.com'],
    });
    expect(out.includeDomains).toEqual({ count: 3, elided: true });
    expect(out.excludeDomains).toEqual({ count: 1, elided: true });
  });

  it('elides extract_note.summary to length only', () => {
    const out = elideArgs('extract_note', { summary: 'tiny' });
    expect(out.summary).toEqual({ length: 4, elided: true });
  });

  it('redacts sensitive fetch_url headers', () => {
    const out = elideArgs('fetch_url', {
      headers: {
        Authorization: 'Bearer xyz',
        Cookie: 'secret',
        'X-Api-Key': 'hide',
        Accept: 'application/json',
      },
    });
    const hdrs = out.headers as Record<string, unknown>;
    expect(hdrs.Authorization).toBe('[redacted]');
    expect(hdrs.Cookie).toBe('[redacted]');
    expect(hdrs['X-Api-Key']).toBe('[redacted]');
    expect(hdrs.Accept).toBe('application/json');
  });
});

describe('mapToolStart (AC2)', () => {
  it('emits info-level log with elided args', () => {
    const ev = mapToolStart({
      tool: 'fetch_url',
      args: { url: 'https://x', body: 'a'.repeat(500) },
    });
    expect(ev.type).toBe('log');
    if (ev.type === 'log') {
      expect(ev.level).toBe('info');
      expect(ev.msg).toContain('"length":500');
      expect(ev.msg).not.toContain('aaaaaaaa'); // body content not in log
    }
  });
});

describe('mapToolEnd (AC3)', () => {
  it('emits debug-level log with no payload', () => {
    const ev = mapToolEnd({ tool: 'read_file', ok: false, error: 'not_found', durationMs: 5 });
    expect(ev.type).toBe('log');
    if (ev.type === 'log') {
      expect(ev.level).toBe('debug');
      expect(ev.msg).toContain('"tool":"read_file"');
      expect(ev.msg).toContain('"ok":false');
      expect(ev.msg).toContain('"error":"not_found"');
      expect(ev.msg).toContain('"durationMs":5');
    }
  });
});

describe('mapNodeComplete (AC4)', () => {
  it('emits info log with no text event for classifier', () => {
    const ev = mapNodeComplete({
      node: 'classify_task',
      durationMs: 42,
      route: 'simple',
    });
    expect(ev.type).toBe('log');
    if (ev.type === 'log') {
      expect(ev.level).toBe('info');
      expect(ev.msg).toContain('"node":"classify_task"');
      expect(ev.msg).toContain('"route":"simple"');
    }
  });

  it('includes planLength for planner', () => {
    const ev = mapNodeComplete({ node: 'planner', durationMs: 100, planLength: 5 });
    expect(ev.type).toBe('log');
    if (ev.type === 'log') expect(ev.msg).toContain('"planLength":5');
  });
});

describe('mapAdapterError (AC5)', () => {
  function errCode(ev: ReturnType<typeof mapAdapterError>): string {
    if (ev.type !== 'error') throw new Error('expected error event');
    return ev.error.code;
  }

  it('preserves {code, message} object', () => {
    const ev = mapAdapterError({ code: 'auth_failed', message: 'no key' });
    expect(ev).toEqual({ type: 'error', error: { code: 'auth_failed', message: 'no key' } });
  });

  it('classifies AbortError as aborted', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(errCode(mapAdapterError(err))).toBe('aborted');
  });

  it('classifies timeout messages as timeout', () => {
    const err = new Error('request timeout reached');
    expect(errCode(mapAdapterError(err))).toBe('timeout');
  });

  it('falls back to unknown_error for non-objects', () => {
    expect(errCode(mapAdapterError('weird'))).toBe('unknown_error');
  });
});

describe('mapTextDelta (AC1)', () => {
  it('wraps non-empty token deltas', () => {
    expect(mapTextDelta('hi')).toEqual({ type: 'text', chunk: 'hi' });
  });
});

describe('bridgeStream', () => {
  it('translates a happy-path stream of chunks', async () => {
    const { logger } = makeLogger();
    const events = [];
    for await (const ev of bridgeStream(
      fromArray([
        { kind: 'text', chunk: 'hello' },
        { kind: 'tool_start', tool: 'search_web', args: { query: 'x' } },
        { kind: 'tool_end', tool: 'search_web', ok: true, durationMs: 10 },
        { kind: 'done' },
      ]),
      { logger },
    )) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual(['text', 'log', 'log', 'done']);
  });

  it('terminates on error chunk and emits one error event (FR-IA-48)', async () => {
    const { logger } = makeLogger();
    const events = [];
    for await (const ev of bridgeStream(
      fromArray([
        { kind: 'text', chunk: 'partial' },
        { kind: 'error', error: { code: 'provider_error', message: 'down' } },
        { kind: 'text', chunk: 'late' },
      ]),
      { logger },
    )) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual(['text', 'error']);
  });

  it('caught exceptions surface as error events without re-throwing (FR-IA-48)', async () => {
    const { logger } = makeLogger();
    async function* throwing(): AsyncGenerator<BridgeChunk> {
      yield { kind: 'text', chunk: 'hi' };
      throw new Error('boom');
    }
    const events: Array<{ type: string }> = [];
    await expect(
      (async () => {
        for await (const ev of bridgeStream(throwing(), { logger })) {
          events.push(ev);
        }
      })(),
    ).resolves.toBeUndefined();
    expect(events.at(-1)?.type).toBe('error');
  });

  it('full args appear at debug level via logger, not in event payload (AC2)', async () => {
    const { logger, calls } = makeLogger();
    const events = [];
    const longBody = 'b'.repeat(500);
    for await (const ev of bridgeStream(
      fromArray([
        { kind: 'tool_start', tool: 'fetch_url', args: { url: 'https://y', body: longBody } },
        { kind: 'done' },
      ]),
      { logger },
    )) {
      events.push(ev);
    }
    const debugCall = calls.find((c) => c.level === 'debug');
    expect(debugCall).toBeDefined();
    expect(debugCall?.fields).toMatchObject({ tool: 'fetch_url', args: { body: longBody } });
    const startEvent = events.find((e) => e.type === 'log');
    expect(startEvent?.type).toBe('log');
    if (startEvent?.type === 'log') {
      expect(startEvent.msg).toContain('"length":500');
      expect(startEvent.msg).not.toContain(longBody);
    }
  });
});
