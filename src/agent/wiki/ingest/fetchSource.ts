import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import {
  createFetchUrlTool,
  type FetchUrlConfig,
  type FetchUrlResult,
} from '@/agent/externalAgent/adapters/inlineAgent/tools/fetchUrl';
import type { DnsLookupAll } from '@/agent/externalAgent/adapters/inlineAgent/tools/ipGuard';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import type { FetchResult, IngestSource } from './types';

export type { FetchUrlConfig };

export interface AttachmentBlob {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly body: string;
}

export interface AttachmentResolver {
  readonly get: (id: string) => Promise<AttachmentBlob | null>;
}

/**
 * Test seams for URL fetching. Production code leaves these undefined and
 * `createFetchUrlTool` falls back to `globalThis.fetch` and `node:dns/promises`.
 */
export interface FetchUrlOverrides {
  readonly fetchImpl?: typeof fetch;
  readonly dnsLookup?: DnsLookupAll;
}

export type FetchUrlConfigSource = FetchUrlConfig | (() => FetchUrlConfig);

/**
 * Pluggable URL fetcher. When provided, `fetchSource.fetchUrl` delegates the
 * URL-kind branch entirely (production wires `orchestratorUrlFetcher` so each
 * URL fetch goes through `delegate_external` for user approval). When omitted,
 * `fetchUrl` falls back to invoking `createFetchUrlTool` directly with `url`
 * config (test path / non-orchestrator deployments).
 */
export interface UrlFetcher {
  fetch(url: string, signal: AbortSignal): Promise<FetchResult>;
}

export interface FetchSourceDeps {
  readonly vault: VaultAdapter;
  readonly attachments?: AttachmentResolver;
  readonly url?: FetchUrlConfigSource;
  readonly urlOverrides?: FetchUrlOverrides;
  readonly urlFetcher?: UrlFetcher;
  readonly logger?: Logger;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

const FALLBACK_FETCH_URL_CONFIG: FetchUrlConfig = {
  enabled: true,
  allowlist: [],
  blocklist: [],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxBytes: DEFAULT_MAX_BYTES,
  requireDnsResolveCheck: true,
};

export async function fetchIngestSource(
  source: IngestSource,
  deps: FetchSourceDeps,
  signal: AbortSignal,
): Promise<FetchResult> {
  if (signal.aborted) {
    return { ok: false, error: { code: 'fetch_failed', message: 'aborted' } };
  }
  switch (source.kind) {
    case 'url':
      return fetchUrl(source.url, deps, signal);
    case 'vaultPath':
      return fetchVaultPath(source.path, deps);
    case 'attachment':
      return fetchAttachment(source.attachmentId, deps);
    case 'conversation':
      return {
        ok: true,
        fetched: {
          sourceRef: `conversation:${source.threadId}:${source.turnIndex}`,
          originalPath: null,
          contentType: 'text/markdown',
          body: source.body,
          bytes: byteLength(source.body),
        },
      };
    case 'inbox':
      return {
        ok: false,
        error: {
          code: 'fetch_failed',
          message: 'inbox kind requires per-item resolution before fetch',
        },
      };
  }
}

async function fetchUrl(
  url: string,
  deps: FetchSourceDeps,
  signal: AbortSignal,
): Promise<FetchResult> {
  if (deps.urlFetcher !== undefined) {
    return deps.urlFetcher.fetch(url, signal);
  }
  const config: FetchUrlConfig =
    typeof deps.url === 'function' ? deps.url() : (deps.url ?? FALLBACK_FETCH_URL_CONFIG);
  const overrides = deps.urlOverrides ?? {};
  const tool = createFetchUrlTool({
    config,
    signal,
    logger: deps.logger ?? noopLogger(),
    ...(overrides.fetchImpl !== undefined ? { fetchImpl: overrides.fetchImpl } : {}),
    ...(overrides.dnsLookup !== undefined ? { dnsLookup: overrides.dnsLookup } : {}),
  });

  let result: FetchUrlResult;
  try {
    result = await tool.invoke({ url, method: 'GET', responseFormat: 'text' });
  } catch (err) {
    if (signal.aborted) {
      return { ok: false, error: { code: 'fetch_failed', message: 'aborted' } };
    }
    return {
      ok: false,
      error: { code: 'fetch_failed', message: err instanceof Error ? err.message : String(err) },
    };
  }

  return translateFetchUrlResult(url, result, deps.logger);
}

function translateFetchUrlResult(
  url: string,
  result: FetchUrlResult,
  logger: Logger | undefined,
): FetchResult {
  if (result.ok) {
    const body = typeof result.data.body === 'string' ? result.data.body : '';
    const contentType =
      result.data.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? 'text/plain';
    logger?.debug(WIKI_LOG.ingest.fetch.ok, {
      url,
      bytes: result.data.totalBytes,
      contentType,
    });
    return {
      ok: true,
      fetched: {
        sourceRef: url,
        originalPath: null,
        contentType,
        body,
        bytes: result.data.totalBytes,
      },
    };
  }

  switch (result.error) {
    case 'blocked':
      return {
        ok: false,
        error: { code: 'fetch_blocked', message: result.reason ?? 'blocked' },
      };
    case 'timeout':
      return { ok: false, error: { code: 'fetch_timeout', message: 'timeout' } };
    case 'too_large':
      return { ok: false, error: { code: 'fetch_too_large', message: 'response too large' } };
    case 'invalid_url':
    case 'invalid_args':
      return { ok: false, error: { code: 'fetch_invalid_url', message: 'invalid URL' } };
    case 'http_error':
      return {
        ok: false,
        error: {
          code: 'fetch_http_error',
          message: result.status !== undefined ? `HTTP ${result.status}` : 'http error',
        },
      };
    case 'invalid_json':
      // Not reachable — we always request responseFormat: 'text'. Fall through to a generic error.
      return { ok: false, error: { code: 'fetch_failed', message: 'invalid json response' } };
  }
}

async function fetchVaultPath(path: string, deps: FetchSourceDeps): Promise<FetchResult> {
  if (!(await deps.vault.exists(path))) {
    return {
      ok: false,
      error: { code: 'fetch_vault_missing', message: `vault path ${path} not found` },
    };
  }
  const stat = await deps.vault.stat(path);
  if (stat !== null && stat.kind === 'folder') {
    return {
      ok: false,
      error: {
        code: 'fetch_vault_not_file',
        message: `vault path ${path} is a folder; specify a file inside it (e.g. ${path}/<file>.md)`,
      },
    };
  }
  let body: string;
  try {
    body = await deps.vault.read(path);
  } catch (err) {
    return {
      ok: false,
      error: { code: 'fetch_failed', message: err instanceof Error ? err.message : String(err) },
    };
  }
  return {
    ok: true,
    fetched: {
      sourceRef: `vault:${path}`,
      originalPath: path,
      contentType: 'text/markdown',
      body,
      bytes: byteLength(body),
    },
  };
}

async function fetchAttachment(id: string, deps: FetchSourceDeps): Promise<FetchResult> {
  if (deps.attachments === undefined) {
    return {
      ok: false,
      error: {
        code: 'fetch_attachment_missing',
        message: 'attachment resolver not configured',
      },
    };
  }
  const blob = await deps.attachments.get(id);
  if (blob === null) {
    return {
      ok: false,
      error: { code: 'fetch_attachment_missing', message: `attachment ${id} not found` },
    };
  }
  return {
    ok: true,
    fetched: {
      sourceRef: `attachment:${id}`,
      originalPath: blob.name,
      contentType: blob.contentType,
      body: blob.body,
      bytes: byteLength(blob.body),
    },
  };
}

function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
  return text.length;
}

function noopLogger(): Logger {
  const noop = (): void => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  } as unknown as Logger;
}
