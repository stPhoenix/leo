import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import { WIKI_RAW_DIR } from '@/agent/wiki/paths';
import { computeSha256Hex } from './sha256';
import { buildRawPath } from './slug';
import type { FetchedSource, PersistedRaw } from './types';

export interface PersistRawDeps {
  readonly vault: VaultAdapter;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

export interface PersistRawInput {
  readonly fetched: FetchedSource;
  readonly slugLabel?: string;
  readonly overwriteRawPath?: string;
}

export async function computeFetchedSha256(fetched: FetchedSource): Promise<string> {
  return computeSha256Hex(fetched.body);
}

export async function persistRaw(
  input: PersistRawInput,
  deps: PersistRawDeps,
): Promise<PersistedRaw> {
  const sha256 = await computeFetchedSha256(input.fetched);
  const fetchedAt = (deps.now ?? ((): Date => new Date()))().toISOString();
  const nowDate = (deps.now ?? ((): Date => new Date()))();
  const rawPath =
    input.overwriteRawPath ??
    buildRawPath({
      nowDate,
      slugLabel: input.slugLabel ?? deriveSlugLabel(input.fetched),
    });
  await deps.vault.mkdir(WIKI_RAW_DIR);
  const body = renderRawFile(input.fetched, fetchedAt, sha256);
  await deps.vault.write(rawPath, body);
  deps.logger?.debug(WIKI_LOG.ingest.persist.ok, {
    rawPath,
    bytes: input.fetched.bytes,
  });
  return { rawPath, sha256, fetchedAt, bytes: input.fetched.bytes };
}

function renderRawFile(
  fetched: FetchedSource,
  fetchedAt: string,
  sha256: string,
): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`source: ${escapeYaml(fetched.sourceRef)}`);
  lines.push(`fetched_at: ${fetchedAt}`);
  lines.push(`content_type: ${escapeYaml(fetched.contentType)}`);
  lines.push(`sha256: ${sha256}`);
  if (fetched.originalPath !== null) {
    lines.push(`original_path: ${escapeYaml(fetched.originalPath)}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(fetched.body);
  if (!fetched.body.endsWith('\n')) lines.push('');
  return lines.join('\n');
}

function escapeYaml(value: string): string {
  if (/[:#\n"'\\]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function deriveSlugLabel(fetched: FetchedSource): string {
  if (fetched.originalPath !== null) {
    const base = fetched.originalPath.split('/').pop() ?? fetched.originalPath;
    return base.replace(/\.[^.]+$/, '');
  }
  if (fetched.sourceRef.startsWith('http')) {
    try {
      const url = new URL(fetched.sourceRef);
      return `${url.hostname}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return fetched.sourceRef;
    }
  }
  return fetched.sourceRef;
}
