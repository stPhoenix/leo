import { describe, expect, it } from 'vitest';
import { createCreateNoteTool } from '@/tools/builtin/createNote';
import { createAppendToNoteTool } from '@/tools/builtin/appendToNote';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  writeCalls = 0;
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
    this.writeCalls += 1;
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

describe('create_note tool', () => {
  it('happy path writes new file via vault.write and returns bytesWritten', async () => {
    const vault = new FakeVault();
    const tool = createCreateNoteTool();
    expect(tool.requiresConfirmation).toBe(true);
    const v = tool.validate({ path: 'Notes/a.md', content: 'hello' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result).toEqual({
      ok: true,
      data: { path: 'Notes/a.md', bytesWritten: 5, before: '', after: 'hello' },
    });
    expect(vault.writeCalls).toBe(1);
    expect(vault.files.get('Notes/a.md')).toBe('hello');
  });

  it('already-exists returns {ok:false, error:"file exists"} with NO vault.write call', async () => {
    const vault = new FakeVault();
    vault.files.set('Notes/a.md', 'prior');
    const tool = createCreateNoteTool();
    const v = tool.validate({ path: 'Notes/a.md', content: 'hello' });
    if (!v.ok) throw new Error('validate failed');
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result).toEqual({ ok: false, error: 'file exists' });
    expect(vault.writeCalls).toBe(0);
  });

  it('traversal-unsafe path rejected during validate before vault contact', () => {
    const vault = new FakeVault();
    const tool = createCreateNoteTool();
    expect(tool.validate({ path: '../escape.md', content: 'x' })).toEqual({
      ok: false,
      error: 'unsafe path',
    });
    expect(vault.writeCalls).toBe(0);
  });

  it('rejects non-string content and missing args via validate', () => {
    const tool = createCreateNoteTool();
    expect(tool.validate({ path: 'a.md' }).ok).toBe(false);
    expect(tool.validate({ content: 'x' }).ok).toBe(false);
    expect(tool.validate({ path: 'a.md', content: 42 }).ok).toBe(false);
  });
});

describe('append_to_note tool', () => {
  it('happy path appends with newline separator + returns bytesAppended', async () => {
    const vault = new FakeVault();
    vault.files.set('n.md', 'hello');
    const tool = createAppendToNoteTool();
    expect(tool.requiresConfirmation).toBe(true);
    const v = tool.validate({ path: 'n.md', content: 'world' });
    if (!v.ok) throw new Error('validate');
    const r = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(r.ok).toBe(true);
    expect(vault.files.get('n.md')).toBe('hello\nworld');
    expect(vault.writeCalls).toBe(1);
  });

  it('skips leading newline when file ends with one', async () => {
    const vault = new FakeVault();
    vault.files.set('n.md', 'hello\n');
    const tool = createAppendToNoteTool();
    const v = tool.validate({ path: 'n.md', content: 'world' });
    if (!v.ok) throw new Error('validate');
    await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(vault.files.get('n.md')).toBe('hello\nworld');
  });

  it('missing file returns {ok:false, error:"not found"} with NO write', async () => {
    const vault = new FakeVault();
    const tool = createAppendToNoteTool();
    const v = tool.validate({ path: 'absent.md', content: 'x' });
    if (!v.ok) throw new Error('validate');
    const r = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(r).toEqual({ ok: false, error: 'not found' });
    expect(vault.writeCalls).toBe(0);
  });

  it('traversal rejection via validate before vault contact', () => {
    const vault = new FakeVault();
    const tool = createAppendToNoteTool();
    expect(tool.validate({ path: '../x.md', content: 'x' }).ok).toBe(false);
    expect(vault.writeCalls).toBe(0);
  });

  it('no invoke throws — platform errors surface as {ok:false}', async () => {
    const vault = new FakeVault();
    vault.files.set('n.md', 'x');
    const tool = createAppendToNoteTool();
    const v = tool.validate({ path: 'n.md', content: 'y' });
    if (!v.ok) throw new Error('validate');
    const failingVault = {
      ...vault,
      async write() {
        throw new Error('disk full');
      },
    } as unknown as VaultAdapter;
    const r = await tool.invoke(v.data, makeToolCtx({ vault: failingVault }));
    expect(r.ok).toBe(false);
  });
});
