export interface WikiIndexEntry {
  readonly path: string;
  readonly title: string;
  readonly category: string;
  readonly summary: string;
}

const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/;
const HEADING_RE = /^##\s+(.+?)\s*$/;
const ENTRY_RE = /^[-*]\s+/;

export function parseWikiIndex(markdown: string): readonly WikiIndexEntry[] {
  const entries: WikiIndexEntry[] = [];
  const lines = markdown.split(/\r?\n/);
  let category = 'Untagged';
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      category = heading[1] ?? 'Untagged';
      continue;
    }
    if (!ENTRY_RE.test(line)) continue;
    const after = line.replace(ENTRY_RE, '');
    const link = WIKILINK_RE.exec(after);
    if (link === null) continue;
    const target = (link[1] ?? '').trim();
    if (target.length === 0) continue;
    const path = normalizeIndexPath(target);
    const summary = after
      .slice((link.index ?? 0) + (link[0]?.length ?? 0))
      .replace(/^\s*[—:-]\s*/, '')
      .trim();
    const title = stemTitle(path);
    entries.push({ path, title, category, summary });
  }
  return entries;
}

function normalizeIndexPath(target: string): string {
  const stripped = target.split('|')[0]?.trim() ?? target;
  const withExt = stripped.endsWith('.md') ? stripped : `${stripped}.md`;
  return withExt.startsWith('wiki/') ? withExt : `wiki/${withExt}`;
}

function stemTitle(path: string): string {
  const base = path.replace(/\.md$/i, '');
  const slug = base.split('/').pop() ?? base;
  return slug.replace(/[-_]+/g, ' ').trim();
}

export interface ScoredEntry extends WikiIndexEntry {
  readonly score: number;
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
]);

export function tokenize(text: string): readonly string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length === 0) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

export function scoreEntries(
  entries: readonly WikiIndexEntry[],
  query: string,
): readonly ScoredEntry[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const scored: ScoredEntry[] = [];
  for (const entry of entries) {
    const titleTokens = tokenize(entry.title);
    const summaryTokens = tokenize(entry.summary);
    const categoryTokens = tokenize(entry.category);
    let score = 0;
    for (const t of tokens) {
      if (titleTokens.includes(t)) score += 3;
      if (summaryTokens.includes(t)) score += 1;
      if (categoryTokens.includes(t)) score += 1;
      if (entry.title.toLowerCase().includes(t)) score += 0.5;
    }
    if (score > 0) scored.push({ ...entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored;
}

export function topNCandidates(
  entries: readonly WikiIndexEntry[],
  query: string,
  n: number,
): readonly ScoredEntry[] {
  const ranked = scoreEntries(entries, query);
  return ranked.slice(0, Math.max(0, n));
}

export const WIKI_SEARCH_DEFAULT_N = 8;

export function buildSnippet(body: string, query: string, max = 240): string {
  const tokens = tokenize(query);
  if (tokens.length === 0) return body.slice(0, max).trim();
  const lower = body.toLowerCase();
  let bestIdx = -1;
  for (const t of tokens) {
    const idx = lower.indexOf(t);
    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) bestIdx = idx;
  }
  if (bestIdx < 0) return body.slice(0, max).trim();
  const start = Math.max(0, bestIdx - 60);
  const end = Math.min(body.length, start + max);
  return (start > 0 ? '…' : '') + body.slice(start, end).trim() + (end < body.length ? '…' : '');
}

export function summarizeFromBody(body: string, fallback: string): string {
  const lines = body.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i]?.trim() !== '---') i += 1;
    if (i < lines.length) i += 1;
  }
  for (; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('aliases:')) continue;
    return line.slice(0, 200);
  }
  return fallback;
}
