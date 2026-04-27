import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  promises as fs,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sandbox, type SandboxLogger } from '@/agent/externalAgent/adapters/inlineAgent/sandbox';

interface CapturedLog {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly event: string;
  readonly fields?: Record<string, unknown>;
}

function makeLogger(captured: CapturedLog[] = []): {
  logger: SandboxLogger;
  captured: CapturedLog[];
} {
  const logger: SandboxLogger = {
    debug: (event, fields) =>
      captured.push({ level: 'debug', event, ...(fields !== undefined ? { fields } : {}) }),
    info: (event, fields) =>
      captured.push({ level: 'info', event, ...(fields !== undefined ? { fields } : {}) }),
    warn: (event, fields) =>
      captured.push({ level: 'warn', event, ...(fields !== undefined ? { fields } : {}) }),
    error: (event, fields) =>
      captured.push({ level: 'error', event, ...(fields !== undefined ? { fields } : {}) }),
  };
  return { logger, captured };
}

describe('Sandbox primitives (F03)', () => {
  let scratchTemp: string;

  beforeEach(() => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-sandbox-test-'));
  });

  afterEach(() => {
    try {
      rmSync(scratchTemp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('init() creates directory under tempDir/leo-inline-agent/<runId> with mode 0o700 (FR-IA-09)', async () => {
    const { logger } = makeLogger();
    const sandbox = new Sandbox({ runId: 'r1', logger, tempDir: () => scratchTemp });
    const result = await sandbox.init();
    expect(result).toEqual({ ok: true });
    const stat = statSync(sandbox.root);
    expect(stat.isDirectory()).toBe(true);
    if (process.platform !== 'win32') {
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o700);
    }
    await sandbox.cleanup();
  });

  it('init() reports sandbox_collision when run dir already exists', async () => {
    const { logger } = makeLogger();
    mkdirSync(join(scratchTemp, 'leo-inline-agent', 'collide'), { recursive: true });
    const sandbox = new Sandbox({ runId: 'collide', logger, tempDir: () => scratchTemp });
    const result = await sandbox.init();
    expect(result).toEqual({ ok: false, error: 'sandbox_collision', cause: 'directory exists' });
  });

  it('resolve() rejects path traversal (FR-IA-10, AC2)', async () => {
    const { logger } = makeLogger();
    const sandbox = new Sandbox({ runId: 'r2', logger, tempDir: () => scratchTemp });
    await sandbox.init();
    expect(sandbox.resolve('../etc/passwd')).toEqual({ ok: false, error: 'path_outside_sandbox' });
    expect(sandbox.resolve('/etc/passwd')).toEqual({ ok: false, error: 'path_outside_sandbox' });
    expect(sandbox.resolve('legit/../../escape')).toEqual({
      ok: false,
      error: 'path_outside_sandbox',
    });
  });

  it('resolve() accepts in-sandbox paths', async () => {
    const { logger } = makeLogger();
    const sandbox = new Sandbox({ runId: 'r3', logger, tempDir: () => scratchTemp });
    await sandbox.init();
    const ok = sandbox.resolve('notes/source.md');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.absPath).toBe(join(sandbox.root, 'notes', 'source.md'));
    expect(sandbox.resolve('')).toEqual({ ok: true, absPath: sandbox.root });
  });

  it('checkSafe() rejects symlink nodes (FR-IA-10, AC3)', async () => {
    if (process.platform === 'win32') return;
    const { logger } = makeLogger();
    const sandbox = new Sandbox({ runId: 'rlink', logger, tempDir: () => scratchTemp });
    await sandbox.init();
    const target = join(scratchTemp, 'outside.txt');
    writeFileSync(target, 'leak');
    const link = join(sandbox.root, 'sneak.txt');
    symlinkSync(target, link);
    const result = await sandbox.checkSafe(link);
    expect(result).toEqual({ ok: false, error: 'path_outside_sandbox' });
    await sandbox.cleanup();
  });

  it('checkSafe() returns not_found for missing files', async () => {
    const { logger } = makeLogger();
    const sandbox = new Sandbox({ runId: 'rmiss', logger, tempDir: () => scratchTemp });
    await sandbox.init();
    const result = await sandbox.checkSafe(join(sandbox.root, 'nope.txt'));
    expect(result).toEqual({ ok: false, error: 'not_found' });
    await sandbox.cleanup();
  });

  it('addBytes/willExceedQuota track projected total (FR-IA-12, AC5)', async () => {
    const { logger } = makeLogger();
    const sandbox = new Sandbox({
      runId: 'rq',
      logger,
      quotaBytes: 1_000,
      tempDir: () => scratchTemp,
    });
    expect(sandbox.bytes()).toBe(0);
    expect(sandbox.willExceedQuota(500)).toBe(false);
    sandbox.addBytes(500);
    expect(sandbox.bytes()).toBe(500);
    expect(sandbox.willExceedQuota(500)).toBe(false);
    expect(sandbox.willExceedQuota(501)).toBe(true);
    sandbox.addBytes(-200);
    expect(sandbox.bytes()).toBe(300);
  });

  it('cleanup() is idempotent and never throws (FR-IA-11)', async () => {
    const { logger, captured } = makeLogger();
    const sandbox = new Sandbox({ runId: 'rclean', logger, tempDir: () => scratchTemp });
    await sandbox.init();
    await sandbox.cleanup();
    await sandbox.cleanup();
    const stat = await fs.stat(sandbox.root).catch((e) => e);
    expect((stat as NodeJS.ErrnoException).code).toBe('ENOENT');
    expect(captured.filter((l) => l.level === 'error')).toHaveLength(0);
  });

  it('cleanup() logs warn on rm failure but does not throw (NFR-IA-04)', async () => {
    const { logger, captured } = makeLogger();
    const sandbox = new Sandbox({ runId: 'rcleanfail', logger, tempDir: () => scratchTemp });
    await sandbox.init();
    const rmSpy = vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('boom'));
    await expect(sandbox.cleanup()).resolves.toBeUndefined();
    expect(captured.some((l) => l.level === 'warn' && l.event.includes('cleanup-failed'))).toBe(
      true,
    );
    rmSpy.mockRestore();
    await sandbox.cleanup();
  });

  it('sweepOrphans removes stale dirs and skips fresh ones (AC7)', async () => {
    const { logger } = makeLogger();
    const root = join(scratchTemp, 'leo-inline-agent');
    mkdirSync(join(root, 'stale'), { recursive: true });
    mkdirSync(join(root, 'fresh'), { recursive: true });
    const stalePath = join(root, 'stale');
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(stalePath, oldTime, oldTime);
    const freshPath = join(root, 'fresh');
    await fs.utimes(freshPath, new Date(), new Date());

    await Sandbox.sweepOrphans({ logger, tempDir: () => scratchTemp });

    expect(await fs.stat(freshPath).catch(() => null)).not.toBeNull();
    expect(await fs.stat(stalePath).catch((e) => (e as NodeJS.ErrnoException).code)).toBe('ENOENT');
  });

  it('sweepOrphans is no-op when root dir absent', async () => {
    const { logger, captured } = makeLogger();
    await Sandbox.sweepOrphans({ logger, tempDir: () => scratchTemp });
    expect(captured.some((l) => l.level === 'warn')).toBe(false);
  });
});

describe('Adapter sandbox lifecycle (FR-IA-11, AC4)', () => {
  it('cleanup runs in finally regardless of how start() exits', async () => {
    const { InlineAgentAdapter } = await import('@/agent/externalAgent/adapters/inlineAgent');
    const { logger } = makeLogger();
    const adapter = new InlineAgentAdapter({
      providerFactory: () => {
        throw new Error('unused');
      },
      logger,
    });
    const ctrl = new AbortController();
    const events = [];
    const runId = `lifecycle-${Date.now()}`;
    for await (const ev of adapter.start({
      refinedAsk: 'hello',
      systemPrompt: '',
      signal: ctrl.signal,
      timeoutMs: 5_000,
      config: {},
      runId,
    })) {
      events.push(ev);
    }
    // F16 graph short-circuits on the throwing provider stub; cleanup must
    // still run in `finally`.
    const last = events.at(-1) as { type: string; error?: { code: string } } | undefined;
    expect(last?.type).toBe('error');
    expect(last?.error?.code).toBe('invalid_provider');
    const sandboxPath = join(tmpdir(), 'leo-inline-agent', runId);
    const stat = await fs.stat(sandboxPath).catch((e) => (e as NodeJS.ErrnoException).code);
    expect(stat).toBe('ENOENT');
  });
});
