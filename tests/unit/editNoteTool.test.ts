import { describe, expect, it, vi } from 'vitest';
import { createEditNoteTool } from '@/tools/builtin/editNote';
import type { EditNoteBridge } from '@/tools/types';
import { AcceptRejectController } from '@/agent/acceptRejectController';
import { ReadFileStateStore } from '@/tools/builtin/readFileState';
import { NOT_READ_ERROR, STALE_ERROR } from '@/tools/builtin/writeGuard';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  writeCalls: Array<{ path: string; data: string }> = [];
  statMtime: number | null = null;
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
  async stat(p: string): Promise<{ mtimeMs: number; size: number } | null> {
    if (this.statMtime === null) return null;
    return { mtimeMs: this.statMtime, size: this.files.get(p)?.length ?? 0 };
  }
}

function defaultBridge(overrides: Partial<EditNoteBridge> = {}): EditNoteBridge {
  return {
    isActiveNote: () => false,
    applyActiveEdit: async () => ({ ok: false, error: 'not wired' }),
    ...overrides,
  };
}

function autoResolve(controller: AcceptRejectController, decision: 'accept' | 'reject'): void {
  const unsub = controller.subscribe((p) => {
    if (p !== null) {
      queueMicrotask(() => {
        controller.resolve(decision);
        unsub();
      });
    }
  });
}

describe('edit_note tool', () => {
  it('declares id + description + Zod-like schema + requiresConfirmation=true', () => {
    const tool = createEditNoteTool({ acceptReject: new AcceptRejectController() });
    expect(tool.id).toBe('edit_note');
    expect(tool.requiresConfirmation).toBe(true);
    expect(tool.parameters).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          path: expect.any(Object),
          line_start: expect.any(Object),
          line_end: expect.any(Object),
          new_content: expect.any(Object),
        }),
        required: ['path', 'line_start', 'line_end', 'new_content'],
      }),
    );
  });

  it('validate rejects traversal-unsafe paths + invalid numeric args', () => {
    const tool = createEditNoteTool({ acceptReject: new AcceptRejectController() });
    expect(
      tool.validate({ path: '../esc.md', line_start: 0, line_end: 0, new_content: '' }).ok,
    ).toBe(false);
    expect(tool.validate({ path: 'a.md', line_start: -1, line_end: 0, new_content: '' }).ok).toBe(
      false,
    );
    expect(tool.validate({ path: 'a.md', line_start: 5, line_end: 3, new_content: '' }).ok).toBe(
      false,
    );
    expect(tool.validate({ path: 'a.md', line_start: 0, line_end: 0, new_content: 42 }).ok).toBe(
      false,
    );
  });

  it('routes through ctx.editor.applyActiveEdit when path is the active note', async () => {
    const vault = new FakeVault();
    vault.files.set('active.md', 'before');
    const apply = vi.fn(async () => ({ ok: true as const, bytesWritten: 3, undo: vi.fn() }));
    const editor = defaultBridge({
      isActiveNote: (p) => p === 'active.md',
      applyActiveEdit: apply,
    });
    const ar = new AcceptRejectController();
    autoResolve(ar, 'accept');
    const tool = createEditNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'active.md', line_start: 0, line_end: 0, new_content: 'NEW' });
    if (!v.ok) throw new Error('validate');
    const result = await tool.invoke(v.data, makeToolCtx({ vault, editor }));
    expect(result.ok).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(vault.writeCalls).toHaveLength(0);
  });

  it('falls back to vault read–splice–write for non-active notes', async () => {
    const vault = new FakeVault();
    vault.files.set('notes/a.md', 'line0\nline1\nline2');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'accept');
    const tool = createEditNoteTool({ acceptReject: ar });
    const v = tool.validate({
      path: 'notes/a.md',
      line_start: 1,
      line_end: 1,
      new_content: 'REPLACED',
    });
    if (!v.ok) throw new Error('validate');
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    expect(vault.writeCalls).toHaveLength(1);
    expect(vault.files.get('notes/a.md')).toBe('line0\nREPLACED\nline2');
  });

  it('Reject on the vault fallback path restores pre-edit bytes via a second vault.write', async () => {
    const vault = new FakeVault();
    vault.files.set('n.md', 'A\nB\nC');
    const ar = new AcceptRejectController();
    autoResolve(ar, 'reject');
    const tool = createEditNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'n.md', line_start: 0, line_end: 2, new_content: 'X' });
    if (!v.ok) throw new Error('validate');
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.decision).toBe('reject');
    expect(vault.files.get('n.md')).toBe('A\nB\nC');
    expect(vault.writeCalls).toHaveLength(2);
  });

  it('Reject on the active-editor path calls undo() exactly once', async () => {
    const vault = new FakeVault();
    vault.files.set('x.md', 'orig');
    const undo = vi.fn();
    const editor = defaultBridge({
      isActiveNote: () => true,
      applyActiveEdit: async () => ({ ok: true as const, bytesWritten: 5, undo }),
    });
    const ar = new AcceptRejectController();
    autoResolve(ar, 'reject');
    const tool = createEditNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'x.md', line_start: 0, line_end: 0, new_content: 'X' });
    if (!v.ok) throw new Error('validate');
    const result = await tool.invoke(v.data, makeToolCtx({ vault, editor }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.decision).toBe('reject');
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('non-existent path on vault fallback returns {ok:false, error:"not found"}', async () => {
    const vault = new FakeVault();
    const ar = new AcceptRejectController();
    const tool = createEditNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'absent.md', line_start: 0, line_end: 0, new_content: 'x' });
    if (!v.ok) throw new Error('validate');
    const result = await tool.invoke(v.data, makeToolCtx({ vault }));
    expect(result).toEqual({ ok: false, error: 'not found' });
  });

  it('rejects with NOT_READ_ERROR on vault path when readState entry missing', async () => {
    const vault = new FakeVault();
    vault.files.set('n.md', 'A');
    const readState = new ReadFileStateStore();
    const ar = new AcceptRejectController();
    const tool = createEditNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'n.md', line_start: 0, line_end: 0, new_content: 'X' });
    if (!v.ok) throw new Error('validate');
    const r = await tool.invoke(v.data, makeToolCtx({ vault, readState }));
    expect(r).toEqual({ ok: false, error: NOT_READ_ERROR });
    expect(vault.writeCalls).toHaveLength(0);
  });

  it('rejects with STALE_ERROR on vault path when on-disk mtime advanced past read', async () => {
    const vault = new FakeVault();
    vault.files.set('n.md', 'A');
    vault.statMtime = 9999;
    const readState = new ReadFileStateStore();
    readState.set('n.md', {
      content: 'A',
      mtimeMs: 100,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    const ar = new AcceptRejectController();
    const tool = createEditNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'n.md', line_start: 0, line_end: 0, new_content: 'X' });
    if (!v.ok) throw new Error('validate');
    const r = await tool.invoke(v.data, makeToolCtx({ vault, readState }));
    expect(r).toEqual({ ok: false, error: STALE_ERROR });
    expect(vault.writeCalls).toHaveLength(0);
  });

  it('vault platform errors surface as {ok:false}, no exception escapes', async () => {
    const ar = new AcceptRejectController();
    const baseVault = new FakeVault();
    baseVault.files.set('n.md', 'x');
    const failingVault = {
      ...baseVault,
      async write() {
        throw new Error('disk full');
      },
    } as unknown as VaultAdapter;
    const tool = createEditNoteTool({ acceptReject: ar });
    const v = tool.validate({ path: 'n.md', line_start: 0, line_end: 0, new_content: 'y' });
    if (!v.ok) throw new Error('validate');
    const result = await tool.invoke(v.data, makeToolCtx({ vault: failingVault }));
    expect(result.ok).toBe(false);
  });
});
