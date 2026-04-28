import { beforeAll, describe } from 'vitest';

export interface SkipCapable {
  skip(): void;
}

export function skipIfUnreachable(t: SkipCapable, ctx: LiveSuiteContext): boolean {
  if (!ctx.reachable) {
    t.skip();
    return true;
  }
  return false;
}

export interface LiveEnv {
  readonly endpoint: string;
  readonly chatModel: string;
  readonly embedModel: string;
  readonly judgeModel: string;
  readonly timeoutMs: number;
}

export function readEnv(opts: { readonly requireEmbed?: boolean } = {}): LiveEnv {
  const endpoint = process.env.LEO_LLM_ENDPOINT ?? 'http://localhost:1234';
  const chatModel = process.env.LEO_LLM_MODEL;
  if (chatModel === undefined || chatModel.length === 0) {
    throw new Error(
      'live-llm: LEO_LLM_MODEL is required. Set it to the chat model id loaded in LM Studio.',
    );
  }
  const embedModel = process.env.LEO_LLM_EMBED_MODEL;
  if (opts.requireEmbed === true && (embedModel === undefined || embedModel.length === 0)) {
    throw new Error('live-llm: LEO_LLM_EMBED_MODEL is required for embedding tests.');
  }
  const judgeModel = process.env.LEO_LLM_JUDGE_MODEL ?? chatModel;
  const timeoutRaw = process.env.LEO_LLM_TIMEOUT_MS;
  const timeoutMs = timeoutRaw !== undefined ? Number.parseInt(timeoutRaw, 10) : 180_000;
  return {
    endpoint,
    chatModel,
    embedModel: embedModel ?? '',
    judgeModel,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180_000,
  };
}

export async function probeReachable(endpoint: string, timeoutMs = 2_000): Promise<boolean> {
  const url = `${endpoint.replace(/\/+$/, '')}/v1/models`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface LiveSuiteContext {
  readonly env: LiveEnv;
  readonly reachable: boolean;
}

export function liveDescribe(
  name: string,
  body: (getCtx: () => LiveSuiteContext) => void,
  opts: { readonly requireEmbed?: boolean } = {},
): void {
  describe(name, () => {
    const state: { env: LiveEnv | null; reachable: boolean } = { env: null, reachable: false };
    beforeAll(async () => {
      state.env = readEnv(opts);
      state.reachable = await probeReachable(state.env.endpoint);
      if (!state.reachable) {
        // eslint-disable-next-line no-console
        console.warn(
          `[llm] endpoint unreachable at ${state.env.endpoint} — skipping "${name}" suite`,
        );
      }
    });
    body(() => {
      if (state.env === null) throw new Error('liveDescribe: env not initialised');
      return { env: state.env, reachable: state.reachable };
    });
  });
}
