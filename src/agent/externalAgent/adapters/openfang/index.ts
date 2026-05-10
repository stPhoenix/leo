import {
  ExternalAgentAdapter,
  type AdapterCapabilities,
  type ExternalAgentInput,
  type ExternalEvent,
} from '../base';
import { openfangConfigSchema } from './configSchema';
import {
  createOpenfangHttp,
  OpenfangHttpError,
  type FetchLike,
  type LogFn,
  type OpenfangHttp,
  type A2aMessage,
  type A2aPart,
  type A2aTask,
} from './httpClient';
import { abortableSleep, extractStatusKind, pollUntilTerminal } from './polling';
import { downloadArtifacts } from './artifacts';
import { decodeFailureText } from './failureDecoder';
import { mapHttpError, mapNetworkError } from './httpErrorMapping';

export interface OpenfangAdapterDeps {
  readonly fetchImpl?: FetchLike;
}

export { openfangConfigSchema };
export type { OpenfangConfig } from './configSchema';

const SUBMIT_RETRY_BUDGET = 3;
const SUBMIT_RETRY_BASE_MS = 1_000;
const CANCEL_BEST_EFFORT_TIMEOUT_MS = 2_000;

function redactFields(
  fields: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (!fields) return fields;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'headers' && v && typeof v === 'object') {
      const headers = v as Record<string, unknown>;
      const safe: Record<string, unknown> = {};
      for (const [hk, hv] of Object.entries(headers)) {
        safe[hk] = hk.toLowerCase() === 'authorization' ? 'Bearer ***' : hv;
      }
      out[k] = safe;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function lastAgentMessage(task: A2aTask): A2aMessage | undefined {
  const msgs = task.messages ?? [];
  if (msgs.length === 0) return undefined;
  return msgs[msgs.length - 1];
}

function renderTextAndData(parts: readonly A2aPart[]): { text: string; events: ExternalEvent[] } {
  const events: ExternalEvent[] = [];
  let combined = '';
  for (const part of parts) {
    if (part.type === 'text') {
      const chunk = (part as { text?: string }).text ?? '';
      events.push({ type: 'text', chunk });
      combined += chunk;
    } else if (part.type === 'data') {
      const data = (part as { data?: unknown }).data;
      const chunk = `\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
      events.push({ type: 'text', chunk });
      combined += chunk;
    }
  }
  return { text: combined, events };
}

export class OpenfangAdapter extends ExternalAgentAdapter {
  readonly id = 'openfang';
  readonly label = 'OpenFang (Demiurg via A2A)';
  readonly defaultTimeoutMs = 1_800_000;
  readonly capabilities: AdapterCapabilities = { files: true, stream: false };
  readonly configSchema = openfangConfigSchema;
  private readonly deps: OpenfangAdapterDeps;

  constructor(deps: OpenfangAdapterDeps = {}) {
    super();
    this.deps = deps;
  }

  async *start(input: ExternalAgentInput): AsyncIterable<ExternalEvent> {
    const logBuffer: ExternalEvent[] = [];
    const log: LogFn = (level, msg, fields) => {
      logBuffer.push({ type: 'log', level, msg: formatLogMsg(msg, redactFields(fields)) });
    };
    const drain = (): ExternalEvent[] => {
      if (logBuffer.length === 0) return [];
      const out = logBuffer.slice();
      logBuffer.length = 0;
      return out;
    };

    const parsed = openfangConfigSchema.safeParse(input.config);
    if (!parsed.success) {
      yield {
        type: 'error',
        error: { code: 'invalid_config', message: parsed.error.message },
      };
      return;
    }
    const config = parsed.data;

    if (!config.allowInsecureHttp) {
      let proto: string | null = null;
      try {
        proto = new URL(config.baseUrl).protocol;
      } catch {
        proto = null;
      }
      if (proto !== 'https:') {
        yield {
          type: 'error',
          error: {
            code: 'insecure_transport',
            message: 'baseUrl is not https; set allowInsecureHttp=true to override',
          },
        };
        return;
      }
    }

    const http = createOpenfangHttp(config, log, this.deps);

    let task: A2aTask;
    try {
      task = await submitWithRetry(http, input, log);
    } catch (err) {
      yield* drain();
      if (err instanceof OpenfangHttpError) {
        yield { type: 'error', error: mapHttpError(err, 'submit') };
        return;
      }
      if (err instanceof TransientExhausted) {
        yield {
          type: 'error',
          error: {
            code: 'transient_failure',
            message: `submit failed with HTTP ${err.lastStatus} after ${SUBMIT_RETRY_BUDGET} attempts`,
          },
        };
        return;
      }
      if (input.signal.aborted) {
        yield { type: 'error', error: { code: 'cancelled', message: 'aborted by host' } };
        return;
      }
      const network = mapNetworkError(err, 'submit');
      if (network !== null) {
        yield { type: 'error', error: network };
        return;
      }
      yield {
        type: 'error',
        error: { code: 'submit_failed', message: err instanceof Error ? err.message : String(err) },
      };
      return;
    }

    const taskId = task.id;
    log('info', 'task_submitted', { taskId });
    yield* drain();

    const onAbort = () => {
      const cancelSignal = AbortSignal.timeout(CANCEL_BEST_EFFORT_TIMEOUT_MS);
      void http.cancelTask(taskId, cancelSignal).catch(() => {
        /* best-effort */
      });
    };
    input.signal.addEventListener('abort', onAbort, { once: true });

    let pollResult;
    try {
      pollResult = await pollUntilTerminal(
        { http, sleep: abortableSleep, now: Date.now },
        {
          taskId,
          signal: input.signal,
          initialIntervalMs: config.pollInitialIntervalMs,
          maxIntervalMs: config.pollMaxIntervalMs,
          timeoutMs: config.pollTimeoutMs,
        },
      );
    } catch (err) {
      yield* drain();
      if (err instanceof OpenfangHttpError) {
        yield { type: 'error', error: mapHttpError(err, 'poll') };
        return;
      }
      const network = mapNetworkError(err, 'poll');
      if (network !== null) {
        yield { type: 'error', error: network };
        return;
      }
      yield {
        type: 'error',
        error: { code: 'poll_failed', message: err instanceof Error ? err.message : String(err) },
      };
      return;
    } finally {
      input.signal.removeEventListener('abort', onAbort);
    }

    yield* drain();

    if (pollResult.kind === 'timeout') {
      yield {
        type: 'error',
        error: {
          code: 'poll_timeout',
          message: `task ${taskId} did not terminate within ${config.pollTimeoutMs}ms`,
        },
      };
      return;
    }
    if (pollResult.kind === 'aborted') {
      yield { type: 'error', error: { code: 'cancelled', message: 'aborted by host' } };
      return;
    }
    if (pollResult.kind === 'transient_exhausted') {
      yield {
        type: 'error',
        error: {
          code: 'transient_failure',
          message: `poll failed with HTTP ${pollResult.lastStatus} after retries`,
        },
      };
      return;
    }

    const terminalTask = pollResult.task;
    const lastMsg = lastAgentMessage(terminalTask);
    const rendered = renderTextAndData(lastMsg?.parts ?? []);
    for (const ev of rendered.events) yield ev;

    const status = extractStatusKind(terminalTask.status);
    if (status === 'failed') {
      const decoded = decodeFailureText(rendered.text);
      yield { type: 'error', error: { code: decoded.code, message: decoded.message } };
      return;
    }
    if (status === 'cancelled') {
      yield { type: 'error', error: { code: 'cancelled', message: 'task cancelled on daemon' } };
      return;
    }

    yield* downloadArtifacts({ http, log }, terminalTask, input.signal);
    yield* drain();
    yield { type: 'done' };
  }
}

function formatLogMsg(msg: string, fields: Record<string, unknown> | undefined): string {
  if (!fields || Object.keys(fields).length === 0) return msg;
  return `${msg} ${JSON.stringify(fields)}`;
}

class TransientExhausted extends Error {
  constructor(public readonly lastStatus: number) {
    super(`submit transient_exhausted: ${lastStatus}`);
    this.name = 'TransientExhausted';
  }
}

async function submitWithRetry(
  http: OpenfangHttp,
  input: ExternalAgentInput,
  log: LogFn,
): Promise<A2aTask> {
  const config = openfangConfigSchema.parse(input.config);
  let attempt = 0;
  let lastStatus = 500;
  while (attempt < SUBMIT_RETRY_BUDGET) {
    if (input.signal.aborted) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    try {
      return await http.submitTask(
        { text: input.refinedAsk, sessionId: config.sessionId },
        input.signal,
      );
    } catch (err) {
      if (err instanceof OpenfangHttpError && err.status >= 500) {
        lastStatus = err.status;
        attempt += 1;
        if (attempt >= SUBMIT_RETRY_BUDGET) {
          throw new TransientExhausted(lastStatus);
        }
        const backoff = SUBMIT_RETRY_BASE_MS * 2 ** (attempt - 1);
        log('warn', 'submit.retry', { attempt, backoff, status: err.status });
        await abortableSleep(backoff, input.signal);
        continue;
      }
      throw err;
    }
  }
  throw new TransientExhausted(lastStatus);
}
