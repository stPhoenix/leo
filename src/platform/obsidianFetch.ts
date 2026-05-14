import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';

export type FetchLikeInit = Pick<RequestInit, 'method' | 'headers' | 'body' | 'signal'>;
export type FetchLike = (url: string, init: FetchLikeInit) => Promise<Response>;

export type WideFetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// Bridges Obsidian's main-process fetch (narrow init) to the wider RequestInit
// signature LangChain/OpenAI SDKs use. Body narrowed to string-or-undefined;
// requestUrl cannot stream and SDKs serialize JSON bodies to strings.
export function adaptToWideFetch(fn: FetchLike): WideFetchLike {
  return (input, init) =>
    fn(input, {
      method: init?.method,
      headers: init?.headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: init?.signal ?? undefined,
    });
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k] = v;
    return out;
  }
  return { ...(h as Record<string, string>) };
}

function toResponse(r: RequestUrlResponse): Response {
  return new Response(r.arrayBuffer, { status: r.status, headers: r.headers });
}

export function createObsidianFetch(): FetchLike {
  return async (url, init) => {
    const param: RequestUrlParam = {
      url,
      method: init.method ?? 'GET',
      headers: headersToRecord(init.headers as HeadersInit | undefined),
      throw: false,
    };
    if (typeof init.body === 'string') param.body = init.body;
    const signal = init.signal;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const reqPromise = requestUrl(param);
    if (!signal) return toResponse(await reqPromise);
    // requestUrl has no AbortSignal support — race against abort.
    // Underlying request still completes daemon-side; adapter ignores result.
    const abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
        once: true,
      });
    });
    return toResponse(await Promise.race([reqPromise, abortPromise]));
  };
}
