import { describe, expect, it } from 'vitest';
import { createRenameNoteTool } from '@/tools/builtin/renameNote';
import { AcceptRejectController, type AcceptRejectDecision } from '@/agent/acceptRejectController';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  renameCalls: Array<{ from: string; to: string }> = [];
  renameWithLinksCalls: Array<{ from: string; to: string }> = [];
  copyCalls: Array<{ from: string; to: string }> = [];
  removeCalls: string[] = [];
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
  async rename(from: string, to: string): Promise<void> {
    this.renameCalls.push({ from, to });
    const data = this.files.get(from);
    if (data === undefined) throw new Error('ENOENT');
    this.files.delete(from);
    this.files.set(to, data);
  }
  async renameWithLinks(from: string, to: string): Promise<void> {
    this.renameWithLinksCalls.push({ from, to });
    await this.rename(from, to);
  }
  async copy(from: string, to: string): Promise<void> {
    this.copyCalls.push({ from, to });
    const data = this.files.get(from);
    if (data === undefined) throw new Error('ENOENT');
    this.files.set(to, data);
  }
  async remove(p: string): Promise<void> {
    this.removeCalls.push(p);
    this.files.delete(p);
  }
  async list(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }
  async stat(p: string): Promise<{ mtimeMs: number; size: number } | null> {
    return this.files.has(p) ? { mtimeMs: 1, size: this.files.get(p)!.length } : null;
  }
}

function autoResolve(controller: AcceptRejectController, decision: AcceptRejectDecision): void {
  const unsub = controller.subscribe((p) => {
    if (p !== null) {
      queueMicrotask(() => {
        controller.resolve(decision);
        unsub();
      });
    }
  });
}

describe('rename_note tool', () => {
  it('declares id, description, schema, requiresConfirmation', () => {
    const tool = createRenameNoteTool({ acceptReject: new AcceptRejectController() });
    expect(tool.id).toBe('rename_note');
    expect(tool.requiresConfirmation).toBe(true);
    expect(tool.parameters).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          path: expect.any(Object),
          new_path: expect.any(Object),
        }),
        required: ['path', 'new_path'],
      }),
    );
  });

  it('happy path renames via renameWithLinks and returns accept', async () => {
    const vault = new FakeVault();
    vault.files.set('Foo.md', 'body');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'accept');
    const tool = createRenameNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Foo.md', new_path: 'Bar.md' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe('accept');
    expect(vault.renameWithLinksCalls).toEqual([{ from: 'Foo.md', to: 'Bar.md' }]);
    expect(vault.files.has('Foo.md')).toBe(false);
    expect(vault.files.get('Bar.md')).toBe('body');
  });

  it('reject reverses the rename', async () => {
    const vault = new FakeVault();
    vault.files.set('Foo.md', 'body');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'reject');
    const tool = createRenameNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Foo.md', new_path: 'Bar.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe('reject');
    expect(vault.renameWithLinksCalls).toEqual([
      { from: 'Foo.md', to: 'Bar.md' },
      { from: 'Bar.md', to: 'Foo.md' },
    ]);
    expect(vault.files.get('Foo.md')).toBe('body');
    expect(vault.files.has('Bar.md')).toBe(false);
  });

  it('source missing returns not-found error without rename', async () => {
    const vault = new FakeVault();
    const ar = new AcceptRejectController();
    const tool = createRenameNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Missing.md', new_path: 'Bar.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not found');
    expect(vault.renameWithLinksCalls).toEqual([]);
  });

  it('destination existing rejects without overwrite', async () => {
    const vault = new FakeVault();
    vault.files.set('Foo.md', 'a');
    vault.files.set('Bar.md', 'b');
    const ar = new AcceptRejectController();
    const tool = createRenameNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Foo.md', new_path: 'Bar.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('exists');
    expect(vault.files.get('Bar.md')).toBe('b');
  });

  it('falls back to rename when renameWithLinks unavailable', async () => {
    const vault = new FakeVault();
    vault.files.set('Foo.md', 'body');
    const fallback: VaultAdapter = {
      exists: vault.exists.bind(vault),
      mkdir: vault.mkdir.bind(vault),
      read: vault.read.bind(vault),
      write: vault.write.bind(vault),
      rename: vault.rename.bind(vault),
      remove: vault.remove.bind(vault),
      list: vault.list.bind(vault),
      stat: vault.stat.bind(vault),
    };
    const ar = new AcceptRejectController();
    autoResolve(ar, 'accept');
    const tool = createRenameNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Foo.md', new_path: 'Bar.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault: fallback }));
    expect(result.ok).toBe(true);
    expect(vault.renameCalls).toEqual([{ from: 'Foo.md', to: 'Bar.md' }]);
    expect(vault.renameWithLinksCalls).toEqual([]);
  });

  it('rejects same path and unsafe paths via schema', () => {
    const tool = createRenameNoteTool({ acceptReject: new AcceptRejectController() });
    expect(tool.validate({ path: 'Foo.md', new_path: 'Foo.md' }).ok).toBe(false);
    expect(tool.validate({ path: '../escape.md', new_path: 'ok.md' }).ok).toBe(false);
    expect(tool.validate({ path: 'ok.md', new_path: '/abs.md' }).ok).toBe(false);
  });

  it('aborts when signal already aborted', async () => {
    const vault = new FakeVault();
    vault.files.set('Foo.md', 'x');
    const ar = new AcceptRejectController();
    const tool = createRenameNoteTool({ acceptReject: ar });
    const ac = new AbortController();
    ac.abort();
    const v = tool.validate({ path: 'Foo.md', new_path: 'Bar.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault, signal: ac.signal }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('aborted');
  });
});
