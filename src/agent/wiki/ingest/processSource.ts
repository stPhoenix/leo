import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import {
  fetchIngestSource,
  type AttachmentResolver,
  type FetchUrlConfigSource,
  type FetchUrlOverrides,
  type UrlFetcher,
} from './fetchSource';
import { findDuplicateRawBySha } from './duplicateDetect';
import { resolveDuplicateChoice } from './duplicatePrompt';
import { computeFetchedSha256, persistRaw } from './persistRaw';
import type { DuplicateChoice, DuplicateMatch, IngestSource, SourceTerminalRecord } from './types';

export interface ProcessSourceDeps {
  readonly vault: VaultAdapter;
  readonly attachments?: AttachmentResolver;
  readonly url?: FetchUrlConfigSource;
  readonly urlOverrides?: FetchUrlOverrides;
  readonly urlFetcher?: UrlFetcher;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly requestDuplicateChoice: (match: DuplicateMatch) => Promise<DuplicateChoice | null>;
  readonly reingestPromptTimeoutMs?: number;
}

export async function processSourceFetchPersist(
  source: IngestSource,
  deps: ProcessSourceDeps,
  signal: AbortSignal,
): Promise<SourceTerminalRecord> {
  const fetchResult = await fetchIngestSource(source, deps, signal);
  if (!fetchResult.ok) {
    deps.logger?.debug(WIKI_LOG.ingest.fetch.failed, {
      kind: source.kind,
      code: fetchResult.error.code,
      ref: describeRef(source),
      message: fetchResult.error.message,
    });
    return {
      sourceRef: describeRef(source),
      status: 'error',
      rawPath: null,
      error: `${fetchResult.error.code}: ${fetchResult.error.message}`,
    };
  }
  const fetched = fetchResult.fetched;
  const sha256 = await computeFetchedSha256(fetched);
  const dup = await findDuplicateRawBySha(deps.vault, sha256);

  if (dup !== null) {
    return handleDuplicateFetched(dup, fetched, deps, signal);
  }
  return persistFreshFetched(fetched, deps);
}

async function handleDuplicateFetched(
  dup: DuplicateMatch,
  fetched: Awaited<ReturnType<typeof fetchIngestSource>> extends infer R
    ? R extends { ok: true; fetched: infer F }
      ? F
      : never
    : never,
  deps: ProcessSourceDeps,
  signal: AbortSignal,
): Promise<SourceTerminalRecord> {
  deps.logger?.debug(WIKI_LOG.ingest.persist.duplicate, {
    rawPath: dup.rawPath,
    sourceRef: fetched.sourceRef,
  });
  const choice = await resolveDuplicateChoice(dup, {
    request: deps.requestDuplicateChoice,
    ...(deps.reingestPromptTimeoutMs !== undefined
      ? { timeoutMs: deps.reingestPromptTimeoutMs }
      : {}),
    signal,
  });
  if (choice === 'skip') {
    return { sourceRef: fetched.sourceRef, status: 'skipped', rawPath: dup.rawPath };
  }
  if (choice === 'reprocess') {
    return { sourceRef: fetched.sourceRef, status: 'reprocessed', rawPath: dup.rawPath };
  }
  try {
    await persistRaw(
      { fetched, overwriteRawPath: dup.rawPath },
      {
        vault: deps.vault,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        ...(deps.now !== undefined ? { now: deps.now } : {}),
      },
    );
    return { sourceRef: fetched.sourceRef, status: 'replaced', rawPath: dup.rawPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      sourceRef: fetched.sourceRef,
      status: 'error',
      rawPath: dup.rawPath,
      error: `persist_failed: ${message}`,
    };
  }
}

async function persistFreshFetched(
  fetched: Awaited<ReturnType<typeof fetchIngestSource>> extends infer R
    ? R extends { ok: true; fetched: infer F }
      ? F
      : never
    : never,
  deps: ProcessSourceDeps,
): Promise<SourceTerminalRecord> {
  try {
    const persisted = await persistRaw(
      { fetched },
      {
        vault: deps.vault,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        ...(deps.now !== undefined ? { now: deps.now } : {}),
      },
    );
    return {
      sourceRef: fetched.sourceRef,
      status: 'persisted',
      rawPath: persisted.rawPath,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.debug(WIKI_LOG.ingest.persist.failed, { sourceRef: fetched.sourceRef, message });
    return {
      sourceRef: fetched.sourceRef,
      status: 'error',
      rawPath: null,
      error: `persist_failed: ${message}`,
    };
  }
}

function describeRef(source: IngestSource): string {
  switch (source.kind) {
    case 'url':
      return source.url;
    case 'vaultPath':
      return `vault:${source.path}`;
    case 'attachment':
      return `attachment:${source.attachmentId}`;
    case 'conversation':
      return `conversation:${source.threadId}:${source.turnIndex}`;
    case 'inbox':
      return 'inbox';
  }
}
