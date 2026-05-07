import { describe, expect, it } from 'vitest';
import { createCreateNoteTool } from '@/tools/builtin/createNote';
import { createAppendToNoteTool } from '@/tools/builtin/appendToNote';
import { AcceptRejectController, type AcceptRejectDecision } from '@/agent/acceptRejectController';
import { ReadFileStateStore } from '@/tools/builtin/readFileState';
import { NOT_READ_ERROR, STALE_ERROR, NOT_FOUND_ERROR } from '@/tools/builtin/writeGuard';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly mtimes = new Map<string, number>();
  writeCalls = 0;
  removeCalls = 0;
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
    this.mtimes.set(p, (this.mtimes.get(p) ?? 0) + 1);
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(p: string): Promise<void> {
    this.removeCalls += 1;
    this.files.delete(p);
    this.mtimes.delete(p);
  }
  async list(_p: string): Promise<{ files: string[]; folders: string[] }> {
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

describe('create_note tool', () => {
  it('happy path writes new file and returns accept decision', async () => {
    const vault = new FakeVault();
    const ar = new AcceptRejectController();
    autoResolve(ar, 'accept');
    const tool = createCreateNoteTool({ acceptReject: ar });
    expect(tool.requiresConfirmation).toBe(true);
    const v = tool.validate({ path: 'Notes/a.md', content: 'hello' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe('accept');
    expect(result.data.bytesWritten).toBe(5);
    expect(result.data.after).toBe('hello');
    expect(vault.writeCalls).toBe(1);
    expect(vault.files.get('Notes/a.md')).toBe('hello');
  });

  it('already-exists returns {ok:false, error:"file exists"} with NO write', async () => {
    const vault = new FakeVault();
    vault.files.set('Notes/a.md', 'prior');
    const ar = new AcceptRejectController();
    const tool = createCreateNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'Notes/a.md', content: 'hello' });
    if (!v.ok) throw new Error('validate failed');
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result).toEqual({ ok: false, error: 'file exists' });
    expect(vault.writeCalls).toBe(0);
  });

  it('reject removes the created file and reports decision=reject', async () => {
    const vault = new FakeVault();
    const ar = new AcceptRejectController();
    autoResolve(ar, 'reject');
    const tool = createCreateNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'tmp.md', content: 'x' });
    if (!v.ok) throw new Error('validate');
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe('reject');
    expect(vault.removeCalls).toBe(1);
    expect(vault.files.has('tmp.md')).toBe(false);
  });

  it('traversal-unsafe path rejected during validate before vault contact', () => {
    const vault = new FakeVault();
    const ar = new AcceptRejectController();
    const tool = createCreateNoteTool({ acceptReject: ar });
    expect(tool.validate({ path: '../escape.md', content: 'x' })).toEqual({
      ok: false,
      error: 'unsafe path',
    });
    expect(vault.writeCalls).toBe(0);
  });

  it('rejects non-string content and missing args via validate', () => {
    const ar = new AcceptRejectController();
    const tool = createCreateNoteTool({ acceptReject: ar });
    expect(tool.validate({ path: 'a.md' }).ok).toBe(false);
    expect(tool.validate({ content: 'x' }).ok).toBe(false);
    expect(tool.validate({ path: 'a.md', content: 42 }).ok).toBe(false);
  });
});

describe('append_to_note tool', () => {
  it('happy path appends with newline separator + accept decision', async () => {
    const vault = new FakeVault();
    vault.files.set('n.md', 'hello');
    vault.mtimes.set('n.md', 100);
    const readState = new ReadFileStateStore();
    readState.set('t', 'n.md', {
      content: 'hello',
      mtimeMs: 100,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    const ar = new AcceptRejectController();
    autoResolve(ar, 'accept');
    const tool = createAppendToNoteTool({ acceptReject: ar });
    expect(tool.requiresConfirmation).toBe(true);
    const v = tool.validate({ path: 'n.md', content: 'world' });
    if (!v.ok) throw new Error('validate');
    const r = await tool.invoke(v.data, makeToolCtx({ vault, readState }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.decision).toBe('accept');
    expect(vault.files.get('n.md')).toBe('hello\nworld');
    expect(vault.writeCalls).toBe(1);
  });

  it('skips leading newline when file ends with one', async () => {
    const vault = new FakeVault();
    vault.files.set('n.md', 'hello\n');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'accept');
    const tool = createAppendToNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'n.md', content: 'world' });
    if (!v.ok) throw new Error('validate');
    await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(vault.files.get('n.md')).toBe('hello\nworld');
  });

  it('reject reverts to original content', async () => {
    const vault = new FakeVault();
    vault.files.set('n.md', 'orig');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'reject');
    const tool = createAppendToNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'n.md', content: 'new' });
    if (!v.ok) throw new Error('validate');
    const r = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.decision).toBe('reject');
    expect(vault.files.get('n.md')).toBe('orig');
    expect(vault.writeCalls).toBe(2);
  });

  it('missing file returns guard NOT_FOUND_ERROR with NO write', async () => {
    const vault = new FakeVault();
    const ar = new AcceptRejectController();
    const tool = createAppendToNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'absent.md', content: 'x' });
    if (!v.ok) throw new Error('validate');
    const r = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(r).toEqual({ ok: false, error: NOT_FOUND_ERROR });
    expect(vault.writeCalls).toBe(0);
  });

  it('rejects with NOT_READ_ERROR when readState present but entry missing', async () => {
    const vault = new FakeVault();
    vault.files.set('n.md', 'hi');
    vault.mtimes.set('n.md', 100);
    const readState = new ReadFileStateStore();
    const ar = new AcceptRejectController();
    const tool = createAppendToNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'n.md', content: 'x' });
    if (!v.ok) throw new Error('validate');
    const r = await tool.invoke(v.data, makeToolCtx({ vault, readState }));
    expect(r).toEqual({ ok: false, error: NOT_READ_ERROR });
    expect(vault.writeCalls).toBe(0);
  });

  it('rejects with STALE_ERROR when on-disk mtime advanced past read', async () => {
    const vault = new FakeVault();
    vault.files.set('n.md', 'hi');
    vault.mtimes.set('n.md', 5000);
    const readState = new ReadFileStateStore();
    readState.set('t', 'n.md', {
      content: 'hi',
      mtimeMs: 100,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    const ar = new AcceptRejectController();
    const tool = createAppendToNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'n.md', content: 'x' });
    if (!v.ok) throw new Error('validate');
    const r = await tool.invoke(v.data, makeToolCtx({ vault, readState }));
    expect(r).toEqual({ ok: false, error: STALE_ERROR });
    expect(vault.writeCalls).toBe(0);
  });

  it('traversal rejection via validate before vault contact', () => {
    const vault = new FakeVault();
    const ar = new AcceptRejectController();
    const tool = createAppendToNoteTool({ acceptReject: ar });
    expect(tool.validate({ path: '../x.md', content: 'x' }).ok).toBe(false);
    expect(vault.writeCalls).toBe(0);
  });

  it('platform errors surface as {ok:false}, no exception escapes', async () => {
    const baseVault = new FakeVault();
    baseVault.files.set('n.md', 'x');
    const ar = new AcceptRejectController();
    const tool = createAppendToNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'n.md', content: 'y' });
    if (!v.ok) throw new Error('validate');
    const failingVault = {
      ...baseVault,
      exists: baseVault.exists.bind(baseVault),
      stat: baseVault.stat.bind(baseVault),
      read: baseVault.read.bind(baseVault),
      async write() {
        throw new Error('disk full');
      },
    } as unknown as VaultAdapter;
    const r = await tool.invoke(v.data, makeToolCtx({ vault: failingVault }));
    expect(r.ok).toBe(false);
  });
});
