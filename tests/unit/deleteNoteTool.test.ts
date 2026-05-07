import { describe, expect, it } from 'vitest';
import { createDeleteNoteTool } from '@/tools/builtin/deleteNote';
import { AcceptRejectController, type AcceptRejectDecision } from '@/agent/acceptRejectController';
import { ReadFileStateStore } from '@/tools/builtin/readFileState';
import { NOT_READ_ERROR, STALE_ERROR, NOT_FOUND_ERROR } from '@/tools/builtin/writeGuard';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly mtimes = new Map<string, number>();
  removeCalls: string[] = [];
  writeCalls: Array<{ path: string; data: string }> = [];
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
    this.writeCalls.push({ path: p, data: d });
    this.files.set(p, d);
    this.mtimes.set(p, (this.mtimes.get(p) ?? 0) + 1);
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(p: string): Promise<void> {
    this.removeCalls.push(p);
    this.files.delete(p);
    this.mtimes.delete(p);
  }
  async list(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }
  async stat(p: string): Promise<{ mtimeMs: number; size: number } | null> {
    const m = this.mtimes.get(p);
    if (m === undefined) return null;
    return { mtimeMs: m, size: this.files.get(p)?.length ?? 0 };
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

function seedRead(readState: ReadFileStateStore, vault: FakeVault, path: string): void {
  const content = vault.files.get(path) ?? '';
  readState.set('t', path, {
    content,
    mtimeMs: vault.mtimes.get(path) ?? 0,
    offset: undefined,
    limit: undefined,
    isPartialView: false,
  });
}

describe('delete_note tool', () => {
  it('declares id, schema, requiresConfirmation', () => {
    const tool = createDeleteNoteTool({ acceptReject: new AcceptRejectController() });
    expect(tool.id).toBe('delete_note');
    expect(tool.requiresConfirmation).toBe(true);
    expect(tool.parameters).toEqual(
      expect.objectContaining({
        required: ['path'],
      }),
    );
  });

  it('blocks when file has not been read', async () => {
    const vault = new FakeVault();
    await vault.write('Foo.md', 'body');
    const readState = new ReadFileStateStore();
    const tool = createDeleteNoteTool({ acceptReject: new AcceptRejectController() });
    const v = tool.validate({ path: 'Foo.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault, readState }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(NOT_READ_ERROR);
    expect(vault.removeCalls).toEqual([]);
  });

  it('blocks when file is stale (mtime advanced since read)', async () => {
    const vault = new FakeVault();
    await vault.write('Foo.md', 'v1');
    const readState = new ReadFileStateStore();
    seedRead(readState, vault, 'Foo.md');
    await vault.write('Foo.md', 'v2');
    const tool = createDeleteNoteTool({ acceptReject: new AcceptRejectController() });
    const v = tool.validate({ path: 'Foo.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault, readState }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(STALE_ERROR);
  });

  it('reports not-found for missing file', async () => {
    const vault = new FakeVault();
    const readState = new ReadFileStateStore();
    const tool = createDeleteNoteTool({ acceptReject: new AcceptRejectController() });
    const v = tool.validate({ path: 'Missing.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault, readState }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(NOT_FOUND_ERROR);
  });

  it('happy path removes file and returns accept with byte count', async () => {
    const vault = new FakeVault();
    await vault.write('Foo.md', 'hello');
    const readState = new ReadFileStateStore();
    seedRead(readState, vault, 'Foo.md');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'accept');
    const tool = createDeleteNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Foo.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault, readState }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe('accept');
    expect(result.data.bytesDeleted).toBe(5);
    expect(result.data.before).toBe('hello');
    expect(vault.files.has('Foo.md')).toBe(false);
    expect(readState.get('t', 'Foo.md')).toBeUndefined();
  });

  it('reject restores the captured content', async () => {
    const vault = new FakeVault();
    await vault.write('Foo.md', 'body');
    const readState = new ReadFileStateStore();
    seedRead(readState, vault, 'Foo.md');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'reject');
    const tool = createDeleteNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Foo.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault, readState }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe('reject');
    expect(vault.files.get('Foo.md')).toBe('body');
    expect(readState.get('t', 'Foo.md')).toBeDefined();
  });

  it('aborts when signal already aborted', async () => {
    const vault = new FakeVault();
    await vault.write('Foo.md', 'x');
    const readState = new ReadFileStateStore();
    seedRead(readState, vault, 'Foo.md');
    const tool = createDeleteNoteTool({ acceptReject: new AcceptRejectController() });
    const ac = new AbortController();
    ac.abort();
    const v = tool.validate({ path: 'Foo.md' });
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault, readState, signal: ac.signal }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('aborted');
  });

  it('rejects unsafe paths via schema', () => {
    const tool = createDeleteNoteTool({ acceptReject: new AcceptRejectController() });
    expect(tool.validate({ path: '../escape.md' }).ok).toBe(false);
    expect(tool.validate({ path: '/abs.md' }).ok).toBe(false);
    expect(tool.validate({ path: '' }).ok).toBe(false);
  });
});
