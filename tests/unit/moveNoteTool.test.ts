import { describe, expect, it } from 'vitest';
import { createMoveNoteTool } from '@/tools/builtin/moveNote';
import { AcceptRejectController, type AcceptRejectDecision } from '@/agent/acceptRejectController';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  renameWithLinksCalls: Array<{ from: string; to: string }> = [];
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
    const data = this.files.get(from);
    if (data === undefined) throw new Error('ENOENT');
    this.files.delete(from);
    this.files.set(to, data);
  }
  async renameWithLinks(from: string, to: string): Promise<void> {
    this.renameWithLinksCalls.push({ from, to });
    await this.rename(from, to);
  }
  async remove(p: string): Promise<void> {
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

describe('move_note tool', () => {
  it('declares id and shape distinct from rename_note', () => {
    const tool = createMoveNoteTool({ acceptReject: new AcceptRejectController() });
    expect(tool.id).toBe('move_note');
    expect(tool.requiresConfirmation).toBe(true);
    expect(tool.description.toLowerCase()).toContain('folder');
  });

  it('moves to a different folder via renameWithLinks', async () => {
    const vault = new FakeVault();
    vault.files.set('Notes/Foo.md', 'body');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'accept');
    const tool = createMoveNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Notes/Foo.md', new_path: 'Archive/Foo.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe('accept');
    expect(vault.files.has('Notes/Foo.md')).toBe(false);
    expect(vault.files.get('Archive/Foo.md')).toBe('body');
    expect(vault.renameWithLinksCalls).toEqual([{ from: 'Notes/Foo.md', to: 'Archive/Foo.md' }]);
  });

  it('reject restores the original location', async () => {
    const vault = new FakeVault();
    vault.files.set('Notes/Foo.md', 'body');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'reject');
    const tool = createMoveNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Notes/Foo.md', new_path: 'Archive/Foo.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    expect(vault.files.get('Notes/Foo.md')).toBe('body');
    expect(vault.files.has('Archive/Foo.md')).toBe(false);
  });

  it('destination existing rejects', async () => {
    const vault = new FakeVault();
    vault.files.set('a.md', '1');
    vault.files.set('b.md', '2');
    const tool = createMoveNoteTool({ acceptReject: new AcceptRejectController() });
    const v = tool.validate({ path: 'a.md', new_path: 'b.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(false);
  });
});
