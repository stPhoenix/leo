import { describe, expect, it } from 'vitest';
import {
  ResultWriter,
  buildErrorMarkdown,
  buildRequestMarkdown,
  sanitizeRelPath,
} from '@/agent/externalAgent/resultWriter';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class MemVault implements VaultAdapter {
  readonly text = new Map<string, string>();
  readonly bin = new Map<string, Uint8Array>();
  readonly folders = new Set<string>();
  failOn: string | null = null;

  async exists(p: string): Promise<boolean> {
    return this.text.has(p) || this.bin.has(p) || this.folders.has(p);
  }
  async mkdir(p: string): Promise<void> {
    this.folders.add(p);
  }
  async read(p: string): Promise<string> {
    const v = this.text.get(p);
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    if (p === this.failOn) throw new Error('disk full');
    this.assertParentDir(p);
    this.text.set(p, d);
  }
  async writeBinary(p: string, d: Uint8Array): Promise<void> {
    if (p === this.failOn) throw new Error('disk full');
    this.assertParentDir(p);
    this.bin.set(p, d);
  }
  private assertParentDir(p: string): void {
    const lastSlash = p.lastIndexOf('/');
    if (lastSlash <= 0) return;
    const dir = p.slice(0, lastSlash);
    if (!this.folders.has(dir)) {
      throw new Error(`ENOENT: parent dir missing for ${p}`);
    }
  }
  async rename(): Promise<void> {
    /* */
  }
  async remove(p: string): Promise<void> {
    this.text.delete(p);
    this.bin.delete(p);
  }
  async list(): Promise<VaultListing> {
    return { files: [...this.text.keys(), ...this.bin.keys()], folders: [...this.folders] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

const baseInput = {
  runId: '20260427-141503-a1b2c3',
  threadId: 't1',
  adapterId: 'mock-adapter',
  refinedPrompt: 'Find me 3 references on X',
  startedAt: Date.UTC(2026, 3, 27, 14, 15, 3),
  endedAt: Date.UTC(2026, 3, 27, 14, 18, 42),
};

describe('sanitizeRelPath', () => {
  it('accepts plain relative path', () => {
    const r = sanitizeRelPath('docs/output.md');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.relPath).toBe('docs/output.md');
  });

  it('normalizes backslashes', () => {
    const r = sanitizeRelPath('a\\b\\c.md');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.relPath).toBe('a/b/c.md');
  });

  it('rejects empty input', () => {
    const r = sanitizeRelPath('');
    expect(r.ok).toBe(false);
  });

  it('rejects leading slash', () => {
    const r = sanitizeRelPath('/etc/passwd');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_path');
  });

  it('rejects leading drive letter', () => {
    const r = sanitizeRelPath('C:\\Windows\\system32');
    expect(r.ok).toBe(false);
  });

  it('rejects parent traversal anywhere in the path', () => {
    expect(sanitizeRelPath('../escape').ok).toBe(false);
    expect(sanitizeRelPath('a/../b').ok).toBe(false);
    expect(sanitizeRelPath('a/b/..').ok).toBe(false);
  });

  it('rejects NUL char', () => {
    const r = sanitizeRelPath('foo\0bar');
    expect(r.ok).toBe(false);
  });
});

describe('buildRequestMarkdown', () => {
  it('emits frontmatter with required keys', () => {
    const md = buildRequestMarkdown({
      ...baseInput,
      status: 'done',
    });
    expect(md).toContain(`runId: ${baseInput.runId}`);
    expect(md).toContain(`adapter: ${baseInput.adapterId}`);
    expect(md).toContain(`threadId: ${baseInput.threadId}`);
    expect(md).toContain('startedAt: 2026-04-27T14:15:03.000Z');
    expect(md).toContain('endedAt: 2026-04-27T14:18:42.000Z');
    expect(md).toContain('status: done');
    expect(md).toContain('# Refined Prompt');
    expect(md).toContain(baseInput.refinedPrompt);
  });
});

describe('buildErrorMarkdown', () => {
  it('emits error code, message, partial files, refined prompt', () => {
    const md = buildErrorMarkdown({
      runId: baseInput.runId,
      adapterId: baseInput.adapterId,
      startedAt: baseInput.startedAt,
      endedAt: baseInput.endedAt,
      error: { code: 'timeout', message: 'adapter took too long' },
      refinedPrompt: baseInput.refinedPrompt,
      partialFiles: ['response.md'],
    });
    expect(md).toContain('errorCode: timeout');
    expect(md).toContain('**code**: timeout');
    expect(md).toContain('**message**: adapter took too long');
    expect(md).toContain('- response.md');
    expect(md).toContain(baseInput.refinedPrompt);
  });
});

describe('ResultWriter.write', () => {
  it('happy path writes request.md, response.md, and adapter files', async () => {
    const vault = new MemVault();
    const w = new ResultWriter({ vault });
    const r = await w.write({
      ...baseInput,
      textBuffer: 'Streamed response body.',
      files: [
        { relPath: 'sources.md', content: '# Refs\n- one\n' },
        { relPath: 'extra/img.bin', content: new Uint8Array([1, 2, 3, 4]) },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.folder).toBe('externalAgentResults/20260427-141503-a1b2c3');
    expect([...r.writtenFiles].sort()).toEqual([
      'extra/img.bin',
      'request.md',
      'response.md',
      'sources.md',
    ]);
    expect(vault.text.get(`${r.folder}/response.md`)).toBe('Streamed response body.');
    expect(vault.text.get(`${r.folder}/sources.md`)).toContain('# Refs');
    expect(vault.bin.get(`${r.folder}/extra/img.bin`)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('creates nested parent dirs before writing adapter files', async () => {
    const vault = new MemVault();
    const w = new ResultWriter({ vault });
    const r = await w.write({
      ...baseInput,
      textBuffer: 'body',
      files: [
        { relPath: 'canon/00-foo.md', content: '# Foo' },
        { relPath: 'canon/sub/bar.bin', content: new Uint8Array([9, 9]) },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(vault.folders.has(`${r.folder}/canon`)).toBe(true);
    expect(vault.folders.has(`${r.folder}/canon/sub`)).toBe(true);
    expect(vault.text.get(`${r.folder}/canon/00-foo.md`)).toBe('# Foo');
    expect(vault.bin.get(`${r.folder}/canon/sub/bar.bin`)).toEqual(new Uint8Array([9, 9]));
  });

  it('partial-write failure flushes error.md with code/message and partial inventory', async () => {
    const vault = new MemVault();
    vault.failOn = 'externalAgentResults/20260427-141503-a1b2c3/sources.md';
    const w = new ResultWriter({ vault });
    const r = await w.write({
      ...baseInput,
      textBuffer: 'partial body',
      files: [{ relPath: 'sources.md', content: 'will fail' }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('write_failed');
    expect(r.writtenFiles).toContain('request.md');
    expect(r.writtenFiles).toContain('response.md');
    expect(r.writtenFiles).toContain('error.md');
    const errorMd = vault.text.get(`${r.folder}/error.md`);
    expect(errorMd).toBeDefined();
    expect(errorMd).toContain('errorCode: write_failed');
    expect(errorMd).toContain('disk full');
  });

  it('sanitizer rejects malicious relPath without writing', async () => {
    const vault = new MemVault();
    const w = new ResultWriter({ vault });
    const r = await w.write({
      ...baseInput,
      textBuffer: '',
      files: [{ relPath: '../../etc/passwd', content: 'pwn' }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('invalid_path');
    // Reserved files were already written before sanitizer evaluated adapter file.
    const folder = r.folder ?? '';
    expect([...vault.text.keys()].some((k) => k === `${folder}/../../etc/passwd`)).toBe(false);
  });

  it('emits error.md when caller passes pre-existing error (e.g. timeout)', async () => {
    const vault = new MemVault();
    const w = new ResultWriter({ vault });
    const r = await w.write({
      ...baseInput,
      textBuffer: 'partial body',
      files: [],
      error: { code: 'timeout', message: 'adapter timed out' },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('timeout');
    expect(r.writtenFiles).toContain('error.md');
    const errorMd = vault.text.get(`${r.folder}/error.md`);
    expect(errorMd).toContain('errorCode: timeout');
    // request.md status reflects error
    const requestMd = vault.text.get(`${r.folder}/request.md`);
    expect(requestMd).toContain('status: error');
  });

  it('appends -retry suffix on folder collision', async () => {
    const vault = new MemVault();
    vault.folders.add('externalAgentResults/20260427-141503-a1b2c3');
    const w = new ResultWriter({ vault });
    const r = await w.write({
      ...baseInput,
      textBuffer: 'x',
      files: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.folder).toBe('externalAgentResults/20260427-141503-a1b2c3-retry');
  });

  it('rejects adapter file colliding with reserved request.md / response.md', async () => {
    const vault = new MemVault();
    const w = new ResultWriter({ vault });
    const r = await w.write({
      ...baseInput,
      textBuffer: '',
      files: [{ relPath: 'request.md', content: 'overwrite' }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('invalid_path');
  });
});
