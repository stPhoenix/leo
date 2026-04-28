import { describe, expect, it } from 'vitest';
import { createDeleteFolderTool } from '@/tools/builtin/deleteFolder';
import { AcceptRejectController, type AcceptRejectDecision } from '@/agent/acceptRejectController';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  readonly folders = new Set<string>();
  readonly files = new Map<string, string>();
  rmdirCalls: string[] = [];

  seedFolder(path: string): void {
    this.folders.add(path);
  }

  async exists(p: string): Promise<boolean> {
    return this.folders.has(p) || this.files.has(p);
  }
  async mkdir(p: string): Promise<void> {
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
  }
  async rmdir(p: string): Promise<void> {
    this.rmdirCalls.push(p);
    this.folders.delete(p);
  }
  async list(p: string): Promise<{ files: string[]; folders: string[] }> {
    if (this.files.has(p) && !this.folders.has(p)) {
      throw new Error('ENOTDIR');
    }
    const prefix = p.endsWith('/') ? p : `${p}/`;
    const files: string[] = [];
    const folders: string[] = [];
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length);
        if (!rest.includes('/')) files.push(f);
      }
    }
    for (const f of this.folders) {
      if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length);
        if (rest.length > 0 && !rest.includes('/')) folders.push(f);
      }
    }
    return { files, folders };
  }
  async stat(): Promise<{ mtimeMs: number; size: number } | null> {
    return null;
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

describe('delete_folder tool', () => {
  it('declares id, schema, requiresConfirmation', () => {
    const tool = createDeleteFolderTool({ acceptReject: new AcceptRejectController() });
    expect(tool.id).toBe('delete_folder');
    expect(tool.requiresConfirmation).toBe(true);
    expect(tool.parameters).toEqual(
      expect.objectContaining({
        required: ['path'],
      }),
    );
  });

  it('rejects unsafe paths via schema', () => {
    const tool = createDeleteFolderTool({ acceptReject: new AcceptRejectController() });
    expect(tool.validate({ path: '../escape' }).ok).toBe(false);
    expect(tool.validate({ path: '/abs' }).ok).toBe(false);
    expect(tool.validate({ path: '' }).ok).toBe(false);
  });

  it('returns folder not found for missing path', async () => {
    const vault = new FakeVault();
    const tool = createDeleteFolderTool({ acceptReject: new AcceptRejectController() });
    const v = tool.validate({ path: 'Missing' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('folder not found');
    expect(vault.rmdirCalls).toEqual([]);
  });

  it('returns folder not empty when files present', async () => {
    const vault = new FakeVault();
    vault.seedFolder('Notes');
    await vault.write('Notes/a.md', 'x');
    const ar = new AcceptRejectController();
    let presented = false;
    ar.subscribe((p) => {
      if (p !== null) presented = true;
    });
    const tool = createDeleteFolderTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Notes' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('folder not empty');
    expect(presented).toBe(false);
    expect(vault.rmdirCalls).toEqual([]);
  });

  it('returns folder not empty when subfolders present', async () => {
    const vault = new FakeVault();
    vault.seedFolder('Outer');
    vault.seedFolder('Outer/Inner');
    const tool = createDeleteFolderTool({ acceptReject: new AcceptRejectController() });
    const v = tool.validate({ path: 'Outer' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('folder not empty');
    expect(vault.rmdirCalls).toEqual([]);
  });

  it('happy path removes empty folder on accept', async () => {
    const vault = new FakeVault();
    vault.seedFolder('Empty');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'accept');
    const tool = createDeleteFolderTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Empty' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe('accept');
    expect(result.data.path).toBe('Empty');
    expect(vault.rmdirCalls).toEqual(['Empty']);
    expect(vault.folders.has('Empty')).toBe(false);
  });

  it('reject is a no-op — folder preserved, rmdir not called', async () => {
    const vault = new FakeVault();
    vault.seedFolder('Empty');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'reject');
    const tool = createDeleteFolderTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Empty' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe('reject');
    expect(vault.rmdirCalls).toEqual([]);
    expect(vault.folders.has('Empty')).toBe(true);
  });

  it('aborts when signal already aborted', async () => {
    const vault = new FakeVault();
    vault.seedFolder('Empty');
    const tool = createDeleteFolderTool({ acceptReject: new AcceptRejectController() });
    const ac = new AbortController();
    ac.abort();
    const v = tool.validate({ path: 'Empty' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault, signal: ac.signal }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('aborted');
  });

  it('returns not a folder when path points to a file', async () => {
    const vault = new FakeVault();
    await vault.write('note.md', 'hi');
    const tool = createDeleteFolderTool({ acceptReject: new AcceptRejectController() });
    const v = tool.validate({ path: 'note.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not a folder');
    expect(vault.rmdirCalls).toEqual([]);
  });
});
