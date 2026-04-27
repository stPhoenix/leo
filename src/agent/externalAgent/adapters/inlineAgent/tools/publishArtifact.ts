import { promises as fs } from 'node:fs';
import { publishArtifactInputSchema, type PublishArtifactInput } from './schemas';
import type { Sandbox } from '../sandbox';
import type { InlineAgentLoggerLite } from '../eventBridge';
import type { InlineAgentRunState } from '../runState';
import { appendPublishedArtifact } from '../runState';

export interface PublishArtifactConfig {
  readonly maxArtifacts: number;
}

export type PublishArtifactResult =
  | {
      readonly ok: true;
      readonly data: { readonly published: number; readonly remaining: number };
    }
  | {
      readonly ok: false;
      readonly error:
        | 'path_outside_sandbox'
        | 'not_found'
        | 'artifact_limit'
        | 'duplicate'
        | 'invalid_args';
    };

export interface PublishArtifactCtx {
  readonly config: PublishArtifactConfig;
  readonly sandbox: Sandbox;
  readonly logger: InlineAgentLoggerLite;
  readonly runState: InlineAgentRunState;
}

export interface PublishArtifactTool {
  readonly name: 'publish_artifact';
  invoke(input: unknown): Promise<PublishArtifactResult>;
}

export function createPublishArtifactTool(ctx: PublishArtifactCtx): PublishArtifactTool {
  return {
    name: 'publish_artifact',
    async invoke(input): Promise<PublishArtifactResult> {
      let parsed: PublishArtifactInput;
      try {
        parsed = publishArtifactInputSchema.parse(input);
      } catch {
        return { ok: false, error: 'invalid_args' };
      }
      if (ctx.runState.publishedArtifacts.length >= ctx.config.maxArtifacts) {
        return { ok: false, error: 'artifact_limit' };
      }
      const resolved = ctx.sandbox.resolve(parsed.relPath);
      if (!resolved.ok) return { ok: false, error: 'path_outside_sandbox' };
      const safe = await ctx.sandbox.checkSafe(resolved.absPath);
      if (!safe.ok) {
        if (safe.error === 'not_found') return { ok: false, error: 'not_found' };
        return { ok: false, error: 'path_outside_sandbox' };
      }
      try {
        await fs.access(resolved.absPath);
      } catch {
        return { ok: false, error: 'not_found' };
      }
      const dup = ctx.runState.publishedArtifacts.some((a) => a.relPath === parsed.relPath);
      if (dup) return { ok: false, error: 'duplicate' };
      appendPublishedArtifact(ctx.runState, {
        relPath: parsed.relPath,
        ...(parsed.summary !== undefined ? { summary: parsed.summary } : {}),
      });
      const published = ctx.runState.publishedArtifacts.length;
      return {
        ok: true,
        data: {
          published,
          remaining: Math.max(0, ctx.config.maxArtifacts - published),
        },
      };
    },
  };
}

export function mimeFromRelPath(relPath: string): string | undefined {
  const idx = relPath.lastIndexOf('.');
  if (idx === -1) return undefined;
  const ext = relPath.slice(idx + 1).toLowerCase();
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'txt':
      return 'text/plain';
    case 'json':
      return 'application/json';
    case 'csv':
      return 'text/csv';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'pdf':
      return 'application/pdf';
    default:
      return undefined;
  }
}
