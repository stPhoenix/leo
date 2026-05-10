import type { OpenfangHttpError } from './httpClient';

export type ErrorContext = 'submit' | 'poll' | 'cancel' | 'artifact';

export interface MappedError {
  readonly code: string;
  readonly message: string;
}

const NETWORK_ERR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

export function mapNetworkError(err: unknown, ctx: ErrorContext): MappedError | null {
  if (!(err instanceof Error)) return null;
  const code = (err as Error & { code?: string }).code;
  const msg = err.message ?? '';
  const isFetchTypeError = err.name === 'TypeError' && /fetch/i.test(msg);
  if (!isFetchTypeError && (code === undefined || !NETWORK_ERR_CODES.has(code))) return null;
  return {
    code: 'network_unreachable',
    message: `${ctx} could not reach daemon: ${msg || code || 'unknown network error'}`,
  };
}

export function mapHttpError(err: OpenfangHttpError, ctx: ErrorContext): MappedError {
  const status = err.status;
  if (status === 401) {
    return { code: 'invalid_auth', message: `${ctx} rejected: invalid or missing API key` };
  }
  if (status === 403) {
    return {
      code: 'operator_misconfig',
      message: `${ctx} rejected: daemon has no API key configured`,
    };
  }
  if (status === 404) {
    if (ctx === 'submit') return { code: 'no_agents', message: 'no agents available on daemon' };
    if (ctx === 'poll') return { code: 'task_not_found', message: 'task evicted or unknown id' };
    if (ctx === 'artifact')
      return { code: 'artifact_evicted', message: 'artifact missing on daemon' };
    return { code: 'not_found', message: `${ctx} 404` };
  }
  if (status >= 400 && status < 500) {
    return { code: 'bad_request', message: `${ctx} HTTP ${status}: ${err.bodySnippet}` };
  }
  if (status >= 500) {
    return { code: 'transient_failure', message: `${ctx} HTTP ${status}: ${err.bodySnippet}` };
  }
  return { code: 'unknown_http', message: `${ctx} HTTP ${status}` };
}
