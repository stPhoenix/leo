// Wraps externally-fetched bytes that flow into the LLM's tool-message stream
// in an `<untrusted-content origin="...">…</untrusted-content>` envelope so the
// model can distinguish data from instructions. Pair with the system-prompt
// rule about untrusted blocks. Pure module.

const NESTED_CLOSE_REGEX = /<\/untrusted-content>/gi;

export function wrapUntrusted(text: string, origin: string): string {
  const safeOrigin = origin.replace(/["\r\n]/g, '');
  const safeText = text.replace(NESTED_CLOSE_REGEX, '</untrusted-content_>');
  return `<untrusted-content origin="${safeOrigin}">${safeText}</untrusted-content>`;
}

interface OkLike {
  readonly ok: true;
  readonly data: Record<string, unknown>;
}

function isOkLike(v: unknown): v is OkLike {
  return (
    typeof v === 'object' &&
    v !== null &&
    'ok' in v &&
    (v as { ok: unknown }).ok === true &&
    'data' in v &&
    typeof (v as { data: unknown }).data === 'object' &&
    (v as { data: unknown }).data !== null
  );
}

interface SearchRow {
  readonly title?: string;
  readonly url?: string;
  readonly content?: string;
  readonly score?: number;
}

export function wrapToolResultForLLM(name: string, result: unknown): unknown {
  if (!isOkLike(result)) return result;
  const data = result.data;
  if (name === 'fetch_url') {
    const body = data.body;
    const url = typeof data.url === 'string' ? data.url : '';
    if (typeof body !== 'string') return result;
    return { ...result, data: { ...data, body: wrapUntrusted(body, url) } };
  }
  if (name === 'search_web') {
    const answer = data.answer;
    const rawResults = Array.isArray(data.results) ? (data.results as SearchRow[]) : [];
    const wrappedResults = rawResults.map((r) => {
      const url = typeof r.url === 'string' ? r.url : '';
      const content = typeof r.content === 'string' ? r.content : '';
      return { ...r, content: wrapUntrusted(content, url) };
    });
    const out: Record<string, unknown> = { ...data, results: wrappedResults };
    if (typeof answer === 'string') {
      out.answer = wrapUntrusted(answer, 'tavily://aggregate');
    }
    return { ...result, data: out };
  }
  return result;
}
