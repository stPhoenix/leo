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

  const validated = parseAndGuardUrl(run.input.url);
  if (!validated.ok) return validated.error;
  let currentUrl = validated.url;

  const hostBlocked = await guardHost(currentUrl, run);
  if (hostBlocked !== null) return hostBlocked;

  const ctrl = setupAbortController(run);
  let redirects = 0;
  try {
    const followResult = await followRedirectChain(currentUrl, redirects, run, ctrl.composed);
    if ('error' in followResult) return followResult.error;
    currentUrl = followResult.currentUrl;
    redirects = followResult.redirects;
    return await processFinalResponse(followResult.lastResponse, currentUrl, redirects, run, start);
  } finally {
    clearTimeout(ctrl.timer);
    run.signal.removeEventListener('abort', ctrl.onParentAbort);
  }
}

function parseAndGuardUrl(
  raw: string,
): { ok: true; url: URL } | { ok: false; error: FetchUrlResult } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: { ok: false, error: 'invalid_url' } };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: { ok: false, error: 'invalid_url' } };
  }
  return { ok: true, url };
}

function setupAbortController(run: RunInput): {
  composed: AbortController;
  timer: ReturnType<typeof setTimeout>;
  onParentAbort: () => void;
} {
  const composed = new AbortController();
  const onParentAbort = (): void => composed.abort();
  if (run.signal.aborted) composed.abort();
  else run.signal.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => composed.abort(), Math.max(1, run.config.timeoutMs));
  return { composed, timer, onParentAbort };
}

function buildRequestInit(run: RunInput, signal: AbortSignal): RequestInit {
  const reqInit: RequestInit = {
    method: run.input.method,
    signal,
    redirect: 'manual',
  };
  const filteredHeaders = filterHeaders(run.input.headers, run.config.headerDenylist, run.logger);
  if (filteredHeaders !== undefined) reqInit.headers = filteredHeaders;
  if (run.input.method === 'POST' && run.input.body !== undefined) reqInit.body = run.input.body;
  return reqInit;
}

async function followRedirectChain(
  startUrl: URL,
  startRedirects: number,
  run: RunInput,
  composed: AbortController,
): Promise<
  { lastResponse: Response; currentUrl: URL; redirects: number } | { error: FetchUrlResult }
> {
  const followRedirects = run.config.followRedirects !== false;
  const maxRedirects = run.config.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = startUrl;
  let redirects = startRedirects;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const reqInit = buildRequestInit(run, composed.signal);
    let response: Response;
    try {
      response = await run.fetchImpl(currentUrl.toString(), reqInit);
    } catch {
      if (composed.signal.aborted || run.signal.aborted) {
        return { error: { ok: false, error: 'timeout', url: currentUrl.toString() } };
      }
      return {
        error: { ok: false, error: 'http_error', status: 0, url: currentUrl.toString() },
      };
    }
    if (!followRedirects || response.status < 300 || response.status >= 400) {
      return { lastResponse: response, currentUrl, redirects };
    }
    const next = await resolveRedirect(response, currentUrl, redirects, maxRedirects, run);
    if (next.kind === 'final') return { lastResponse: response, currentUrl, redirects };
    if (next.kind === 'error') return { error: next.result };
    currentUrl = next.nextUrl;
    redirects = next.redirects;
  }
}

async function resolveRedirect(
  response: Response,
  currentUrl: URL,
  redirects: number,
  maxRedirects: number,
  run: RunInput,
): Promise<
  | { kind: 'final' }
  | { kind: 'continue'; nextUrl: URL; redirects: number }
  | { kind: 'error'; result: FetchUrlResult }
> {
  const loc = response.headers.get('location');
  if (loc === null) return { kind: 'final' };
  if (redirects >= maxRedirects) {
    return {
      kind: 'error',
      result: {
        ok: false,
        error: 'http_error',
        status: response.status,
        url: currentUrl.toString(),
      },
    };
  }
  let nextUrl: URL;
  try {
    nextUrl = new URL(loc, currentUrl);
  } catch {
    return {
      kind: 'error',
      result: {
        ok: false,
        error: 'http_error',
        status: response.status,
        url: currentUrl.toString(),
      },
    };
  }
  if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
    return {
      kind: 'error',
      result: { ok: false, error: 'invalid_url', url: nextUrl.toString() },
    };
  }
  const redirectBlocked = await guardHost(nextUrl, run);
  if (redirectBlocked !== null) return { kind: 'error', result: redirectBlocked };
  return { kind: 'continue', nextUrl, redirects: redirects + 1 };
}

async function processFinalResponse(
  lastResponse: Response,
  currentUrl: URL,
  redirects: number,
  run: RunInput,
  start: number,
): Promise<FetchUrlResult> {
  const status = lastResponse.status;
  if (status >= 400) {
    // Headers are intentionally not surfaced for HTTP errors.
    const { totalBytes } = await consumeAndDiscard(lastResponse, run.config.maxBytes);
    report(run, {
      url: currentUrl.toString(),
      method: run.input.method,
      status,
      durationMs: run.now() - start,
      bytes: totalBytes,
      ...(redirects > 0 ? { redirects } : {}),
    });
    return { ok: false, error: 'http_error', status, url: currentUrl.toString() };
  }

  const { body, totalBytes, truncated } = await readBoundedBody(lastResponse, run.config.maxBytes);
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
    return parseJsonBody(cleanBody, status, headers, truncated, totalBytes, currentUrl);
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
}

function parseJsonBody(
  cleanBody: string,
  status: number,
  headers: Record<string, string>,
  truncated: boolean,
  totalBytes: number,
  currentUrl: URL,
): FetchUrlResult {
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
    return { ok: false, error: 'invalid_json', status, url: currentUrl.toString() };
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
  if (reader === undefined) return readWholeText(response, maxBytes);
  const drained = await drainReader(reader, maxBytes);
  if (drained.truncated) {
    drained.totalBytes = adjustTotalBytesFromHeader(response, drained.totalBytes);
  }
  const body = Buffer.concat(
    drained.chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)),
  ).toString('utf8');
  return { body, totalBytes: drained.totalBytes, truncated: drained.truncated };
}

async function readWholeText(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; totalBytes: number; truncated: boolean }> {
  const text = await response.text();
  const totalBytes = Buffer.byteLength(text, 'utf8');
  if (totalBytes > maxBytes) {
    const sliced = Buffer.from(text, 'utf8').slice(0, maxBytes).toString('utf8');
    return { body: sliced, totalBytes, truncated: true };
  }
  return { body: text, totalBytes, truncated: false };
}

async function drainReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
): Promise<{ chunks: Uint8Array[]; totalBytes: number; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
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
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      return { chunks, totalBytes, truncated: true };
    }
    chunks.push(value);
  }
  return { chunks, totalBytes, truncated: false };
}

// When the body is truncated and the server declared a content-length header,
// surface the declared total so callers can report accurate sizes.
function adjustTotalBytesFromHeader(response: Response, observedBytes: number): number {
  const lengthHeader = response.headers.get('content-length');
  const declared = lengthHeader !== null ? Number(lengthHeader) : NaN;
  return Number.isFinite(declared) && declared > observedBytes ? declared : observedBytes;
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
  const REASON_MAP: Record<string, FetchUrlErr['reason']> = {
    private: 'private_ip',
    resolve_failed: 'dns_resolve_failed',
  };
  const reason: FetchUrlErr['reason'] = REASON_MAP[check.reason] ?? 'dns_unsupported';
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
