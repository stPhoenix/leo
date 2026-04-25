import { describe, expect, it } from 'vitest';
import { createReadNoteTool, isSafeVaultPath } from '@/tools/builtin/readNote';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(): Promise<void> {
    /* no-op */
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
  }
  async list(_p: string): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }
}

const ctx = (vault: VaultAdapter): ReturnType<typeof makeToolCtx> =>
  makeToolCtx({ thread: 't1', vault });

describe('isSafeVaultPath', () => {
  it('rejects empty, absolute, and traversal paths', () => {
    expect(isSafeVaultPath('')).toBe(false);
    expect(isSafeVaultPath('/abs.md')).toBe(false);
    expect(isSafeVaultPath('../escape.md')).toBe(false);
    expect(isSafeVaultPath('a/../b.md')).toBe(false);
    expect(isSafeVaultPath('C:/windows.md')).toBe(false);
    expect(isSafeVaultPath('null\0byte.md')).toBe(false);
  });
  it('accepts vault-relative paths', () => {
    expect(isSafeVaultPath('note.md')).toBe(true);
    expect(isSafeVaultPath('Notes/Daily/2026-04-21.md')).toBe(true);
  });
});

describe('read_note tool — shape', () => {
  it('declares id, description, JSON-schema params, and requiresConfirmation=false', () => {
    const tool = createReadNoteTool();
    expect(tool.id).toBe('read_note');
    expect(tool.requiresConfirmation).toBe(false);
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

describe('read_note tool — invocation', () => {
  it('happy path reads content via VaultAdapter.read', async () => {
    const vault = new FakeVault();
    vault.files.set('Notes/a.md', 'body');
    const tool = createReadNoteTool();
    const validated = tool.validate({ path: 'Notes/a.md' });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, ctx(vault));
    expect(result).toEqual({
      ok: true,
      data: { path: 'Notes/a.md', content: 'body', bytes: 4 },
    });
  });

  it('rejects traversal-unsafe paths during validate before touching the vault', () => {
    const tool = createReadNoteTool();
    const result = tool.validate({ path: '../escape.md' });
    expect(result.ok).toBe(false);
  });

  it('rejects absolute / empty / malformed args via validate', () => {
    const tool = createReadNoteTool();
    expect(tool.validate({ path: '/abs.md' }).ok).toBe(false);
    expect(tool.validate({ path: '' }).ok).toBe(false);
    expect(tool.validate({}).ok).toBe(false);
    expect(tool.validate(null).ok).toBe(false);
  });

  it('returns {ok:false} when the file does not exist; no exception escapes', async () => {
    const vault = new FakeVault();
    const tool = createReadNoteTool();
    const validated = tool.validate({ path: 'missing.md' });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, ctx(vault));
    expect(result.ok).toBe(false);
  });

  it('returns {ok:false} when the note exceeds 200 KB', async () => {
    const vault = new FakeVault();
    vault.files.set('big.md', 'x'.repeat(210 * 1024));
    const tool = createReadNoteTool();
    const validated = tool.validate({ path: 'big.md' });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, ctx(vault));
    expect(result.ok).toBe(false);
  });

  it('returns {ok:false} when the ctx signal is already aborted', async () => {
    const vault = new FakeVault();
    vault.files.set('a.md', 'x');
    const tool = createReadNoteTool();
    const ac = new AbortController();
    ac.abort();
    const validated = tool.validate({ path: 'a.md' });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, makeToolCtx({ vault, signal: ac.signal }));
    expect(result.ok).toBe(false);
  });
});
