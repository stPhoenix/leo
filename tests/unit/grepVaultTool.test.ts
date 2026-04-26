import { describe, expect, it } from 'vitest';
import { createGrepVaultTool } from '@/tools/builtin/grepVault';
import type { VaultAdapter, VaultListing, VaultStat } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class TreeVault implements VaultAdapter {
  constructor(
    private readonly tree: Record<string, VaultListing>,
    private readonly contents: Record<string, string>,
    private readonly mtimes: Record<string, number> = {},
  ) {}
  async exists(p: string): Promise<boolean> {
    if (p === '') return true;
    if (this.tree[p] !== undefined) return true;
    if (this.contents[p] !== undefined) return true;
    return false;
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(p: string): Promise<string> {
    return this.contents[p] ?? '';
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
    if (this.contents[p] === undefined) return null;
    return {
      mtimeMs: this.mtimes[p] ?? 0,
      size: (this.contents[p] ?? '').length,
    };
  }
}

const tree = {
  '': { files: ['a.md', 'b.md'], folders: ['Notes'] },
  Notes: { files: ['Notes/c.md'], folders: [] },
};

const contents = {
  'a.md': 'hello world\nTODO: fix me\nbye world',
  'b.md': 'no matches here',
  'Notes/c.md': 'TODO write tests\nanother line\nTODO again',
};

const mtimes = { 'a.md': 100, 'b.md': 50, 'Notes/c.md': 200 };

describe('grep_vault tool — files_with_matches mode (default)', () => {
  it('returns mtime-desc paths matching the pattern', async () => {
    const vault = new TreeVault(tree, contents, mtimes);
    const tool = createGrepVaultTool();
    const res = await tool.invoke({ pattern: 'TODO' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.mode).toBe('files_with_matches');
      expect(res.data.filenames).toEqual(['Notes/c.md', 'a.md']);
    }
  });

  it('case-insensitive flag matches lowercase pattern against mixed case content', async () => {
    const vault = new TreeVault(tree, contents, mtimes);
    const tool = createGrepVaultTool();
    const res = await tool.invoke({ pattern: 'todo', '-i': true }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.filenames).toEqual(['Notes/c.md', 'a.md']);
  });

  it('returns empty when nothing matches', async () => {
    const vault = new TreeVault(tree, contents, mtimes);
    const tool = createGrepVaultTool();
    const res = await tool.invoke({ pattern: 'NEVER_PRESENT' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.numFiles).toBe(0);
      expect(res.data.filenames).toEqual([]);
    }
  });
});

describe('grep_vault tool — content mode', () => {
  it('returns path:line:text per match', async () => {
    const vault = new TreeVault(tree, contents, mtimes);
    const tool = createGrepVaultTool();
    const res = await tool.invoke(
      { pattern: 'TODO', output_mode: 'content' },
      makeToolCtx({ vault }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.content).toContain('a.md:2:TODO: fix me');
      expect(res.data.content).toContain('Notes/c.md:1:TODO write tests');
      expect(res.data.content).toContain('Notes/c.md:3:TODO again');
    }
  });

  it('-C adds context lines before and after', async () => {
    const vault = new TreeVault(tree, contents, mtimes);
    const tool = createGrepVaultTool();
    const res = await tool.invoke(
      { pattern: 'fix me', output_mode: 'content', '-C': 1 },
      makeToolCtx({ vault }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.content).toContain('a.md:1:hello world');
      expect(res.data.content).toContain('a.md:2:TODO: fix me');
      expect(res.data.content).toContain('a.md:3:bye world');
    }
  });

  it('-n=false suppresses line numbers', async () => {
    const vault = new TreeVault(tree, contents, mtimes);
    const tool = createGrepVaultTool();
    const res = await tool.invoke(
      { pattern: 'TODO', output_mode: 'content', '-n': false },
      makeToolCtx({ vault }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.content).toMatch(/^a\.md:TODO/m);
      expect(res.data.content).not.toMatch(/^a\.md:2:/m);
    }
  });
});

describe('grep_vault tool — count mode', () => {
  it('returns path:N per file with totals', async () => {
    const vault = new TreeVault(tree, contents, mtimes);
    const tool = createGrepVaultTool();
    const res = await tool.invoke(
      { pattern: 'TODO', output_mode: 'count' },
      makeToolCtx({ vault }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.numFiles).toBe(2);
      expect(res.data.numMatches).toBe(3);
      expect(res.data.content).toContain('a.md:1');
      expect(res.data.content).toContain('Notes/c.md:2');
    }
  });
});

describe('grep_vault tool — multiline', () => {
  it('matches across newlines when multiline=true', async () => {
    const vault = new TreeVault(
      { '': { files: ['x.ts'], folders: [] } },
      { 'x.ts': 'class Foo {\n  bar = 1;\n}' },
      { 'x.ts': 1 },
    );
    const tool = createGrepVaultTool();
    const res = await tool.invoke(
      { pattern: 'class Foo \\{[\\s\\S]*?bar', multiline: true },
      makeToolCtx({ vault }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.filenames).toEqual(['x.ts']);
  });

  it('does not match across newlines when multiline is false (default)', async () => {
    const vault = new TreeVault(
      { '': { files: ['x.ts'], folders: [] } },
      { 'x.ts': 'class Foo {\n  bar = 1;\n}' },
    );
    const tool = createGrepVaultTool();
    const res = await tool.invoke({ pattern: 'class Foo \\{.*?bar' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.filenames).toEqual([]);
  });
});

describe('grep_vault tool — pagination + edge cases', () => {
  it('head_limit truncates and reports appliedLimit', async () => {
    const files: Record<string, VaultListing> = {
      '': { files: ['a.md', 'b.md', 'c.md', 'd.md'], folders: [] },
    };
    const data = {
      'a.md': 'TODO',
      'b.md': 'TODO',
      'c.md': 'TODO',
      'd.md': 'TODO',
    };
    const vault = new TreeVault(files, data, { 'a.md': 1, 'b.md': 2, 'c.md': 3, 'd.md': 4 });
    const tool = createGrepVaultTool();
    const res = await tool.invoke({ pattern: 'TODO', head_limit: 2 }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.filenames.length).toBe(2);
      expect(res.data.appliedLimit).toBe(2);
      expect(res.data.truncated).toBe(true);
    }
  });

  it('pattern starting with - is accepted as literal regex', async () => {
    const vault = new TreeVault(
      { '': { files: ['a.txt'], folders: [] } },
      { 'a.txt': '-Wall is a flag' },
      { 'a.txt': 1 },
    );
    const tool = createGrepVaultTool();
    const res = await tool.invoke({ pattern: '-Wall' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.filenames).toEqual(['a.txt']);
  });

  it('invalid regex returns an error', async () => {
    const vault = new TreeVault({ '': { files: [], folders: [] } }, {});
    const tool = createGrepVaultTool();
    const res = await tool.invoke({ pattern: '*[' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('invalid regex');
  });

  it('aborts when signal is already aborted', async () => {
    const vault = new TreeVault(tree, contents, mtimes);
    const ac = new AbortController();
    ac.abort();
    const tool = createGrepVaultTool();
    const res = await tool.invoke({ pattern: 'TODO' }, makeToolCtx({ vault, signal: ac.signal }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('aborted');
  });

  it('skips binary files', async () => {
    const vault = new TreeVault(
      { '': { files: ['a.bin', 'b.md'], folders: [] } },
      { 'a.bin': '\x00\x01\x02TODO', 'b.md': 'TODO is here' },
      { 'a.bin': 1, 'b.md': 2 },
    );
    const tool = createGrepVaultTool();
    const res = await tool.invoke({ pattern: 'TODO' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.filenames).toEqual(['b.md']);
  });

  it('honors ctx.excludeMatcher', async () => {
    const vault = new TreeVault(tree, contents, mtimes);
    const tool = createGrepVaultTool();
    const res = await tool.invoke(
      { pattern: 'TODO' },
      makeToolCtx({ vault, excludeMatcher: (p): boolean => p.startsWith('Notes/') }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.filenames).toEqual(['a.md']);
  });

  it('glob filter narrows the candidate set', async () => {
    const vault = new TreeVault(
      {
        '': { files: ['a.md', 'b.txt'], folders: [] },
      },
      { 'a.md': 'TODO', 'b.txt': 'TODO' },
      { 'a.md': 1, 'b.txt': 2 },
    );
    const tool = createGrepVaultTool();
    const res = await tool.invoke({ pattern: 'TODO', glob: '*.md' }, makeToolCtx({ vault }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.filenames).toEqual(['a.md']);
  });
});
