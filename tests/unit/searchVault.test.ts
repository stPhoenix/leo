import { describe, expect, it, vi } from 'vitest';
import {
  createSearchVaultTool,
  filenameMatch,
  type SearchVaultEngine,
  type SearchVaultEngineResult,
  type SearchVaultHit,
} from '@/tools/builtin/searchVault';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { ToolCtx } from '@/tools/types';
import { makeToolCtx } from './_toolCtx';

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolCtx {
  return makeToolCtx({ thread: 't1', signal });
}

interface FakeEngine extends SearchVaultEngine {
  readonly lastArgs: { calls: Array<{ text: string; opts: unknown }> };
}

function fakeEngine(
  impl?: (
    text: string,
    opts: { tags?: readonly string[] },
  ) => Promise<SearchVaultEngineResult | readonly SearchVaultHit[]>,
): FakeEngine {
  const lastArgs: { calls: Array<{ text: string; opts: unknown }> } = { calls: [] };
  return {
    lastArgs,
    query: async (text, opts) => {
      lastArgs.calls.push({ text, opts });
      const r = impl !== undefined ? await impl(text, opts) : { hits: [] };
      return Array.isArray(r)
        ? { hits: r as readonly SearchVaultHit[] }
        : (r as SearchVaultEngineResult);
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

  it('invoke surfaces engine notice in result', async () => {
    const hits: readonly SearchVaultHit[] = [
      { path: 'welcome.md', line_start: 1, line_end: 1, score: 0 },
    ];
    const engine = fakeEngine(async () => ({ hits, notice: 'Vault is not indexed' }));
    const tool = createSearchVaultTool(engine);
    const r = await tool.invoke({ query: 'welcome' }, mkCtx());
    expect(r).toEqual({ ok: true, data: { hits, notice: 'Vault is not indexed' } });
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

class TreeVault implements VaultAdapter {
  constructor(private readonly tree: Record<string, { files: string[]; folders: string[] }>) {}
  async exists(p: string): Promise<boolean> {
    return this.tree[p] !== undefined;
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(): Promise<string> {
    return '';
  }
  async write(): Promise<void> {
    /* no-op */
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(): Promise<void> {
    /* no-op */
  }
  async list(p: string): Promise<{ files: string[]; folders: string[] }> {
    return this.tree[p] ?? { files: [], folders: [] };
  }
}

describe('filenameMatch helper', () => {
  it('returns case-insensitive basename matches across the subtree', async () => {
    const vault = new TreeVault({
      '': { files: ['Welcome.md', 'README.md'], folders: ['notes'] },
      notes: { files: ['notes/Welcome backup.md', 'notes/other.md'], folders: [] },
    });
    const hits = await filenameMatch(vault, 'welcome');
    expect(hits.map((h) => h.path).sort()).toEqual(['Welcome.md', 'notes/Welcome backup.md']);
    expect(hits.every((h) => h.score === 0)).toBe(true);
    expect(hits.every((h) => h.line_start === 1 && h.line_end === 1)).toBe(true);
  });

  it('returns empty for blank query', async () => {
    const vault = new TreeVault({ '': { files: ['a.md'], folders: [] } });
    expect(await filenameMatch(vault, '   ')).toEqual([]);
  });

  it('returns empty when no basename contains the needle', async () => {
    const vault = new TreeVault({ '': { files: ['a.md', 'b.md'], folders: [] } });
    expect(await filenameMatch(vault, 'zzz')).toEqual([]);
  });

  it('honors aborted signal by returning what was found so far', async () => {
    const vault = new TreeVault({ '': { files: ['x.md'], folders: [] } });
    const ctl = new AbortController();
    ctl.abort();
    const hits = await filenameMatch(vault, 'x', ctl.signal);
    expect(hits).toEqual([]);
  });
});
