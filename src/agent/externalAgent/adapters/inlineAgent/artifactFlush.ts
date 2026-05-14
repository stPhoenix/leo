import { promises as fs } from 'node:fs';
import type { ExternalEvent } from '../base';
import type { Sandbox } from './sandbox';
import type { InlineAgentLoggerLite } from './eventBridge';
import type { InlineAgentRunState } from './runState';
import { mimeFromRelPath } from './tools/publishArtifact';

export interface ArtifactFlushDeps {
  readonly runState: InlineAgentRunState;
  readonly sandbox: Sandbox;
  readonly logger: InlineAgentLoggerLite;
}

type ArtifactLoadResult =
  | { ok: true; buf: Buffer }
  | { ok: false; reason: 'path_outside_sandbox' | 'artifact_missing' };

export async function* flushPublishedArtifacts(
  deps: ArtifactFlushDeps,
): AsyncIterable<ExternalEvent> {
  for (const nomination of deps.runState.publishedArtifacts) {
    const loaded = await loadArtifact(deps, nomination.relPath);
    if (!loaded.ok) {
      yield buildSkipEvent(nomination.relPath, loaded.reason);
      continue;
    }
    const mime = mimeFromRelPath(nomination.relPath);
    const content = mime?.startsWith('text/')
      ? loaded.buf.toString('utf8')
      : new Uint8Array(loaded.buf.buffer, loaded.buf.byteOffset, loaded.buf.byteLength);
    yield {
      type: 'file',
      relPath: nomination.relPath,
      content,
      ...(mime !== undefined ? { mime } : {}),
    };
  }
}

async function loadArtifact(deps: ArtifactFlushDeps, relPath: string): Promise<ArtifactLoadResult> {
  const resolved = deps.sandbox.resolve(relPath);
  if (!resolved.ok) {
    deps.logger.warn('externalAgent.adapter.inlineAgent.artifact.invalid-path', {
      relPath,
      reason: 'path_outside_sandbox',
    });
    return { ok: false, reason: 'path_outside_sandbox' };
  }
  const safe = await deps.sandbox.checkSafe(resolved.absPath);
  if (!safe.ok) {
    const reason: 'artifact_missing' | 'path_outside_sandbox' =
      safe.error === 'not_found' ? 'artifact_missing' : 'path_outside_sandbox';
    deps.logger.warn('externalAgent.adapter.inlineAgent.artifact.missing', { relPath, reason });
    return { ok: false, reason };
  }
  try {
    const buf = await fs.readFile(resolved.absPath);
    return { ok: true, buf };
  } catch {
    deps.logger.warn('externalAgent.adapter.inlineAgent.artifact.missing', {
      relPath,
      reason: 'artifact_missing',
    });
    return { ok: false, reason: 'artifact_missing' };
  }
}

function buildSkipEvent(
  relPath: string,
  reason: 'path_outside_sandbox' | 'artifact_missing',
): ExternalEvent {
  return {
    type: 'log',
    level: 'warn',
    msg: `artifact_skipped ${JSON.stringify({ relPath, reason })}`,
  };
}
