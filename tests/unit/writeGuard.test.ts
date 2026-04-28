import { describe, expect, it } from 'vitest';
import {
  ensureFreshRead,
  NOT_FOUND_ERROR,
  NOT_READ_ERROR,
  STALE_ERROR,
} from '@/tools/builtin/writeGuard';
import { ReadFileStateStore } from '@/tools/builtin/readFileState';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly mtimes = new Map<string, number>();
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
  async stat(p: string): Promise<{ mtimeMs: number; size: number } | null> {
    const m = this.mtimes.get(p);
    if (m === undefined) return null;
    return { mtimeMs: m, size: this.files.get(p)?.length ?? 0 };
  }
}

describe('ensureFreshRead', () => {
  it('returns not-found error when file does not exist', async () => {
    const vault = new FakeVault();
    const r = await ensureFreshRead(makeToolCtx({ vault }), 'absent.md');
    expect(r).toEqual({ ok: false, error: NOT_FOUND_ERROR });
  });

  it('returns ok when readState is undefined (test bypass)', async () => {
    const vault = new FakeVault();
    vault.files.set('a.md', 'x');
    const r = await ensureFreshRead(makeToolCtx({ vault }), 'a.md');
    expect(r).toEqual({ ok: true });
  });

  it('rejects with NOT_READ_ERROR when readState entry missing', async () => {
    const vault = new FakeVault();
    vault.files.set('a.md', 'x');
    vault.mtimes.set('a.md', 1000);
    const readState = new ReadFileStateStore();
    const r = await ensureFreshRead(makeToolCtx({ vault, readState }), 'a.md');
    expect(r).toEqual({ ok: false, error: NOT_READ_ERROR });
  });

  it('rejects with NOT_READ_ERROR when entry isPartialView=true', async () => {
    const vault = new FakeVault();
    vault.files.set('a.md', 'x');
    vault.mtimes.set('a.md', 1000);
    const readState = new ReadFileStateStore();
    readState.set('a.md', {
      content: 'x',
      mtimeMs: 1000,
      offset: 1,
      limit: 10,
      isPartialView: true,
    });
    const r = await ensureFreshRead(makeToolCtx({ vault, readState }), 'a.md');
    expect(r).toEqual({ ok: false, error: NOT_READ_ERROR });
  });

  it('rejects with STALE_ERROR when on-disk mtime advanced past entry', async () => {
    const vault = new FakeVault();
    vault.files.set('a.md', 'x');
    vault.mtimes.set('a.md', 2500);
    const readState = new ReadFileStateStore();
    readState.set('a.md', {
      content: 'x',
      mtimeMs: 1000,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    const r = await ensureFreshRead(makeToolCtx({ vault, readState }), 'a.md');
    expect(r).toEqual({ ok: false, error: STALE_ERROR });
  });

  it('returns ok when entry mtime matches floored on-disk mtime', async () => {
    const vault = new FakeVault();
    vault.files.set('a.md', 'x');
    vault.mtimes.set('a.md', 1000.7);
    const readState = new ReadFileStateStore();
    readState.set('a.md', {
      content: 'x',
      mtimeMs: 1000,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    const r = await ensureFreshRead(makeToolCtx({ vault, readState }), 'a.md');
    expect(r).toEqual({ ok: true });
  });
});
