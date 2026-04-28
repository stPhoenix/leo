import { describe, expect, it, vi } from 'vitest';
import { createCreateFolderTool } from '@/tools/builtin/createFolder';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly mkdirCalls: string[] = [];
  existsShouldThrow = false;
  mkdirShouldThrowOn: string | null = null;

  async exists(p: string): Promise<boolean> {
    if (this.existsShouldThrow) throw new Error('exists boom');
    return this.files.has(p) || this.folders.has(p);
  }
  async mkdir(p: string): Promise<void> {
    this.mkdirCalls.push(p);
    if (this.mkdirShouldThrowOn === p) throw new Error('mkdir boom');
    this.folders.add(p);
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
    this.folders.delete(p);
  }
  async list(_p: string): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [...this.folders] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

const ctx = (vault: VaultAdapter): ReturnType<typeof makeToolCtx> =>
  makeToolCtx({ thread: 't1', vault });

describe('create_folder tool — shape', () => {
  it('declares id, requiresConfirmation=true, builtin source, and JSON-schema params', () => {
    const tool = createCreateFolderTool();
    expect(tool.id).toBe('create_folder');
    expect(tool.requiresConfirmation).toBe(true);
    expect(tool.source).toBe('builtin');
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        path: expect.objectContaining({ type: 'string' }),
      },
      required: ['path'],
      additionalProperties: false,
    });
  });
});

describe('create_folder tool — validation', () => {
  it('rejects empty, absolute, traversal, drive-letter, and null-byte paths', () => {
    const tool = createCreateFolderTool();
    expect(tool.validate({ path: '' }).ok).toBe(false);
    expect(tool.validate({ path: '/abs' }).ok).toBe(false);
    expect(tool.validate({ path: '../escape' }).ok).toBe(false);
    expect(tool.validate({ path: 'a/../b' }).ok).toBe(false);
    expect(tool.validate({ path: 'C:/windows' }).ok).toBe(false);
    expect(tool.validate({ path: 'null\0byte' }).ok).toBe(false);
    expect(tool.validate({}).ok).toBe(false);
    expect(tool.validate(null).ok).toBe(false);
  });
  it('accepts simple + nested vault-relative paths', () => {
    const tool = createCreateFolderTool();
    expect(tool.validate({ path: 'Projects' }).ok).toBe(true);
    expect(tool.validate({ path: 'Projects/2026/Q2' }).ok).toBe(true);
  });
});

describe('create_folder tool — invocation', () => {
  it('creates a single-level folder via mkdir and reports created=true', async () => {
    const vault = new FakeVault();
    const tool = createCreateFolderTool();
    const v = tool.validate({ path: 'Projects' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const result = await tool.invoke(v.data, ctx(vault));
    expect(result).toEqual({ ok: true, data: { path: 'Projects', created: true } });
    expect(vault.mkdirCalls).toEqual(['Projects']);
    expect(vault.folders.has('Projects')).toBe(true);
  });

  it('creates intermediate parents for nested paths', async () => {
    const vault = new FakeVault();
    const tool = createCreateFolderTool();
    const v = tool.validate({ path: 'Projects/2026/Q2' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const result = await tool.invoke(v.data, ctx(vault));
    expect(result).toEqual({ ok: true, data: { path: 'Projects/2026/Q2', created: true } });
    expect(vault.mkdirCalls).toEqual(['Projects', 'Projects/2026', 'Projects/2026/Q2']);
  });

  it('is idempotent: pre-existing folder returns created=false and does not call mkdir', async () => {
    const vault = new FakeVault();
    vault.folders.add('Projects');
    const tool = createCreateFolderTool();
    const v = tool.validate({ path: 'Projects' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const result = await tool.invoke(v.data, ctx(vault));
    expect(result).toEqual({ ok: true, data: { path: 'Projects', created: false } });
    expect(vault.mkdirCalls).toEqual([]);
  });

  it('returns {ok:false, error:"aborted"} when ctx signal is already aborted', async () => {
    const vault = new FakeVault();
    const mkdirSpy = vi.spyOn(vault, 'mkdir');
    const tool = createCreateFolderTool();
    const ac = new AbortController();
    ac.abort();
    const v = tool.validate({ path: 'Projects' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault, signal: ac.signal }));
    expect(result).toEqual({ ok: false, error: 'aborted' });
    expect(mkdirSpy).not.toHaveBeenCalled();
  });

  it('surfaces adapter errors as {ok:false} without throwing', async () => {
    const vault = new FakeVault();
    vault.mkdirShouldThrowOn = 'Projects';
    const tool = createCreateFolderTool();
    const v = tool.validate({ path: 'Projects' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const result = await tool.invoke(v.data, ctx(vault));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('mkdir boom');
  });
});
