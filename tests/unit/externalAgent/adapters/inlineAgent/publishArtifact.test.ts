import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sandbox } from '@/agent/externalAgent/adapters/inlineAgent/sandbox';
import {
  createPublishArtifactTool,
  mimeFromRelPath,
} from '@/agent/externalAgent/adapters/inlineAgent/tools/publishArtifact';
import { flushPublishedArtifacts } from '@/agent/externalAgent/adapters/inlineAgent/artifactFlush';
import {
  createInitialRunState,
  type InlineAgentRunState,
} from '@/agent/externalAgent/adapters/inlineAgent/runState';
import type { InlineAgentLoggerLite } from '@/agent/externalAgent/adapters/inlineAgent/eventBridge';

interface CapturedLog {
  level: string;
  event: string;
  fields: Record<string, unknown> | undefined;
}

function makeLogger(): { logger: InlineAgentLoggerLite; calls: CapturedLog[] } {
  const calls: CapturedLog[] = [];
  const logger: InlineAgentLoggerLite = {
    debug: (event, fields) => calls.push({ level: 'debug', event, fields }),
    info: (event, fields) => calls.push({ level: 'info', event, fields }),
    warn: (event, fields) => calls.push({ level: 'warn', event, fields }),
    error: (event, fields) => calls.push({ level: 'error', event, fields }),
  };
  return { logger, calls };
}

describe('publish_artifact tool (F09)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;
  let runState: InlineAgentRunState;

  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-publish-test-'));
    sandbox = new Sandbox({
      runId: `r-${Date.now()}`,
      logger: makeLogger().logger,
      tempDir: () => scratchTemp,
      quotaBytes: 100_000,
    });
    await sandbox.init();
    runState = createInitialRunState({
      runId: 'r-x',
      sandboxRoot: sandbox.root,
      routingMode: 'auto',
      startedAt: 0,
    });
  });

  afterEach(async () => {
    await sandbox.cleanup();
    try {
      rmSync(scratchTemp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('AC1 — buffers nominations without writing past the sandbox', async () => {
    writeFileSync(join(sandbox.root, 'out.md'), 'hello');
    const { logger } = makeLogger();
    const tool = createPublishArtifactTool({
      config: { maxArtifacts: 32 },
      sandbox,
      logger,
      runState,
    });
    const out = await tool.invoke({ relPath: 'out.md' });
    expect(out).toMatchObject({
      ok: true,
      data: { published: 1, remaining: 31 },
    });
    expect(runState.publishedArtifacts).toEqual([{ relPath: 'out.md' }]);
  });

  it('AC2 — count cap → artifact_limit', async () => {
    const { logger } = makeLogger();
    const tool = createPublishArtifactTool({
      config: { maxArtifacts: 2 },
      sandbox,
      logger,
      runState,
    });
    writeFileSync(join(sandbox.root, 'a.md'), 'a');
    writeFileSync(join(sandbox.root, 'b.md'), 'b');
    writeFileSync(join(sandbox.root, 'c.md'), 'c');
    expect(await tool.invoke({ relPath: 'a.md' })).toMatchObject({ ok: true });
    expect(await tool.invoke({ relPath: 'b.md' })).toMatchObject({ ok: true });
    expect(await tool.invoke({ relPath: 'c.md' })).toMatchObject({
      ok: false,
      error: 'artifact_limit',
    });
  });

  it('AC3 — duplicate / non-existent rejection', async () => {
    writeFileSync(join(sandbox.root, 'a.md'), 'a');
    const { logger } = makeLogger();
    const tool = createPublishArtifactTool({
      config: { maxArtifacts: 4 },
      sandbox,
      logger,
      runState,
    });
    expect(await tool.invoke({ relPath: 'a.md' })).toMatchObject({ ok: true });
    expect(await tool.invoke({ relPath: 'a.md' })).toMatchObject({ ok: false, error: 'duplicate' });
    expect(await tool.invoke({ relPath: 'gone.md' })).toMatchObject({
      ok: false,
      error: 'not_found',
    });
  });

  it('AC1 — path-escape rejected', async () => {
    const { logger } = makeLogger();
    const tool = createPublishArtifactTool({
      config: { maxArtifacts: 4 },
      sandbox,
      logger,
      runState,
    });
    expect(await tool.invoke({ relPath: '../escape' })).toMatchObject({
      ok: false,
      error: 'path_outside_sandbox',
    });
  });
});

describe('flushPublishedArtifacts (F09)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;
  let runState: InlineAgentRunState;

  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-flush-test-'));
    sandbox = new Sandbox({
      runId: `r-${Date.now()}`,
      logger: makeLogger().logger,
      tempDir: () => scratchTemp,
      quotaBytes: 100_000,
    });
    await sandbox.init();
    runState = createInitialRunState({
      runId: 'r-x',
      sandboxRoot: sandbox.root,
      routingMode: 'auto',
      startedAt: 0,
    });
  });

  afterEach(async () => {
    await sandbox.cleanup();
    try {
      rmSync(scratchTemp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('AC4 — emits one file event per nominated artifact in order', async () => {
    writeFileSync(join(sandbox.root, 'one.md'), '# one');
    writeFileSync(join(sandbox.root, 'two.json'), '{"ok":true}');
    runState.publishedArtifacts.push({ relPath: 'one.md', summary: 's1' });
    runState.publishedArtifacts.push({ relPath: 'two.json', summary: 's2' });
    const { logger } = makeLogger();
    const events = [];
    for await (const ev of flushPublishedArtifacts({ runState, sandbox, logger })) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual(['file', 'file']);
    expect(events[0]).toMatchObject({ type: 'file', relPath: 'one.md', mime: 'text/markdown' });
    expect(events[1]).toMatchObject({
      type: 'file',
      relPath: 'two.json',
      mime: 'application/json',
    });
  });

  it('AC5 — missing artifact at flush → warn log + skip; run does not abort', async () => {
    writeFileSync(join(sandbox.root, 'present.md'), 'here');
    runState.publishedArtifacts.push({ relPath: 'gone.md' });
    runState.publishedArtifacts.push({ relPath: 'present.md' });
    const { logger, calls } = makeLogger();
    const events = [];
    for await (const ev of flushPublishedArtifacts({ runState, sandbox, logger })) {
      events.push(ev);
    }
    expect(events).toHaveLength(2);
    const fileEvents = events.filter((e) => e.type === 'file');
    expect(fileEvents).toHaveLength(1);
    expect(fileEvents[0]).toMatchObject({ relPath: 'present.md' });
    expect(
      calls.find((c) => c.level === 'warn' && c.event.includes('artifact.missing')),
    ).toBeDefined();
  });

  it('AC7 — nomination present at nomination time, deleted before flush → warn skip', async () => {
    writeFileSync(join(sandbox.root, 'rm.md'), 'rm');
    runState.publishedArtifacts.push({ relPath: 'rm.md' });
    unlinkSync(join(sandbox.root, 'rm.md'));
    const { logger } = makeLogger();
    const events = [];
    for await (const ev of flushPublishedArtifacts({ runState, sandbox, logger })) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual(['log']);
  });

  it('binary artifact emitted as Uint8Array content', async () => {
    writeFileSync(join(sandbox.root, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    runState.publishedArtifacts.push({ relPath: 'pic.png' });
    const { logger } = makeLogger();
    const events = [];
    for await (const ev of flushPublishedArtifacts({ runState, sandbox, logger })) {
      events.push(ev);
    }
    expect(events).toHaveLength(1);
    if (events[0]?.type === 'file') {
      expect(events[0].mime).toBe('image/png');
      expect(events[0].content).toBeInstanceOf(Uint8Array);
    }
  });
});

describe('mimeFromRelPath', () => {
  it.each([
    ['x.md', 'text/markdown'],
    ['x.txt', 'text/plain'],
    ['x.json', 'application/json'],
    ['x.csv', 'text/csv'],
    ['x.png', 'image/png'],
    ['x.jpg', 'image/jpeg'],
    ['x.JPEG', 'image/jpeg'],
    ['x.pdf', 'application/pdf'],
    ['x.unknown', undefined],
    ['no-ext', undefined],
  ])('%s → %s', (path, expected) => {
    expect(mimeFromRelPath(path)).toBe(expected);
  });
});
