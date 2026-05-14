import { searchWebInputSchema, type SearchWebInput } from './schemas';
import type { InlineAgentLoggerLite } from '../eventBridge';
import { stripInvisible } from './sanitize';

export interface SearchWebConfig {
  readonly enabled: boolean;
  readonly apiKey: string;
  readonly defaultMaxResults: number;
  readonly defaultSearchDepth: 'basic' | 'advanced';
  readonly defaultTopic: 'general' | 'news';
  readonly includeAnswer: boolean;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly endpoint?: string;
}

export interface SearchWebResultRow {
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly score: number;
}

export interface SearchWebOk {
  readonly ok: true;
  readonly data: {
    readonly answer?: string;
    readonly results: readonly SearchWebResultRow[];
    readonly responseTimeMs: number;
  };
}

export type SearchWebError =
  | 'not_configured'
  | 'auth_failed'
  | 'rate_limited'
  | 'upstream_error'
  | 'http_error'
  | 'timeout'
  | 'too_large'
  | 'invalid_query'
  | 'invalid_args';

export interface SearchWebErr {
  readonly ok: false;
  readonly error: SearchWebError;
  readonly status?: number;
}

export type SearchWebResult = SearchWebOk | SearchWebErr;

export interface SearchWebMetricsEvent {
  readonly queryLength: number;
  readonly maxResults: number;
  readonly depth: 'basic' | 'advanced';
  readonly status: number;
  readonly durationMs: number;
  readonly resultCount: number;
}

export interface SearchWebTool {
  readonly name: 'search_web';
  invoke(input: unknown): Promise<SearchWebResult>;
  withMetrics(callback: (m: SearchWebMetricsEvent) => void): SearchWebTool;
}

export interface SearchWebCtx {
  readonly config: SearchWebConfig;
  readonly signal: AbortSignal;
  readonly logger: InlineAgentLoggerLite;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

const DEFAULT_ENDPOINT = 'https://api.tavily.com/search';

export function createSearchWebTool(ctx: SearchWebCtx): SearchWebTool {
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = ctx.now ?? ((): number => Date.now());
  const endpoint = ctx.config.endpoint ?? DEFAULT_ENDPOINT;
  let metricsCallback: ((m: SearchWebMetricsEvent) => void) | null = null;
  let warnedNotConfigured = false;

  const tool: SearchWebTool = {
    name: 'search_web',
    async invoke(input: unknown): Promise<SearchWebResult> {
      let parsed: SearchWebInput;
      try {
        parsed = searchWebInputSchema.parse(input);
      } catch {
        return { ok: false, error: 'invalid_args' };
      }
      if (ctx.config.apiKey.length === 0) {
        if (!warnedNotConfigured) {
          warnedNotConfigured = true;
          ctx.logger.warn('externalAgent.adapter.inlineAgent.api-key-missing', {
            tool: 'search_web',
          });
        }
        return { ok: false, error: 'not_configured' };
      }
      return runSearchWeb({
        parsed,
        ctx,
        endpoint,
        fetchImpl,
        now,
        getMetricsCallback: () => metricsCallback,
      });
    },
    withMetrics(cb): SearchWebTool {
      metricsCallback = cb;
      return tool;
    },
  };

  return tool;
}

interface RunSearchWebArgs {
  parsed: SearchWebInput;
  ctx: SearchWebCtx;
  endpoint: string;
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  getMetricsCallback: () => ((m: SearchWebMetricsEvent) => void) | null;
}

async function runSearchWeb(args: RunSearchWebArgs): Promise<SearchWebResult> {
  const { parsed, ctx, endpoint, fetchImpl, now, getMetricsCallback } = args;
  const start = now();
  const composed = new AbortController();
  const onParentAbort = (): void => composed.abort();
  if (ctx.signal.aborted) composed.abort();
  else ctx.signal.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => composed.abort(), Math.max(1, ctx.config.timeoutMs));
  const maxResults = parsed.maxResults ?? ctx.config.defaultMaxResults;
  const depth = parsed.searchDepth ?? ctx.config.defaultSearchDepth;
  const reportMetrics = (extra: { status: number; resultCount: number }): void => {
    const cb = getMetricsCallback();
    if (cb === null) return;
    cb({
      queryLength: parsed.query.length,
      maxResults,
      depth,
      status: extra.status,
      durationMs: now() - start,
      resultCount: extra.resultCount,
    });
  };
  try {
    const body = buildSearchBody(parsed, ctx, maxResults, depth);
    const fetchResult = await fetchSearchEndpoint(fetchImpl, endpoint, body, composed, ctx);
    if (!fetchResult.ok) return fetchResult.error;
    return await parseSearchResponse(fetchResult.response, parsed, ctx, now, start, reportMetrics);
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', onParentAbort);
  }
}

function buildSearchBody(
  parsed: SearchWebInput,
  ctx: SearchWebCtx,
  maxResults: number,
  depth: string,
): string {
  return JSON.stringify({
    api_key: ctx.config.apiKey,
    query: parsed.query,
    search_depth: depth,
    max_results: maxResults,
    topic: parsed.topic ?? ctx.config.defaultTopic,
    include_answer: parsed.includeAnswer ?? ctx.config.includeAnswer,
    include_raw_content: false,
    include_images: false,
    ...(parsed.includeDomains !== undefined ? { include_domains: parsed.includeDomains } : {}),
    ...(parsed.excludeDomains !== undefined ? { exclude_domains: parsed.excludeDomains } : {}),
  });
}

async function fetchSearchEndpoint(
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>,
  endpoint: string,
  body: string,
  composed: AbortController,
  ctx: SearchWebCtx,
): Promise<{ ok: true; response: Response } | { ok: false; error: SearchWebResult }> {
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      signal: composed.signal,
      headers: { 'content-type': 'application/json' },
      body,
    });
    return { ok: true, response };
  } catch (err) {
    if (composed.signal.aborted && !ctx.signal.aborted) {
      return { ok: false, error: { ok: false, error: 'timeout' } };
    }
    if (ctx.signal.aborted) return { ok: false, error: { ok: false, error: 'timeout' } };
    if (err instanceof Error && /timeout/i.test(err.message)) {
      return { ok: false, error: { ok: false, error: 'timeout' } };
    }
    return { ok: false, error: { ok: false, error: 'http_error', status: 0 } };
  }
}

async function parseSearchResponse(
  response: Response,
  parsed: SearchWebInput,
  ctx: SearchWebCtx,
  now: () => number,
  start: number,
  reportMetrics: (extra: { status: number; resultCount: number }) => void,
): Promise<SearchWebResult> {
  const status = response.status;
  if (status >= 400) {
    reportMetrics({ status, resultCount: 0 });
    return { ok: false, error: mapHttpError(status), status };
  }
  const { text, totalBytes, truncated } = await readBoundedText(response, ctx.config.maxBytes);
  if (truncated) {
    reportMetrics({ status, resultCount: 0 });
    return { ok: false, error: 'too_large', status };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    reportMetrics({ status, resultCount: 0 });
    return { ok: false, error: 'http_error', status };
  }
  const mapped = mapTavilyPayload(payload, now() - start);
  ctx.logger.debug('externalAgent.adapter.inlineAgent.tool.search-web.payload', {
    payloadLength: totalBytes,
    resultCount: mapped.results.length,
  });
  reportMetrics({ status, resultCount: mapped.results.length });
  return { ok: true, data: mapped };
}

function mapHttpError(status: number): SearchWebError {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status < 600) return 'upstream_error';
  return 'http_error';
}

function mapTavilyPayload(
  payload: unknown,
  responseTimeMs: number,
): { answer?: string; results: SearchWebResultRow[]; responseTimeMs: number } {
  const out: { answer?: string; results: SearchWebResultRow[]; responseTimeMs: number } = {
    results: [],
    responseTimeMs,
  };
  if (payload === null || typeof payload !== 'object') return out;
  const p = payload as Record<string, unknown>;
  if (typeof p.answer === 'string' && p.answer.length > 0) out.answer = stripInvisible(p.answer);
  const rawResults = Array.isArray(p.results) ? p.results : [];
  for (const raw of rawResults) {
    const row = mapTavilyResultRow(raw);
    if (row !== null) out.results.push(row);
  }
  return out;
}

function mapTavilyResultRow(raw: unknown): SearchWebResultRow | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === 'string' ? r.url : '';
  if (url.length === 0) return null;
  const title = typeof r.title === 'string' ? stripInvisible(r.title) : '';
  const content = typeof r.content === 'string' ? stripInvisible(r.content) : '';
  const score = typeof r.score === 'number' ? r.score : 0;
  return { title, url, content, score };
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; totalBytes: number; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    const text = await response.text();
    const totalBytes = Buffer.byteLength(text, 'utf8');
    return { text, totalBytes, truncated: totalBytes > maxBytes };
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const step = await reader.read();
    if (step.done) break;
    if (step.value === undefined) continue;
    totalBytes += step.value.byteLength;
    chunks.push(step.value);
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      return { text: '', totalBytes, truncated: true };
    }
  }
  const text = Buffer.concat(
    chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)),
  ).toString('utf8');
  return { text, totalBytes, truncated: false };
}
