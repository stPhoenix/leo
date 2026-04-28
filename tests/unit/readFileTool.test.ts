import { describe, expect, it } from 'vitest';
import { createReadFileTool } from '@/tools/builtin/readFile';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';
import { makeToolCtx } from './_toolCtx';

class FakeVault implements VaultAdapter {
  constructor(private readonly files: Record<string, string>) {}
  async exists(p: string): Promise<boolean> {
    return Object.prototype.hasOwnProperty.call(this.files, p);
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(p: string): Promise<string> {
    const v = this.files[p];
    if (v === undefined) throw new Error('ENOENT');
    return v;
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
  async list(): Promise<VaultListing> {
    return { files: [], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

const ctx = (vault: VaultAdapter): ReturnType<typeof makeToolCtx> =>
  makeToolCtx({ thread: 't1', vault });

describe('read_file tool — shape', () => {
  it('declares id, requiresConfirmation=false, builtin source', () => {
    const tool = createReadFileTool();
    expect(tool.id).toBe('read_file');
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.source).toBe('builtin');
    expect(tool.parameters.type).toBe('object');
    expect(tool.parameters.required ?? []).toContain('path');
    expect(tool.parameters.properties?.path?.type).toBe('string');
    expect(tool.parameters.properties?.maxBytes?.type).toBe('integer');
  });
});

describe('read_file tool — validation', () => {
  it('rejects unsafe paths', () => {
    const tool = createReadFileTool();
    expect(tool.validate({ path: '/abs' }).ok).toBe(false);
    expect(tool.validate({ path: '../up' }).ok).toBe(false);
    expect(tool.validate({ path: 'a/../b' }).ok).toBe(false);
    expect(tool.validate({ path: '' }).ok).toBe(false);
  });

  it('accepts safe paths and optional maxBytes', () => {
    const tool = createReadFileTool();
    expect(tool.validate({ path: 'src/config.json' }).ok).toBe(true);
    expect(tool.validate({ path: 'a.json', maxBytes: 1024 }).ok).toBe(true);
  });

  it('rejects non-positive maxBytes', () => {
    const tool = createReadFileTool();
    expect(tool.validate({ path: 'a.json', maxBytes: 0 }).ok).toBe(false);
    expect(tool.validate({ path: 'a.json', maxBytes: -1 }).ok).toBe(false);
  });
});

describe('read_file tool — invocation', () => {
  it('reads a text file end-to-end with cat -n style line numbering', async () => {
    const vault = new FakeVault({ 'config.json': '{"a":1}' });
    const tool = createReadFileTool();
    const res = await tool.invoke({ path: 'config.json' }, ctx(vault));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.path).toBe('config.json');
      expect(res.data.content).toBe('1\t{"a":1}');
      expect(res.data.bytes).toBe(7);
      expect(res.data.truncated).toBe(false);
      expect(res.data.totalLines).toBe(1);
      expect(res.data.startLine).toBe(1);
      expect(res.data.numLines).toBe(1);
    }
  });

  it('returns error when file is missing', async () => {
    const vault = new FakeVault({});
    const tool = createReadFileTool();
    const res = await tool.invoke({ path: 'gone.txt' }, ctx(vault));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('not found');
  });

  it('rejects binary content', async () => {
    const binary = '\x00\x01\x02\x03binary blob';
    const vault = new FakeVault({ 'logo.bin': binary });
    const tool = createReadFileTool();
    const res = await tool.invoke({ path: 'logo.bin' }, ctx(vault));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('binary');
  });

  it('truncates content above maxBytes and reports truncated=true', async () => {
    const big = 'A'.repeat(100);
    const vault = new FakeVault({ 'big.txt': big });
    const tool = createReadFileTool();
    const res = await tool.invoke({ path: 'big.txt', maxBytes: 32 }, ctx(vault));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.bytes).toBe(32);
      expect(res.data.truncated).toBe(true);
      expect(res.data.content).toBe(`1\t${'A'.repeat(32)}`);
    }
  });

  it('returns error when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const vault = new FakeVault({ 'a.txt': 'hi' });
    const tool = createReadFileTool();
    const res = await tool.invoke(
      { path: 'a.txt' },
      makeToolCtx({ thread: 't', vault, signal: ac.signal }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('aborted');
  });
});
