export interface AnthropicFetchPatchOpts {
  readonly betas: readonly string[];
  readonly deferLoading: ReadonlySet<string>;
  readonly underlying?: typeof fetch;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

const MESSAGES_PATH = '/v1/messages';

export function makeAnthropicFetchPatch(
  opts: AnthropicFetchPatchOpts,
): (input: FetchInput, init?: FetchInit) => Promise<Response> {
  const baseFetch = opts.underlying ?? fetch.bind(globalThis);
  return async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes(MESSAGES_PATH) || init === undefined) {
      return baseFetch(input, init);
    }
    const patchedInit = patchRequestInit(init, opts);
    return baseFetch(input, patchedInit);
  };
}

function patchRequestInit(
  init: NonNullable<FetchInit>,
  opts: AnthropicFetchPatchOpts,
): NonNullable<FetchInit> {
  const headers = new Headers(init.headers ?? {});
  if (opts.betas.length > 0) {
    const existing = headers.get('anthropic-beta');
    const merged =
      existing !== null && existing.length > 0
        ? `${existing},${opts.betas.join(',')}`
        : opts.betas.join(',');
    headers.set('anthropic-beta', merged);
  }

  const body = init.body;
  if (typeof body !== 'string' || body.length === 0) {
    return { ...init, headers };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ...init, headers };
  }
  if (parsed === null || typeof parsed !== 'object') return { ...init, headers, body };
  const obj = parsed as Record<string, unknown>;

  if (opts.deferLoading.size > 0 && Array.isArray(obj.tools)) {
    obj.tools = (obj.tools as Array<Record<string, unknown>>).map((t) => {
      if (t === null || typeof t !== 'object') return t;
      const name = typeof t.name === 'string' ? t.name : null;
      if (name !== null && opts.deferLoading.has(name)) {
        return { ...t, defer_loading: true };
      }
      return t;
    });
  }

  const newBody = JSON.stringify(obj);
  return { ...init, headers, body: newBody };
}
