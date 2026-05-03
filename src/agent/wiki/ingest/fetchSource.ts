import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { sanitizeBody } from '@/agent/externalAgent/adapters/inlineAgent/tools/sanitize';
import {
  resolveAndCheck,
  type DnsLookupAll,
} from '@/agent/externalAgent/adapters/inlineAgent/tools/ipGuard';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import type { FetchResult, IngestSource } from './types';

export interface AttachmentBlob {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly body: string;
}

export interface AttachmentResolver {
  readonly get: (id: string) => Promise<AttachmentBlob | null>;
}

export interface FetchUrlConfig {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly fetchImpl?: typeof fetch;
  /** Optional DNS resolver injection — mainly for tests. */
  readonly dnsLookup?: DnsLookupAll;
  /** When true, skip the SSRF / DNS-rebind check. Tests only. */
  readonly skipDnsCheck?: boolean;
}

export interface FetchSourceDeps {
  readonly vault: VaultAdapter;
  readonly attachments?: AttachmentResolver;
  readonly url?: FetchUrlConfig;
  readonly logger?: Logger;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: { code: 'fetch_invalid_url', message: 'invalid URL' } };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: { code: 'fetch_invalid_url', message: 'protocol not allowed' } };
  }

  const cfg = deps.url ?? {};
  if (cfg.skipDnsCheck !== true) {
    try {
      const checkOpts = cfg.dnsLookup !== undefined ? { lookup: cfg.dnsLookup } : {};
      const safe = await resolveAndCheck(parsed.hostname, checkOpts);
      if (!safe.ok) {
        return {
          ok: false,
          error: { code: 'fetch_blocked', message: `dns_${safe.reason}` },
        };
      }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'fetch_blocked',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = cfg.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = cfg.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const ac = new AbortController();
  const onAbort = (): void => ac.abort();
  signal.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: ac.signal });
    if (!response.ok) {
      return {
        ok: false,
        error: { code: 'fetch_http_error', message: `HTTP ${response.status}` },
      };
    }
    const buf = await response.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      return { ok: false, error: { code: 'fetch_too_large', message: `> ${maxBytes} bytes` } };
    }
    const contentType =
      response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? 'text/plain';
    const text = new TextDecoder().decode(buf);
    const body = sanitizeBody(text, contentType);
    deps.logger?.debug(WIKI_LOG.ingest.fetch.ok, { url, bytes: buf.byteLength, contentType });
    return {
      ok: true,
      fetched: {
        sourceRef: url,
        originalPath: null,
        contentType,
        body,
        bytes: buf.byteLength,
      },
    };
  } catch (err) {
    if (signal.aborted) {
      return { ok: false, error: { code: 'fetch_failed', message: 'aborted' } };
    }
    const code = ac.signal.aborted ? 'fetch_timeout' : 'fetch_failed';
    return {
      ok: false,
      error: { code, message: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

async function fetchVaultPath(path: string, deps: FetchSourceDeps): Promise<FetchResult> {
  if (!(await deps.vault.exists(path))) {
    return {
      ok: false,
      error: { code: 'fetch_vault_missing', message: `vault path ${path} not found` },
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
