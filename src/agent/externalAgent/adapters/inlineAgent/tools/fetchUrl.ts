import { fetchUrlInputSchema, type FetchUrlInput } from './schemas';
import type { InlineAgentLoggerLite } from '../eventBridge';
import {
  cidrContains as ipCidrContains,
  isCidr as ipIsCidr,
  resolveAndCheck,
  type DnsLookupAll,
} from './ipGuard';
import { sanitizeBody } from './sanitize';

export interface FetchUrlConfig {
  readonly enabled: boolean;
  readonly allowlist: readonly string[];
  readonly blocklist: readonly string[];
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly followRedirects?: boolean;
  readonly maxRedirects?: number;
  readonly requireDnsResolveCheck?: boolean;
  readonly headerDenylist?: readonly string[];
}

export type FetchUrlOk = {
  readonly ok: true;
  readonly data: {
    readonly status: number;
    readonly headers: Record<string, string>;
    readonly body: string | unknown;
    readonly truncated?: boolean;
    readonly totalBytes: number;
    readonly url: string;
  };
};

export type FetchUrlErr = {
  readonly ok: false;
  readonly error:
    | 'blocked'
    | 'timeout'
    | 'too_large'
    | 'invalid_url'
    | 'invalid_args'
    | 'invalid_json'
    | 'http_error';
  readonly status?: number;
  readonly url?: string;
  readonly reason?: 'host_pattern' | 'private_ip' | 'dns_resolve_failed' | 'dns_unsupported';
};

export type FetchUrlResult = FetchUrlOk | FetchUrlErr;

export interface FetchUrlCtx {
  readonly config: FetchUrlConfig;
  readonly signal: AbortSignal;
  readonly logger: InlineAgentLoggerLite;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  /**
   * Test seam — when provided, replaces the runtime `node:dns/promises` lookup.
   * Production code leaves this undefined.
   */
  readonly dnsLookup?: DnsLookupAll;
}

const DEFAULT_MAX_REDIRECTS = 5;

export interface FetchUrlInvocation {
  readonly input: unknown;
  readonly callMs?: number;
}

export interface FetchUrlEventEmitter {
  emit(event: {
    readonly type: 'log';
    readonly level: 'info' | 'debug';
    readonly msg: string;
  }): void;
}

export interface CallFetchUrlInput {
  readonly raw: unknown;
  readonly emit?: (event: FetchUrlMetricsEvent) => void;
}

export interface FetchUrlMetricsEvent {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly status: number;
  readonly durationMs: number;
  readonly bytes: number;
  readonly truncated?: boolean;
  readonly redirects?: number;
}

export interface FetchUrlTool {
  readonly name: 'fetch_url';
  invoke(input: unknown): Promise<FetchUrlResult>;
  withMetrics(callback: (m: FetchUrlMetricsEvent) => void): FetchUrlTool;
}

export function createFetchUrlTool(ctx: FetchUrlCtx): FetchUrlTool {
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = ctx.now ?? ((): number => Date.now());
  let metricsCallback: ((m: FetchUrlMetricsEvent) => void) | null = null;

  const tool: FetchUrlTool = {
    name: 'fetch_url',
    async invoke(input: unknown): Promise<FetchUrlResult> {
      let parsed: FetchUrlInput;
      try {
        parsed = fetchUrlInputSchema.parse(input);
      } catch {
        return { ok: false, error: 'invalid_args' };
      }
      return runFetchUrl({
        input: parsed,
        config: ctx.config,
        signal: ctx.signal,
        fetchImpl,
        now,
        logger: ctx.logger,
        onMetrics: metricsCallback ?? undefined,
        ...(ctx.dnsLookup !== undefined ? { dnsLookup: ctx.dnsLookup } : {}),
      });
    },
    withMetrics(cb): FetchUrlTool {
      metricsCallback = cb;
      return tool;
    },
  };

  return tool;
}

interface RunInput {
  readonly input: FetchUrlInput;
  readonly config: FetchUrlConfig;
  readonly signal: AbortSignal;
  readonly fetchImpl: typeof fetch;
  readonly now: () => number;
  readonly logger: InlineAgentLoggerLite;
  readonly onMetrics?: (m: FetchUrlMetricsEvent) => void;
  readonly dnsLookup?: DnsLookupAll;
}

async function runFetchUrl(run: RunInput): Promise<FetchUrlResult> {
  const start = run.now();
  const followRedirects = run.config.followRedirects !== false;
  const maxRedirects = run.config.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let currentUrl: URL;
  try {
    currentUrl = new URL(run.input.url);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
    return { ok: false, error: 'invalid_url' };
  }

  {
    const hostBlocked = await guardHost(currentUrl, run);
    if (hostBlocked !== null) return hostBlocked;
  }

  const composed = new AbortController();
  const onParentAbort = (): void => composed.abort();
  if (run.signal.aborted) composed.abort();
  else run.signal.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => composed.abort(), Math.max(1, run.config.timeoutMs));

  let redirects = 0;
  let lastResponse: Response | null = null;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const reqInit: RequestInit = {
        method: run.input.method,
        signal: composed.signal,
        redirect: 'manual',
      };
      const filteredHeaders = filterHeaders(
        run.input.headers,
        run.config.headerDenylist,
        run.logger,
      );
      if (filteredHeaders !== undefined) reqInit.headers = filteredHeaders;
      if (run.input.method === 'POST' && run.input.body !== undefined)
        reqInit.body = run.input.body;

      let response: Response;
      try {
        response = await run.fetchImpl(currentUrl.toString(), reqInit);
      } catch (err) {
        if (composed.signal.aborted && !run.signal.aborted) {
          return { ok: false, error: 'timeout', url: currentUrl.toString() };
        }
        if (run.signal.aborted) {
          return { ok: false, error: 'timeout', url: currentUrl.toString() };
        }
        return {
          ok: false,
          error: 'http_error',
          status: 0,
          url: currentUrl.toString(),
        };
      }
      lastResponse = response;

      if (followRedirects && response.status >= 300 && response.status < 400) {
        const loc = response.headers.get('location');
        if (loc === null) {
          // No location, treat as final response.
          break;
        }
        if (redirects >= maxRedirects) {
          return {
            ok: false,
            error: 'http_error',
            status: response.status,
            url: currentUrl.toString(),
          };
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(loc, currentUrl);
        } catch {
          return {
            ok: false,
            error: 'http_error',
            status: response.status,
            url: currentUrl.toString(),
          };
        }
        if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
          return { ok: false, error: 'invalid_url', url: nextUrl.toString() };
        }
        const redirectBlocked = await guardHost(nextUrl, run);
        if (redirectBlocked !== null) return redirectBlocked;
        redirects += 1;
        currentUrl = nextUrl;
        continue;
      }
      break;
    }

    if (lastResponse === null) {
      return { ok: false, error: 'http_error', status: 0, url: currentUrl.toString() };
    }

    const status = lastResponse.status;
    if (status >= 400) {
      const headers = collectHeaders(lastResponse.headers);
      const { totalBytes } = await consumeAndDiscard(lastResponse, run.config.maxBytes);
      report(run, {
        url: currentUrl.toString(),
        method: run.input.method,
        status,
        durationMs: run.now() - start,
        bytes: totalBytes,
        ...(redirects > 0 ? { redirects } : {}),
      });
      void headers; // not surfaced for HTTP errors
      return {
        ok: false,
        error: 'http_error',
        status,
        url: currentUrl.toString(),
      };
    }

    const { body, totalBytes, truncated } = await readBoundedBody(
      lastResponse,
      run.config.maxBytes,
    );
    const headers = collectHeaders(lastResponse.headers);
    const cleanBody = sanitizeBody(body, headers['content-type']);

    report(run, {
      url: currentUrl.toString(),
      method: run.input.method,
      status,
      durationMs: run.now() - start,
      bytes: totalBytes,
      ...(truncated ? { truncated } : {}),
      ...(redirects > 0 ? { redirects } : {}),
    });

    if (run.input.responseFormat === 'json') {
      try {
        const parsed = JSON.parse(cleanBody);
        return {
          ok: true,
          data: {
            status,
            headers,
            body: parsed,
            ...(truncated ? { truncated } : {}),
            totalBytes,
            url: currentUrl.toString(),
          },
        };
      } catch {
        return {
          ok: false,
          error: 'invalid_json',
          status,
          url: currentUrl.toString(),
        };
      }
    }
    return {
      ok: true,
      data: {
        status,
        headers,
        body: cleanBody,
        ...(truncated ? { truncated } : {}),
        totalBytes,
        url: currentUrl.toString(),
      },
    };
  } finally {
    clearTimeout(timer);
    run.signal.removeEventListener('abort', onParentAbort);
  }
}

function report(run: RunInput, metrics: FetchUrlMetricsEvent): void {
  if (run.onMetrics !== undefined) run.onMetrics(metrics);
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; totalBytes: number; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    const text = await response.text();
    const totalBytes = Buffer.byteLength(text, 'utf8');
    if (totalBytes > maxBytes) {
      const sliced = Buffer.from(text, 'utf8').slice(0, maxBytes).toString('utf8');
      return { body: sliced, totalBytes, truncated: true };
    }
    return { body: text, totalBytes, truncated: false };
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    const value = step.value;
    if (value === undefined) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      const overflow = totalBytes - maxBytes;
      const usable = value.byteLength - overflow;
      if (usable > 0) chunks.push(value.slice(0, usable));
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      // Continue reading to compute totalBytes — but we cancelled, so read returns done next.
      // Drain remaining bytes by reading directly from the underlying response if possible.
      // For accuracy, fall back to header content-length when present.
      const lengthHeader = response.headers.get('content-length');
      const declared = lengthHeader !== null ? Number(lengthHeader) : NaN;
      if (Number.isFinite(declared) && declared > totalBytes) {
        totalBytes = declared;
      }
      break;
    }
    chunks.push(value);
  }
  const body = Buffer.concat(
    chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)),
  ).toString('utf8');
  return { body, totalBytes, truncated };
}

async function consumeAndDiscard(
  response: Response,
  maxBytes: number,
): Promise<{ totalBytes: number }> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    const text = await response.text();
    return { totalBytes: Buffer.byteLength(text, 'utf8') };
  }
  let totalBytes = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    if (step.value !== undefined) totalBytes += step.value.byteLength;
    if (totalBytes >= maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
  }
  return { totalBytes };
}

function collectHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function checkHost(host: string, config: FetchUrlConfig): boolean {
  if (config.allowlist.length > 0) {
    if (!config.allowlist.some((pat) => matchHostPattern(host, pat))) return false;
  }
  for (const pat of config.blocklist) {
    if (matchHostPattern(host, pat)) return false;
  }
  return true;
}

export function matchHostPattern(host: string, pattern: string): boolean {
  if (pattern.length === 0) return false;
  const lowerHost = stripBrackets(host).toLowerCase();
  const lowerPat = pattern.toLowerCase();
  if (ipIsCidr(lowerPat)) {
    return ipCidrContains(lowerPat, lowerHost);
  }
  if (lowerPat === lowerHost) return true;
  if (lowerPat.startsWith('*.')) {
    const suffix = lowerPat.slice(1); // includes leading '.'
    return lowerHost.endsWith(suffix) && lowerHost.length > suffix.length;
  }
  if (lowerPat.includes('*')) {
    const re = new RegExp(
      '^' + lowerPat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    return re.test(lowerHost);
  }
  return false;
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

async function guardHost(target: URL, run: RunInput): Promise<FetchUrlErr | null> {
  const host = stripBrackets(target.hostname);
  if (!checkHost(host, run.config)) {
    run.logger.info('externalAgent.adapter.inlineAgent.tool.fetch-url.blocked', {
      host,
      reason: 'host_pattern',
    });
    return { ok: false, error: 'blocked', url: target.toString(), reason: 'host_pattern' };
  }
  if (run.config.requireDnsResolveCheck === false) return null;
  const opts = run.dnsLookup !== undefined ? { lookup: run.dnsLookup } : {};
  const check = await resolveAndCheck(host, opts);
  if (check.ok) return null;
  run.logger.info('externalAgent.adapter.inlineAgent.tool.fetch-url.blocked', {
    host,
    reason: check.reason,
  });
  const reason: FetchUrlErr['reason'] =
    check.reason === 'private'
      ? 'private_ip'
      : check.reason === 'resolve_failed'
        ? 'dns_resolve_failed'
        : 'dns_unsupported';
  return { ok: false, error: 'blocked', url: target.toString(), reason };
}

function filterHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  denylist: readonly string[] | undefined,
  logger: InlineAgentLoggerLite,
): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  const deny = new Set((denylist ?? []).map((h) => h.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (deny.has(k.toLowerCase())) {
      logger.info('externalAgent.adapter.inlineAgent.tool.fetch-url.header-dropped', {
        name: k.toLowerCase(),
      });
      continue;
    }
    out[k] = v;
  }
  return out;
}
