import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sandbox } from '@/agent/externalAgent/adapters/inlineAgent/sandbox';
import {
  createReadFileTool,
  createWriteFileTool,
  createListDirTool,
  createDeleteFileTool,
  looksBinary,
} from '@/agent/externalAgent/adapters/inlineAgent/tools/fileOps';
import type { InlineAgentLoggerLite } from '@/agent/externalAgent/adapters/inlineAgent/eventBridge';

const noopLogger: InlineAgentLoggerLite = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('file ops tools (F08)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;
  let signal: AbortSignal;

  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-fileops-test-'));
    sandbox = new Sandbox({
      runId: `run-${Date.now()}`,
      logger: noopLogger,
      tempDir: () => scratchTemp,
      quotaBytes: 10_000,
    });
    await sandbox.init();
    signal = new AbortController().signal;
  });

  afterEach(async () => {
    await sandbox.cleanup();
    try {
      rmSync(scratchTemp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('read_file: AC1 path-escape rejected', async () => {
    const tool = createReadFileTool({ sandbox, signal, logger: noopLogger });
    expect(await tool.invoke({ relPath: '../etc/passwd' })).toMatchObject({
      ok: false,
      error: 'path_outside_sandbox',
    });
  });

  it('read_file: AC2 returns content + eof', async () => {
    writeFileSync(join(sandbox.root, 'hello.txt'), 'hello world');
    const tool = createReadFileTool({ sandbox, signal, logger: noopLogger });
    const out = await tool.invoke({ relPath: 'hello.txt' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.content).toBe('hello world');
      expect(out.data.encoding).toBe('utf-8');
      expect(out.data.bytesRead).toBe(11);
      expect(out.data.eof).toBe(true);
    }
  });

  it('read_file: AC2 honors offset + limit', async () => {
    writeFileSync(join(sandbox.root, 'file.txt'), 'abcdef');
    const tool = createReadFileTool({ sandbox, signal, logger: noopLogger });
    const out = await tool.invoke({ relPath: 'file.txt', offset: 2, limit: 3 });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.content).toBe('cde');
      expect(out.data.bytesRead).toBe(3);
      expect(out.data.eof).toBe(false);
    }
  });

  it('read_file: AC2 binary content base64-encoded', async () => {
    writeFileSync(join(sandbox.root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0xfe]));
    const tool = createReadFileTool({ sandbox, signal, logger: noopLogger });
    const out = await tool.invoke({ relPath: 'bin.dat' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.encoding).toBe('base64');
  });

  it('read_file: AC2 limit > maxBytes → too_large', async () => {
    writeFileSync(join(sandbox.root, 'a.txt'), 'x');
    const tool = createReadFileTool({ sandbox, signal, logger: noopLogger, readMaxBytes: 100 });
    const out = await tool.invoke({ relPath: 'a.txt', limit: 200 });
    expect(out).toMatchObject({ ok: false, error: 'too_large' });
  });

  it('read_file: AC6 missing → not_found typed error (no throw)', async () => {
    const tool = createReadFileTool({ sandbox, signal, logger: noopLogger });
    expect(await tool.invoke({ relPath: 'nope.txt' })).toMatchObject({
      ok: false,
      error: 'not_found',
    });
  });

  it('write_file: AC3 creates parent dirs + updates sandbox.bytes', async () => {
    const tool = createWriteFileTool({ sandbox, signal, logger: noopLogger });
    const out = await tool.invoke({ relPath: 'a/b/c.txt', content: 'hello' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.bytesWritten).toBe(5);
      expect(out.data.sandboxBytes).toBe(5);
    }
    expect(sandbox.bytes()).toBe(5);
    expect(await fs.readFile(join(sandbox.root, 'a/b/c.txt'), 'utf8')).toBe('hello');
  });

  it('write_file: AC3 quota_exceeded blocks write', async () => {
    const tool = createWriteFileTool({ sandbox, signal, logger: noopLogger });
    const big = 'x'.repeat(20_000);
    const out = await tool.invoke({ relPath: 'big.txt', content: big });
    expect(out).toMatchObject({ ok: false, error: 'quota_exceeded' });
    expect(sandbox.bytes()).toBe(0);
  });

  it('write_file: AC3 base64 encoding', async () => {
    const tool = createWriteFileTool({ sandbox, signal, logger: noopLogger });
    const out = await tool.invoke({
      relPath: 'b.bin',
      content: Buffer.from([1, 2, 3]).toString('base64'),
      encoding: 'base64',
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.bytesWritten).toBe(3);
  });

  it('list_dir: AC4 alphabetical entries with file bytes', async () => {
    writeFileSync(join(sandbox.root, 'b.txt'), '12');
    writeFileSync(join(sandbox.root, 'a.txt'), '3456');
    mkdirSync(join(sandbox.root, 'sub'));
    const tool = createListDirTool({ sandbox, signal, logger: noopLogger });
    const out = await tool.invoke({});
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt', 'sub']);
      expect(out.data.entries[0]).toMatchObject({ type: 'file', bytes: 4 });
      expect(out.data.entries[2]).toMatchObject({ type: 'dir' });
    }
  });

  it('list_dir: AC4 sub path lists', async () => {
    mkdirSync(join(sandbox.root, 'sub'));
    writeFileSync(join(sandbox.root, 'sub/c.txt'), 'hi');
    const tool = createListDirTool({ sandbox, signal, logger: noopLogger });
    const out = await tool.invoke({ relPath: 'sub' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.entries[0]?.name).toBe('c.txt');
  });

  it('list_dir: not_found for missing', async () => {
    const tool = createListDirTool({ sandbox, signal, logger: noopLogger });
    expect(await tool.invoke({ relPath: 'nope' })).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('delete_file: AC5 removes file and decrements sandbox.bytes', async () => {
    const wTool = createWriteFileTool({ sandbox, signal, logger: noopLogger });
    await wTool.invoke({ relPath: 'gone.txt', content: 'abcde' });
    expect(sandbox.bytes()).toBe(5);
    const dTool = createDeleteFileTool({ sandbox, signal, logger: noopLogger });
    const out = await dTool.invoke({ relPath: 'gone.txt' });
    expect(out).toMatchObject({ ok: true, data: { deleted: true } });
    expect(sandbox.bytes()).toBe(0);
  });

  it('delete_file: AC5 non-empty dir → not_empty', async () => {
    mkdirSync(join(sandbox.root, 'd'));
    writeFileSync(join(sandbox.root, 'd/x.txt'), 'a');
    const tool = createDeleteFileTool({ sandbox, signal, logger: noopLogger });
    expect(await tool.invoke({ relPath: 'd' })).toMatchObject({ ok: false, error: 'not_empty' });
  });

  it('delete_file: AC5 missing → not_found', async () => {
    const tool = createDeleteFileTool({ sandbox, signal, logger: noopLogger });
    expect(await tool.invoke({ relPath: 'gone.txt' })).toMatchObject({
      ok: false,
      error: 'not_found',
    });
  });

  it('all tools: AC7 Zod boundary rejects malformed input', async () => {
    const r = createReadFileTool({ sandbox, signal, logger: noopLogger });
    const w = createWriteFileTool({ sandbox, signal, logger: noopLogger });
    const l = createListDirTool({ sandbox, signal, logger: noopLogger });
    const d = createDeleteFileTool({ sandbox, signal, logger: noopLogger });
    expect(await r.invoke({})).toMatchObject({ ok: false, error: 'invalid_args' });
    expect(await w.invoke({})).toMatchObject({ ok: false, error: 'invalid_args' });
    expect(await l.invoke({ relPath: 5 })).toMatchObject({ ok: false, error: 'invalid_args' });
    expect(await d.invoke({})).toMatchObject({ ok: false, error: 'invalid_args' });
  });
});

describe('looksBinary heuristic', () => {
  it('detects null byte as binary', () => {
    expect(looksBinary(Buffer.from([0x00, 0x41]))).toBe(true);
  });
  it('treats ASCII text as not binary', () => {
    expect(looksBinary(Buffer.from('Hello, world!\n', 'utf8'))).toBe(false);
  });
  it('treats empty buffer as not binary', () => {
    expect(looksBinary(Buffer.alloc(0))).toBe(false);
  });
});
