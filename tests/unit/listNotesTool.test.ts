import { describe, expect, it } from 'vitest';
import { createListNotesTool } from '@/tools/builtin/listNotes';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

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

const ctx = (vault: VaultAdapter): ReturnType<typeof makeToolCtx> =>
  makeToolCtx({ thread: 't1', vault });

describe('list_notes tool — shape', () => {
  it('declares id, requiresConfirmation=false, builtin source', () => {
    const tool = createListNotesTool();
    expect(tool.id).toBe('list_notes');
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.source).toBe('builtin');
    expect(tool.parameters.type).toBe('object');
    expect(tool.parameters.required ?? []).toEqual([]);
    expect(tool.parameters.properties?.path?.type).toBe('string');
    expect(tool.parameters.properties?.recursive?.type).toBe('boolean');
  });
});

describe('list_notes tool — validation', () => {
  it('rejects unsafe paths', () => {
    const tool = createListNotesTool();
    expect(tool.validate({ path: '/abs' }).ok).toBe(false);
    expect(tool.validate({ path: '../up' }).ok).toBe(false);
    expect(tool.validate({ path: 'a/../b' }).ok).toBe(false);
  });

  it('accepts empty / omitted / safe paths', () => {
    const tool = createListNotesTool();
    expect(tool.validate({}).ok).toBe(true);
    expect(tool.validate({ path: '' }).ok).toBe(true);
    expect(tool.validate({ path: 'Notes' }).ok).toBe(true);
    expect(tool.validate({ path: 'Projects/2026', recursive: true }).ok).toBe(true);
  });

  it('rejects unknown extra properties', () => {
    const tool = createListNotesTool();
    expect(tool.validate({ path: 'x', extra: 1 }).ok).toBe(false);
  });
});

describe('list_notes tool — invocation', () => {
  it('lists root when path omitted', async () => {
    const vault = new TreeVault({
      '': { files: ['Welcome.md', 'README.md'], folders: ['Notes'] },
    });
    const tool = createListNotesTool();
    const v = tool.validate({});
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const r = await tool.invoke(v.data, ctx(vault));
    expect(r).toEqual({
      ok: true,
      data: { path: '', files: ['Welcome.md', 'README.md'], folders: ['Notes'] },
    });
  });

  it('lists immediate children only by default', async () => {
    const vault = new TreeVault({
      '': { files: ['top.md'], folders: ['sub'] },
      sub: { files: ['sub/inner.md'], folders: [] },
    });
    const tool = createListNotesTool();
    const r = await tool.invoke({}, ctx(vault));
    expect(r).toEqual({ ok: true, data: { path: '', files: ['top.md'], folders: ['sub'] } });
  });

  it('walks subtree when recursive=true', async () => {
    const vault = new TreeVault({
      '': { files: ['a.md'], folders: ['sub'] },
      sub: { files: ['sub/b.md'], folders: ['sub/deep'] },
      'sub/deep': { files: ['sub/deep/c.md'], folders: [] },
    });
    const tool = createListNotesTool();
    const r = await tool.invoke({ recursive: true }, ctx(vault));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.data.files].sort()).toEqual(['a.md', 'sub/b.md', 'sub/deep/c.md']);
    expect([...r.data.folders].sort()).toEqual(['sub', 'sub/deep']);
  });

  it('errors when non-empty path does not exist', async () => {
    const vault = new TreeVault({ '': { files: [], folders: [] } });
    const tool = createListNotesTool();
    const r = await tool.invoke({ path: 'missing' }, ctx(vault));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('folder not found');
  });

  it('returns {ok:false, error:"aborted"} on pre-aborted signal', async () => {
    const vault = new TreeVault({ '': { files: [], folders: [] } });
    const tool = createListNotesTool();
    const ac = new AbortController();
    ac.abort();
    const r = await tool.invoke({}, makeToolCtx({ vault, signal: ac.signal }));
    expect(r).toEqual({ ok: false, error: 'aborted' });
  });
});
