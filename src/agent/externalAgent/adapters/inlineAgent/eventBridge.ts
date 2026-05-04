import type { ExternalEvent } from '../base';

export const ARG_ELISION_THRESHOLD = 256;

export interface InlineAgentLoggerLite {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

// NOSONAR S6564 — intentional documentation alias; "elided" describes intent
export type ElidedValue = unknown;

export function elideArgs(toolName: string, args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return {};
  const src = args as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    out[key] = elideArgValue(toolName, key, value);
  }
  return out;
}

function elideArgValue(toolName: string, key: string, value: unknown): ElidedValue {
  if (toolName === 'fetch_url' && key === 'body' && typeof value === 'string') {
    return { length: value.length, elided: true };
  }
  if (toolName === 'search_web' && key === 'query' && typeof value === 'string') {
    return { length: value.length, elided: true };
  }
  if (
    toolName === 'search_web' &&
    (key === 'includeDomains' || key === 'excludeDomains') &&
    Array.isArray(value)
  ) {
    return { count: value.length, elided: true };
  }
  if (toolName === 'extract_note' && key === 'summary' && typeof value === 'string') {
    return { length: value.length, elided: true };
  }
  if (
    toolName === 'fetch_url' &&
    key === 'headers' &&
    value !== null &&
    typeof value === 'object'
  ) {
    const safe: Record<string, unknown> = {};
    for (const [hKey, hVal] of Object.entries(value as Record<string, unknown>)) {
      if (/^(authorization|cookie|x-api-key|api-key)$/i.test(hKey)) {
        safe[hKey] = '[redacted]';
        continue;
      }
      safe[hKey] = elidePrimitive(hVal);
    }
    return safe;
  }
  return elidePrimitive(value);
}

function elidePrimitive(value: unknown): ElidedValue {
  if (typeof value === 'string') {
    if (value.length > ARG_ELISION_THRESHOLD) {
      return { length: value.length, elided: true };
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 32) return { count: value.length, elided: true };
    return value.map((v) => elidePrimitive(v));
  }
  if (value !== null && typeof value === 'object') {
    return { keys: Object.keys(value as Record<string, unknown>).length, elided: true };
  }
  return value;
}

export function mapToolStart(input: {
  readonly tool: string;
  readonly args: unknown;
}): ExternalEvent {
  const elided = elideArgs(input.tool, input.args);
  const payload = { tool: input.tool, args: elided };
  return {
    type: 'log',
    level: 'info',
    msg: `tool.start ${stableStringify(payload)}`,
  };
}

export function mapToolEnd(input: {
  readonly tool: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly durationMs: number;
}): ExternalEvent {
  const payload: Record<string, unknown> = {
    tool: input.tool,
    ok: input.ok,
    durationMs: input.durationMs,
  };
  if (input.error !== undefined) payload.error = input.error;
  return {
    type: 'log',
    level: 'debug',
    msg: `tool.end ${stableStringify(payload)}`,
  };
}

export function mapNodeComplete(input: {
  readonly node: 'classify_task' | 'planner' | 'researchStep' | 'synthesize' | 'simple';
  readonly durationMs: number;
  readonly route?: 'simple' | 'multistep';
  readonly planLength?: number;
  readonly stepIndex?: number;
}): ExternalEvent {
  const payload: Record<string, unknown> = {
    node: input.node,
    durationMs: input.durationMs,
  };
  if (input.route !== undefined) payload.route = input.route;
  if (input.planLength !== undefined) payload.planLength = input.planLength;
  if (input.stepIndex !== undefined) payload.stepIndex = input.stepIndex;
  return {
    type: 'log',
    level: 'info',
    msg: `node.complete ${stableStringify(payload)}`,
  };
}

export function mapAdapterError(err: unknown): ExternalEvent {
  if (err !== null && typeof err === 'object' && 'code' in err && 'message' in err) {
    const e = err as { code?: unknown; message?: unknown };
    if (typeof e.code === 'string' && typeof e.message === 'string') {
      return { type: 'error', error: { code: e.code, message: e.message } };
    }
  }
  if (err instanceof Error) {
    return {
      type: 'error',
      error: { code: classifyErrorCode(err), message: err.message },
    };
  }
  return {
    type: 'error',
    error: { code: 'unknown_error', message: String(err) },
  };
}

function classifyErrorCode(err: Error): string {
  const name = err.name ?? '';
  if (name === 'AbortError') return 'aborted';
  if (/zod/i.test(name)) return 'invalid_args';
  if (/timeout/i.test(err.message)) return 'timeout';
  return 'adapter_error';
}

export function mapTextDelta(chunk: string): ExternalEvent {
  return { type: 'text', chunk };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Convert any iterable producing structured stream chunks into ExternalEvents.
 * The caller decides what each chunk means; this bridge only knows how to map
 * three discriminants:
 *   - { kind: 'text', chunk }
 *   - { kind: 'tool_start', tool, args }
 *   - { kind: 'tool_end', tool, ok, error?, durationMs }
 *   - { kind: 'node_complete', node, durationMs, route?, planLength?, stepIndex? }
 *   - { kind: 'error', error }
 *   - { kind: 'done' }
 *
 * Adapter-level error is captured as a single `error` ExternalEvent and the
 * iterable terminates without re-throwing — satisfies FR-IA-48.
 */
export type BridgeChunk =
  | { readonly kind: 'text'; readonly chunk: string }
  | { readonly kind: 'tool_start'; readonly tool: string; readonly args: unknown }
  | {
      readonly kind: 'tool_end';
      readonly tool: string;
      readonly ok: boolean;
      readonly error?: string;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'node_complete';
      readonly node: 'classify_task' | 'planner' | 'researchStep' | 'synthesize' | 'simple';
      readonly durationMs: number;
      readonly route?: 'simple' | 'multistep';
      readonly planLength?: number;
      readonly stepIndex?: number;
    }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'done' };

export interface BridgeStreamDeps {
  readonly logger: InlineAgentLoggerLite;
}

export async function* bridgeStream(
  source: AsyncIterable<BridgeChunk>,
  deps: BridgeStreamDeps,
): AsyncIterable<ExternalEvent> {
  try {
    for await (const chunk of source) {
      if (chunk.kind === 'text') {
        if (chunk.chunk.length === 0) continue;
        yield mapTextDelta(chunk.chunk);
        continue;
      }
      if (chunk.kind === 'tool_start') {
        deps.logger.debug('externalAgent.adapter.inlineAgent.tool.start', {
          tool: chunk.tool,
          args: chunk.args,
        });
        yield mapToolStart({ tool: chunk.tool, args: chunk.args });
        continue;
      }
      if (chunk.kind === 'tool_end') {
        yield mapToolEnd({
          tool: chunk.tool,
          ok: chunk.ok,
          durationMs: chunk.durationMs,
          ...(chunk.error !== undefined ? { error: chunk.error } : {}),
        });
        continue;
      }
      if (chunk.kind === 'node_complete') {
        yield mapNodeComplete(chunk);
        continue;
      }
      if (chunk.kind === 'error') {
        yield mapAdapterError(chunk.error);
        return;
      }
      if (chunk.kind === 'done') {
        yield { type: 'done' };
        return;
      }
    }
  } catch (err) {
    yield mapAdapterError(err);
  }
}
