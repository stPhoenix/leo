import { describe, expect, it } from 'vitest';
import { createGlobVaultTool } from '@/tools/builtin/globVault';
import type { VaultAdapter, VaultListing, VaultStat } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class TreeVault implements VaultAdapter {
  constructor(
    private readonly tree: Record<string, VaultListing>,
    private readonly mtimes: Record<string, number> = {},
  ) {}
  async exists(p: string): Promise<boolean> {
    if (p === '') return true;
    if (this.tree[p] !== undefined) return true;
    for (const v of Object.values(this.tree)) {
      if (v.files.includes(p)) return true;
    }
    return false;
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(): Promise<string> {
    return '';
  }
  async write(): Promise<void> {
    /* no-op */
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(): Promise<void> {
    /* no-op */
  }
  async list(p: string): Promise<VaultListing> {
    return this.tree[p] ?? { files: [], folders: [] };
  }
  async stat(p: string): Promise<VaultStat | null> {
    if (this.mtimes[p] === undefined) return null;
    return { mtimeMs: this.mtimes[p], size: 0 };
  }
}

describe('glob_vault tool', () => {
  it('matches **/*.md across folders', async () => {
    const vault = new TreeVault(
      {
        '': { files: ['root.md', 'config.json'], folders: ['Notes'] },
        Notes: { files: ['Notes/a.md', 'Notes/b.txt'], folders: ['Notes/sub'] },
        'Notes/sub': { files: ['Notes/sub/c.md'], folders: [] },
      },
      { 'root.md': 100, 'Notes/a.md': 200, 'Notes/sub/c.md': 50 },
    );
    const tool = createGlobVaultTool();
    const res = await tool.invoke({ pattern: '**/*.md' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.numFiles).toBe(3);
      // mtime desc: 200 (a.md), 100 (root.md), 50 (c.md)
      expect(res.data.filenames).toEqual(['Notes/a.md', 'root.md', 'Notes/sub/c.md']);
      expect(res.data.truncated).toBe(false);
    }
  });

  it('honors the path argument as the search root and pattern is relative to it', async () => {
    const vault = new TreeVault(
      {
        '': { files: [], folders: ['src'] },
        src: { files: ['src/a.ts', 'src/b.tsx'], folders: ['src/sub'] },
        'src/sub': { files: ['src/sub/c.ts'], folders: [] },
      },
      { 'src/a.ts': 1, 'src/b.tsx': 2, 'src/sub/c.ts': 3 },
    );
    const tool = createGlobVaultTool();
    const res = await tool.invoke({ pattern: '**/*.ts', path: 'src' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.numFiles).toBe(2);
      expect([...res.data.filenames].sort()).toEqual(['src/a.ts', 'src/sub/c.ts']);
    }
  });

  it('returns empty when nothing matches', async () => {
    const vault = new TreeVault({ '': { files: ['only.txt'], folders: [] } }, { 'only.txt': 1 });
    const tool = createGlobVaultTool();
    const res = await tool.invoke({ pattern: '**/*.never' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.numFiles).toBe(0);
  });

  it('skips hidden segments (dotfolders)', async () => {
    const vault = new TreeVault(
      {
        '': { files: ['a.md'], folders: ['.obsidian', 'Notes'] },
        Notes: { files: ['Notes/b.md'], folders: [] },
        '.obsidian': { files: ['.obsidian/x.md'], folders: [] },
      },
      { 'a.md': 1, 'Notes/b.md': 2, '.obsidian/x.md': 3 },
    );
    const tool = createGlobVaultTool();
    const res = await tool.invoke({ pattern: '**/*.md' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.filenames).not.toContain('.obsidian/x.md');
      expect([...res.data.filenames].sort()).toEqual(['Notes/b.md', 'a.md']);
    }
  });

  it('honors ctx.excludeMatcher', async () => {
    const vault = new TreeVault(
      {
        '': { files: ['a.md', 'b.md'], folders: [] },
      },
      { 'a.md': 1, 'b.md': 2 },
    );
    const tool = createGlobVaultTool();
    const res = await tool.invoke(
      { pattern: '**/*.md' },
      makeToolCtx({ vault, excludeMatcher: (p): boolean => p === 'b.md' }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.filenames).toEqual(['a.md']);
    }
  });

  it('aborts when signal is already aborted', async () => {
    const vault = new TreeVault({ '': { files: ['a.md'], folders: [] } });
    const ac = new AbortController();
    ac.abort();
    const tool = createGlobVaultTool();
    const res = await tool.invoke(
      { pattern: '**/*.md' },
      makeToolCtx({ vault, signal: ac.signal }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('aborted');
  });

  it('rejects unsafe path during validate', () => {
    const tool = createGlobVaultTool();
    expect(tool.validate({ pattern: '**/*.md', path: '/abs' }).ok).toBe(false);
    expect(tool.validate({ pattern: '**/*.md', path: '../up' }).ok).toBe(false);
    expect(tool.validate({ pattern: '**/*.md' }).ok).toBe(true);
    expect(tool.validate({ pattern: '**/*.md', path: '' }).ok).toBe(true);
  });
});
