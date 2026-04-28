import { describe, expect, it } from 'vitest';
import { createCopyNoteTool } from '@/tools/builtin/copyNote';
import { AcceptRejectController, type AcceptRejectDecision } from '@/agent/acceptRejectController';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
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
  async rename(): Promise<void> {
    /* no-op */
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

describe('copy_note tool', () => {
  it('declares id, schema, requiresConfirmation', () => {
    const tool = createCopyNoteTool({ acceptReject: new AcceptRejectController() });
    expect(tool.id).toBe('copy_note');
    expect(tool.requiresConfirmation).toBe(true);
    expect(tool.parameters).toEqual(
      expect.objectContaining({
        required: ['path', 'new_path'],
      }),
    );
  });

  it('happy path copies via vault.copy and leaves source intact', async () => {
    const vault = new FakeVault();
    vault.files.set('Foo.md', 'body');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'accept');
    const tool = createCopyNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Foo.md', new_path: 'FooCopy.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe('accept');
    expect(vault.copyCalls).toEqual([{ from: 'Foo.md', to: 'FooCopy.md' }]);
    expect(vault.files.get('Foo.md')).toBe('body');
    expect(vault.files.get('FooCopy.md')).toBe('body');
  });

  it('reject removes the new copy', async () => {
    const vault = new FakeVault();
    vault.files.set('Foo.md', 'body');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'reject');
    const tool = createCopyNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Foo.md', new_path: 'FooCopy.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe('reject');
    expect(vault.removeCalls).toEqual(['FooCopy.md']);
    expect(vault.files.has('FooCopy.md')).toBe(false);
    expect(vault.files.get('Foo.md')).toBe('body');
  });

  it('source missing returns error without copy', async () => {
    const vault = new FakeVault();
    const tool = createCopyNoteTool({ acceptReject: new AcceptRejectController() });
    const v = tool.validate({ path: 'Missing.md', new_path: 'Dup.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(false);
    expect(vault.copyCalls).toEqual([]);
  });

  it('destination existing rejects', async () => {
    const vault = new FakeVault();
    vault.files.set('Foo.md', 'a');
    vault.files.set('Bar.md', 'b');
    const tool = createCopyNoteTool({ acceptReject: new AcceptRejectController() });
    const v = tool.validate({ path: 'Foo.md', new_path: 'Bar.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(false);
    expect(vault.files.get('Bar.md')).toBe('b');
  });

  it('falls back to read+write when vault.copy missing', async () => {
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
    const tool = createCopyNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Foo.md', new_path: 'FooCopy.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault: fallback }));
    expect(result.ok).toBe(true);
    expect(vault.files.get('FooCopy.md')).toBe('body');
  });
});
