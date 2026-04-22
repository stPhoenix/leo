import { describe, expect, it, vi } from 'vitest';
import {
  createSearchVaultTool,
  type SearchVaultEngine,
  type SearchVaultHit,
} from '@/tools/builtin/searchVault';
import type { ToolCtx } from '@/tools/types';

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolCtx {
  return { thread: 't1', signal };
}

interface FakeEngine extends SearchVaultEngine {
  readonly lastArgs: { calls: Array<{ text: string; opts: unknown }> };
}

function fakeEngine(
  impl?: (text: string, opts: { tags?: readonly string[] }) => Promise<readonly SearchVaultHit[]>,
): FakeEngine {
  const lastArgs: { calls: Array<{ text: string; opts: unknown }> } = { calls: [] };
  return {
    lastArgs,
    query: async (text, opts) => {
      lastArgs.calls.push({ text, opts });
      return impl !== undefined ? impl(text, opts) : [];
    },
  };
}

describe('search_vault tool', () => {
  it('spec shape — id, confirmation false, source builtin, schema has query + optional tags', () => {
    const tool = createSearchVaultTool(fakeEngine());
    expect(tool.id).toBe('search_vault');
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.source).toBe('builtin');
    expect(tool.parameters.type).toBe('object');
    expect(tool.parameters.required).toEqual(['query']);
    expect(tool.parameters.properties?.query?.type).toBe('string');
    expect(tool.parameters.properties?.tags?.type).toBe('array');
  });

  it('validate rejects missing query', () => {
    const tool = createSearchVaultTool(fakeEngine());
    expect(tool.validate({})).toEqual({ ok: false, error: expect.any(String) });
    expect(tool.validate({ query: '' })).toEqual({ ok: false, error: expect.any(String) });
    expect(tool.validate({ query: 42 })).toEqual({ ok: false, error: expect.any(String) });
  });

  it('validate rejects non-string entries in tags', () => {
    const tool = createSearchVaultTool(fakeEngine());
    const r = tool.validate({ query: 'q', tags: ['ok', 3] });
    expect(r.ok).toBe(false);
  });

  it('validate rejects tags that is not an array', () => {
    const tool = createSearchVaultTool(fakeEngine());
    const r = tool.validate({ query: 'q', tags: 'foo' });
    expect(r.ok).toBe(false);
  });

  it('validate accepts query-only', () => {
    const tool = createSearchVaultTool(fakeEngine());
    const r = tool.validate({ query: 'hello' });
    expect(r).toEqual({ ok: true, data: { query: 'hello' } });
  });

  it('validate accepts tags:[] as well as omitted tags', () => {
    const tool = createSearchVaultTool(fakeEngine());
    expect(tool.validate({ query: 'q', tags: [] })).toEqual({
      ok: true,
      data: { query: 'q', tags: [] },
    });
  });

  it('invoke happy path — returns {ok:true,data:{hits}}', async () => {
    const hits: readonly SearchVaultHit[] = [
      { path: 'a.md', line_start: 0, line_end: 5, score: 0.9 },
    ];
    const engine = fakeEngine(async () => hits);
    const tool = createSearchVaultTool(engine);
    const r = await tool.invoke({ query: 'test', tags: ['foo'] }, mkCtx());
    expect(r).toEqual({ ok: true, data: { hits } });
    expect(engine.lastArgs.calls.length).toBe(1);
    expect(engine.lastArgs.calls[0]!.text).toBe('test');
    expect((engine.lastArgs.calls[0]!.opts as { tags: string[] }).tags).toEqual(['foo']);
  });

  it('invoke empty hits is still ok:true (never tool-error)', async () => {
    const engine = fakeEngine(async () => []);
    const tool = createSearchVaultTool(engine);
    const r = await tool.invoke({ query: 'nothing' }, mkCtx());
    expect(r).toEqual({ ok: true, data: { hits: [] } });
  });

  it('invoke threads AbortSignal from ctx.signal into engine.query', async () => {
    const ctl = new AbortController();
    const engine = fakeEngine();
    const tool = createSearchVaultTool(engine);
    await tool.invoke({ query: 'q' }, mkCtx(ctl.signal));
    const opts = engine.lastArgs.calls[0]!.opts as { signal: AbortSignal };
    expect(opts.signal).toBe(ctl.signal);
  });

  it('invoke returns {ok:false} on pre-aborted signal without calling engine', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const engine = fakeEngine();
    const spy = vi.spyOn(engine, 'query');
    const tool = createSearchVaultTool(engine);
    const r = await tool.invoke({ query: 'q' }, mkCtx(ctl.signal));
    expect(r).toEqual({ ok: false, error: 'aborted' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('invoke catches thrown exception from engine and returns {ok:false,error}', async () => {
    const engine = fakeEngine(async () => {
      throw new Error('boom');
    });
    const tool = createSearchVaultTool(engine);
    const r = await tool.invoke({ query: 'q' }, mkCtx());
    expect(r).toEqual({ ok: false, error: 'boom' });
  });

  it('invoke without tags passes tags undefined (no filter semantics)', async () => {
    const engine = fakeEngine();
    const tool = createSearchVaultTool(engine);
    await tool.invoke({ query: 'q' }, mkCtx());
    const opts = engine.lastArgs.calls[0]!.opts as Record<string, unknown>;
    expect(opts.tags).toBeUndefined();
  });
});
