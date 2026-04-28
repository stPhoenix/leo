import { describe, expect, it } from 'vitest';
import { createReadFileTool } from '@/tools/builtin/readFile';
import { ReadFileStateStore } from '@/tools/builtin/readFileState';
import type { VaultAdapter, VaultListing, VaultStat } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class MtimeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly mtimes = new Map<string, number>();
  readonly subfolders = new Map<string, VaultListing>();
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
    this.mtimes.set(p, (this.mtimes.get(p) ?? 0) + 1000);
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
    this.mtimes.delete(p);
  }
  async list(p: string): Promise<VaultListing> {
    if (this.subfolders.has(p)) return this.subfolders.get(p) as VaultListing;
    if (p === '') return { files: [...this.files.keys()], folders: [] };
    return { files: [], folders: [] };
  }
  async stat(p: string): Promise<VaultStat | null> {
    if (!this.files.has(p)) return null;
    return { mtimeMs: this.mtimes.get(p) ?? 0, size: this.files.get(p)?.length ?? 0 };
  }
  setMtime(p: string, m: number): void {
    this.mtimes.set(p, m);
  }
}

const FIVE_LINE = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');

describe('read_file offset/limit/line-numbering', () => {
  it('without offset/limit numbers from line 1', async () => {
    const vault = new MtimeVault();
    vault.files.set('a.md', FIVE_LINE);
    vault.setMtime('a.md', 100);
    const tool = createReadFileTool();
    const res = await tool.invoke({ path: 'a.md' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.content).toBe(
        ['1\tline1', '2\tline2', '3\tline3', '4\tline4', '5\tline5'].join('\n'),
      );
      expect(res.data.totalLines).toBe(5);
      expect(res.data.numLines).toBe(5);
      expect(res.data.startLine).toBe(1);
      expect(res.data.truncated).toBe(false);
    }
  });

  it('offset + limit yields a numbered slice from the requested start', async () => {
    const vault = new MtimeVault();
    vault.files.set('a.md', FIVE_LINE);
    const tool = createReadFileTool();
    const res = await tool.invoke({ path: 'a.md', offset: 3, limit: 2 }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.content).toBe(['3\tline3', '4\tline4'].join('\n'));
      expect(res.data.startLine).toBe(3);
      expect(res.data.numLines).toBe(2);
      expect(res.data.totalLines).toBe(5);
    }
  });

  it('offset > totalLines returns the system-reminder warning', async () => {
    const vault = new MtimeVault();
    vault.files.set('a.md', FIVE_LINE);
    const tool = createReadFileTool();
    const res = await tool.invoke({ path: 'a.md', offset: 99 }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.content).toContain('shorter than the provided offset');
      expect(res.data.numLines).toBe(0);
    }
  });

  it('empty file returns the empty-file system-reminder', async () => {
    const vault = new MtimeVault();
    vault.files.set('a.md', '');
    const tool = createReadFileTool();
    const res = await tool.invoke({ path: 'a.md' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.content).toContain('the contents are empty');
      expect(res.data.totalLines).toBe(0);
    }
  });

  it('limit set bypasses the default 200KB byte cap', async () => {
    const vault = new MtimeVault();
    const big = Array.from({ length: 5000 }, (_, i) => `entry-${i}`).join('\n');
    vault.files.set('big.txt', big);
    const tool = createReadFileTool();
    const res = await tool.invoke(
      { path: 'big.txt', offset: 4998, limit: 3 },
      makeToolCtx({ vault }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.numLines).toBe(3);
      expect(res.data.content.startsWith('4998\t')).toBe(true);
    }
  });
});

describe('read_file dedup via ReadFileStateStore', () => {
  it('returns unchanged stub on second read with same offset/limit and same mtime', async () => {
    const vault = new MtimeVault();
    vault.files.set('a.md', FIVE_LINE);
    vault.setMtime('a.md', 500);
    const readState = new ReadFileStateStore();
    const tool = createReadFileTool();
    const ctx = makeToolCtx({ vault, readState });
    const first = await tool.invoke({ path: 'a.md' }, ctx);
    expect(first.ok).toBe(true);
    const second = await tool.invoke({ path: 'a.md' }, ctx);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.data.unchanged).toBe(true);
      expect(second.data.content).toContain('File unchanged');
    }
  });

  it('mtime change invalidates the dedup cache', async () => {
    const vault = new MtimeVault();
    vault.files.set('a.md', FIVE_LINE);
    vault.setMtime('a.md', 1);
    const readState = new ReadFileStateStore();
    const tool = createReadFileTool();
    const ctx = makeToolCtx({ vault, readState });
    await tool.invoke({ path: 'a.md' }, ctx);
    vault.setMtime('a.md', 2);
    const fresh = await tool.invoke({ path: 'a.md' }, ctx);
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.data.unchanged).toBeUndefined();
      expect(fresh.data.numLines).toBe(5);
    }
  });

  it('partial-view (limit set) entries do not return unchanged stubs', async () => {
    const vault = new MtimeVault();
    vault.files.set('a.md', FIVE_LINE);
    vault.setMtime('a.md', 1);
    const readState = new ReadFileStateStore();
    const tool = createReadFileTool();
    const ctx = makeToolCtx({ vault, readState });
    await tool.invoke({ path: 'a.md', limit: 2 }, ctx);
    const second = await tool.invoke({ path: 'a.md', limit: 2 }, ctx);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.data.unchanged).toBeUndefined();
      expect(second.data.numLines).toBe(2);
    }
  });
});

describe('read_file ENOENT suggestions', () => {
  it('suggests similar filenames in the same vault', async () => {
    const vault = new MtimeVault();
    vault.files.set('src/foo.ts', 'export {}');
    const tool = createReadFileTool();
    const res = await tool.invoke({ path: 'src/foo.tx' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Did you mean');
      expect(res.error).toContain('src/foo.ts');
    }
  });

  it('omits the suggestion suffix when no similar files exist', async () => {
    const vault = new MtimeVault();
    vault.files.set('completely-other-name.md', 'x');
    const tool = createReadFileTool();
    const res = await tool.invoke({ path: 'src/zzz-unique.ts' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toContain('Did you mean');
    }
  });
});
