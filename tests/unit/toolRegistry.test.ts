import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { makeToolCtx } from './_toolCtx';
import { ToolRegistry } from '@/tools/toolRegistry';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { ToolSpec } from '@/tools/types';

function makeLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    async write(r) {
      records.push(r);
    },
    async flush() {
      /* no-op */
    },
  };
  return {
    logger: new Logger({
      level: 'debug',
      sink,
      consoleImpl: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    }),
    records,
  };
}

function stubTool(
  id: string,
  overrides: Partial<ToolSpec<{ x: number }, string>> = {},
): ToolSpec<{ x: number }, string> {
  return {
    id,
    description: `${id} description`,
    schema: z.object({ x: z.number() }).strict() as unknown as z.ZodType<{ x: number }>,
    parameters: {
      type: 'object',
      properties: { x: { type: 'number' } },
      required: ['x'],
      additionalProperties: false,
    },
    requiresConfirmation: false,
    source: 'builtin',
    validate: (raw) => {
      if (raw === null || typeof raw !== 'object')
        return { ok: false, error: 'args must be object' };
      const obj = raw as Record<string, unknown>;
      if (typeof obj.x !== 'number') return { ok: false, error: 'x required' };
      return { ok: true, data: { x: obj.x } };
    },
    invoke: async (args) => ({ ok: true, data: `x=${args.x}` }),
    ...overrides,
  };
}

describe('ToolRegistry CRUD', () => {
  it('registers a tool and lookups return the spec; listFor returns full list', () => {
    const { logger } = makeLogger();
    const r = new ToolRegistry({ logger });
    const spec = stubTool('alpha');
    r.register(spec as unknown as ToolSpec<unknown, unknown>);
    expect(r.lookup('alpha')).toBe(spec);
    expect(r.listFor('t').map((s) => s.id)).toEqual(['alpha']);
  });

  it('rejects duplicate ids', () => {
    const r = new ToolRegistry();
    r.register(stubTool('x') as unknown as ToolSpec<unknown, unknown>);
    expect(() => r.register(stubTool('x') as unknown as ToolSpec<unknown, unknown>)).toThrow(
      /duplicate/,
    );
  });

  it('returns undefined for unknown lookups', () => {
    const r = new ToolRegistry();
    expect(r.lookup('nope')).toBeUndefined();
  });
});

describe('ToolRegistry serialisation to OpenAI tools array', () => {
  it('serialises every spec as {type:"function", function:{name, description, parameters}}', () => {
    const r = new ToolRegistry();
    r.register(stubTool('alpha') as unknown as ToolSpec<unknown, unknown>);
    r.register(stubTool('beta') as unknown as ToolSpec<unknown, unknown>);
    const arr = r.toOpenAITools('t');
    expect(arr).toHaveLength(2);
    expect(arr[0]).toEqual({
      type: 'function',
      function: {
        name: 'alpha',
        description: 'alpha description',
        parameters: {
          type: 'object',
          properties: { x: { type: 'number' } },
          required: ['x'],
          additionalProperties: false,
        },
      },
    });
  });
});

describe('ToolRegistry.invoke', () => {
  it('returns the tool result on happy path and logs start + ok', async () => {
    const { logger, records } = makeLogger();
    const r = new ToolRegistry({ logger });
    r.register(stubTool('alpha') as unknown as ToolSpec<unknown, unknown>);
    const result = await r.invoke('alpha', '{"x":7}', makeToolCtx({ thread: 't1' }));
    expect(result).toEqual({ ok: true, data: 'x=7' });
    const starts = records.filter((r) => r.event === 'tool.invoke.start');
    const oks = records.filter((r) => r.event === 'tool.invoke.ok');
    expect(starts.length).toBe(1);
    expect(oks.length).toBe(1);
    expect(oks[0]?.fields.toolId).toBe('alpha');
    expect(typeof oks[0]?.fields.durationMs).toBe('number');
  });

  it('returns {ok:false} on invalid JSON args', async () => {
    const r = new ToolRegistry();
    r.register(stubTool('alpha') as unknown as ToolSpec<unknown, unknown>);
    const result = await r.invoke('alpha', '{bad json', makeToolCtx({}));
    expect(result.ok).toBe(false);
  });

  it('returns {ok:false} on failed schema validation', async () => {
    const r = new ToolRegistry();
    r.register(stubTool('alpha') as unknown as ToolSpec<unknown, unknown>);
    const result = await r.invoke('alpha', '{"x":"notANumber"}', makeToolCtx({}));
    expect(result.ok).toBe(false);
  });

  it('catches invoke() exceptions and returns {ok:false}', async () => {
    const throwing = stubTool('alpha', {
      invoke: async () => {
        throw new Error('kaboom');
      },
    });
    const r = new ToolRegistry();
    r.register(throwing as unknown as ToolSpec<unknown, unknown>);
    const result = await r.invoke('alpha', '{"x":1}', makeToolCtx({}));
    expect(result).toEqual({ ok: false, error: 'kaboom' });
  });

  it('returns {ok:false} for unknown tool id', async () => {
    const r = new ToolRegistry();
    const result = await r.invoke('ghost', '{}', makeToolCtx({}));
    expect(result.ok).toBe(false);
  });

  it('non-object-rooted parameters are wrapped at register; LLM-shaped args are unwrapped on invoke', async () => {
    const r = new ToolRegistry();
    let receivedByValidate: unknown = null;
    let receivedByInvoke: unknown = null;
    const arrayRooted: ToolSpec<readonly number[], string> = {
      id: 'array-tool',
      description: 'sum a list',
      schema: z.array(z.number()) as unknown as z.ZodType<readonly number[]>,
      parameters: { type: 'array', items: { type: 'number' } },
      requiresConfirmation: false,
      source: 'builtin',
      validate: (raw) => {
        receivedByValidate = raw;
        return Array.isArray(raw)
          ? { ok: true, data: raw as readonly number[] }
          : { ok: false, error: 'not array' };
      },
      invoke: async (args) => {
        receivedByInvoke = args;
        return { ok: true, data: 'done' };
      },
    };
    r.register(arrayRooted as unknown as ToolSpec<unknown, unknown>);
    const stored = r.lookup('array-tool')!;
    expect(stored.parameters.type).toBe('object');
    expect(stored.parameters.required).toEqual(['value']);
    expect(stored.description).toContain('wrapped');
    const tools = r.toOpenAITools('t1');
    const def = tools.find((t) => t.function.name === 'array-tool')!;
    expect((def.function.parameters as { type?: string }).type).toBe('object');

    const result = await r.invoke(
      'array-tool',
      JSON.stringify({ value: [1, 2, 3] }),
      makeToolCtx({}),
    );
    expect(result.ok).toBe(true);
    expect(receivedByValidate).toEqual([1, 2, 3]);
    expect(receivedByInvoke).toEqual([1, 2, 3]);
  });

  it('oneOf-rooted parameters get type:object injected without envelope wrap', async () => {
    const r = new ToolRegistry();
    const oneOfRooted: ToolSpec<{ kind: string }, string> = {
      id: 'union-tool',
      description: 'union shape',
      schema: z.object({ kind: z.string() }) as unknown as z.ZodType<{ kind: string }>,
      parameters: {
        oneOf: [{ type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'] }],
      } as never,
      requiresConfirmation: false,
      source: 'builtin',
      validate: (raw) =>
        typeof raw === 'object' && raw !== null && 'kind' in raw
          ? { ok: true, data: raw as { kind: string } }
          : { ok: false, error: 'bad' },
      invoke: async () => ({ ok: true, data: 'ok' }),
    };
    r.register(oneOfRooted as unknown as ToolSpec<unknown, unknown>);
    const stored = r.lookup('union-tool')!;
    expect(stored.parameters.type).toBe('object');
    expect((stored.parameters as Record<string, unknown>).oneOf).toBeDefined();
    expect(stored.description).not.toContain('wrapped');
    const result = await r.invoke('union-tool', JSON.stringify({ kind: 'a' }), makeToolCtx({}));
    expect(result.ok).toBe(true);
  });
});
