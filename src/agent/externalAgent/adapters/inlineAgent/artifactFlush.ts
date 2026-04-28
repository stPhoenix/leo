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

export async function* flushPublishedArtifacts(
  deps: ArtifactFlushDeps,
): AsyncIterable<ExternalEvent> {
  for (const nomination of deps.runState.publishedArtifacts) {
    const resolved = deps.sandbox.resolve(nomination.relPath);
    if (!resolved.ok) {
      deps.logger.warn('externalAgent.adapter.inlineAgent.artifact.invalid-path', {
        relPath: nomination.relPath,
        reason: 'path_outside_sandbox',
      });
      yield {
        type: 'log',
        level: 'warn',
        msg: `artifact_skipped ${JSON.stringify({ relPath: nomination.relPath, reason: 'path_outside_sandbox' })}`,
      };
      continue;
    }
    const safe = await deps.sandbox.checkSafe(resolved.absPath);
    if (!safe.ok) {
      deps.logger.warn('externalAgent.adapter.inlineAgent.artifact.missing', {
        relPath: nomination.relPath,
        reason: safe.error === 'not_found' ? 'artifact_missing' : 'path_outside_sandbox',
      });
      yield {
        type: 'log',
        level: 'warn',
        msg: `artifact_skipped ${JSON.stringify({
          relPath: nomination.relPath,
          reason: safe.error === 'not_found' ? 'artifact_missing' : 'path_outside_sandbox',
        })}`,
      };
      continue;
    }
    let buf: Buffer;
    try {
      buf = await fs.readFile(resolved.absPath);
    } catch {
      deps.logger.warn('externalAgent.adapter.inlineAgent.artifact.missing', {
        relPath: nomination.relPath,
        reason: 'artifact_missing',
      });
      yield {
        type: 'log',
        level: 'warn',
        msg: `artifact_skipped ${JSON.stringify({ relPath: nomination.relPath, reason: 'artifact_missing' })}`,
      };
      continue;
    }
    const mime = mimeFromRelPath(nomination.relPath);
    const content =
      mime !== undefined && mime.startsWith('text/')
        ? buf.toString('utf8')
        : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    yield {
      type: 'file',
      relPath: nomination.relPath,
      content,
      ...(mime !== undefined ? { mime } : {}),
    };
  }
}
