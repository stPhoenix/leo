import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sandbox } from '@/agent/externalAgent/adapters/inlineAgent/sandbox';
import { flushPublishedArtifacts } from '@/agent/externalAgent/adapters/inlineAgent/artifactFlush';
import type { InlineAgentLoggerLite } from '@/agent/externalAgent/adapters/inlineAgent/eventBridge';
import type { InlineAgentRunState } from '@/agent/externalAgent/adapters/inlineAgent/runState';
import { createInitialRunState } from '@/agent/externalAgent/adapters/inlineAgent/runState';
import type { ExternalEvent } from '@/agent/externalAgent/adapters/base';

const noopLogger: InlineAgentLoggerLite = {
  debug: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

interface CapturedWarn {
  event: string;
  fields: Record<string, unknown> | undefined;
}

function captureLogger(): { logger: InlineAgentLoggerLite; warns: CapturedWarn[] } {
  const warns: CapturedWarn[] = [];
  return {
    logger: {
      debug: (): void => undefined,
      info: (): void => undefined,
      warn: (event: string, fields?: Record<string, unknown>): void => {
        warns.push({ event, fields });
      },
      error: (): void => undefined,
    },
    warns,
  };
}

async function makeSandbox(suffix: string): Promise<Sandbox> {
  const sb = new Sandbox({
    runId: `flush-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    logger: noopLogger,
    tempDir: () => tmpdir(),
  });
  const init = await sb.init();
  if (!init.ok) throw new Error(`sandbox init failed: ${init.error}`);
  return sb;
}

function makeRunState(sb: Sandbox): InlineAgentRunState {
  return createInitialRunState({
    runId: sb.runId,
    sandboxRoot: sb.root,
    routingMode: 'simple',
    startedAt: 0,
  });
}

async function collect(
  deps: Parameters<typeof flushPublishedArtifacts>[0],
): Promise<ExternalEvent[]> {
  const out: ExternalEvent[] = [];
  for await (const ev of flushPublishedArtifacts(deps)) out.push(ev);
  return out;
}

describe('artifactFlush — flushPublishedArtifacts', () => {
  it('emits a file event with mime + text content for a published artifact in the sandbox', async () => {
    const sb = await makeSandbox('happy');
    try {
      const runState = makeRunState(sb);
      const target = join(sb.root, 'note.md');
      await fs.writeFile(target, 'hello body', 'utf8');
      runState.publishedArtifacts.push({ relPath: 'note.md' });

      const events = await collect({ runState, sandbox: sb, logger: noopLogger });
      expect(events).toHaveLength(1);
      const ev = events[0];
      if (ev?.type !== 'file') throw new Error('expected file event');
      expect(ev.relPath).toBe('note.md');
      expect(ev.mime).toBe('text/markdown');
      expect(ev.content).toBe('hello body');
    } finally {
      await sb.cleanup();
    }
  });

  it('emits binary content (Uint8Array) for non-text mime types', async () => {
    const sb = await makeSandbox('bin');
    try {
      const runState = makeRunState(sb);
      const target = join(sb.root, 'pic.png');
      await fs.writeFile(target, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      runState.publishedArtifacts.push({ relPath: 'pic.png' });

      const events = await collect({ runState, sandbox: sb, logger: noopLogger });
      expect(events).toHaveLength(1);
      const ev = events[0];
      if (ev?.type !== 'file') throw new Error('expected file event');
      expect(ev.mime).toBe('image/png');
      expect(ev.content).toBeInstanceOf(Uint8Array);
    } finally {
      await sb.cleanup();
    }
  });

  it('skips path_outside_sandbox with log event + warn', async () => {
    const sb = await makeSandbox('outside');
    try {
      const { logger, warns } = captureLogger();
      const runState = makeRunState(sb);
      runState.publishedArtifacts.push({ relPath: '../escape.md' });

      const events = await collect({ runState, sandbox: sb, logger });
      expect(events).toHaveLength(1);
      const ev = events[0];
      if (ev?.type !== 'log') throw new Error('expected log event');
      expect(ev.level).toBe('warn');
      expect(ev.msg).toContain('artifact_skipped');
      expect(ev.msg).toContain('path_outside_sandbox');
      expect(warns).toHaveLength(1);
      expect(warns[0]?.event).toContain('artifact.invalid-path');
    } finally {
      await sb.cleanup();
    }
  });

  it('skips artifact_missing when file does not exist', async () => {
    const sb = await makeSandbox('missing');
    try {
      const { logger, warns } = captureLogger();
      const runState = makeRunState(sb);
      runState.publishedArtifacts.push({ relPath: 'never-written.md' });

      const events = await collect({ runState, sandbox: sb, logger });
      expect(events).toHaveLength(1);
      const ev = events[0];
      if (ev?.type !== 'log') throw new Error('expected log event');
      expect(ev.msg).toContain('artifact_missing');
      expect(warns).toHaveLength(1);
      expect(warns[0]?.event).toContain('artifact.missing');
    } finally {
      await sb.cleanup();
    }
  });

  it('processes multiple artifacts in declaration order', async () => {
    const sb = await makeSandbox('order');
    try {
      const runState = makeRunState(sb);
      await fs.writeFile(join(sb.root, 'a.md'), 'A', 'utf8');
      await fs.writeFile(join(sb.root, 'b.md'), 'B', 'utf8');
      runState.publishedArtifacts.push({ relPath: 'a.md' }, { relPath: 'b.md' });

      const events = await collect({ runState, sandbox: sb, logger: noopLogger });
      const names = events
        .filter((e): e is Extract<ExternalEvent, { type: 'file' }> => e.type === 'file')
        .map((e) => e.relPath);
      expect(names).toEqual(['a.md', 'b.md']);
    } finally {
      await sb.cleanup();
    }
  });
});
