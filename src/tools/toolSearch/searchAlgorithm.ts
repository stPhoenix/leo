import type { ToolSpec } from '@/tools/types';
import type { SearchHit, SearchOptions } from './types';

const DEFAULT_MAX = 5;

interface ParsedQuery {
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly allTerms: readonly string[];
  readonly requiredRegexes: readonly RegExp[];
  readonly termRegexes: ReadonlyMap<string, RegExp>;
}

export function search(
  rawQuery: string,
  candidates: readonly ToolSpec[],
  opts: SearchOptions = {},
): readonly SearchHit[] {
  const maxResults = opts.maxResults ?? DEFAULT_MAX;
  const query = rawQuery.trim();
  if (query.length === 0) return [];

  const selectHit = trySelectQuery(query, candidates, maxResults);
  if (selectHit !== null) return selectHit;

  const lower = query.toLowerCase();
  const exact = candidates.find((c) => c.id.toLowerCase() === lower);
  if (exact !== undefined) return [{ name: exact.id, score: 100 }];

  const mcpHits = tryMcpPrefixMatches(lower, candidates, maxResults);
  if (mcpHits !== null) return mcpHits;

  const parsed = parseTokens(lower);
  if (parsed.allTerms.length === 0) return [];

  const descOf = makeDescOf(opts);
  const hits: SearchHit[] = [];
  for (const spec of candidates) {
    const score = scoreSpec(spec, parsed, descOf);
    if (score > 0) hits.push({ name: spec.id, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, maxResults);
}

function trySelectQuery(
  query: string,
  candidates: readonly ToolSpec[],
  maxResults: number,
): readonly SearchHit[] | null {
  const selectMatch = /^select:(.+)$/i.exec(query);
  if (selectMatch === null) return null;
  const requested = selectMatch[1]!
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  for (const name of requested) {
    const found = candidates.find((c) => c.id === name);
    if (found !== undefined && !seen.has(found.id)) {
      seen.add(found.id);
      out.push({ name: found.id, score: 100 });
    }
  }
  return out.slice(0, maxResults);
}

function tryMcpPrefixMatches(
  lower: string,
  candidates: readonly ToolSpec[],
  maxResults: number,
): readonly SearchHit[] | null {
  if (!lower.startsWith('mcp.') || lower.length <= 4) return null;
  const out: SearchHit[] = [];
  for (const c of candidates) {
    if (c.id.toLowerCase().startsWith(lower)) {
      out.push({ name: c.id, score: 50 });
      if (out.length >= maxResults) break;
    }
  }
  return out.length > 0 ? out : null;
}

function parseTokens(lower: string): ParsedQuery {
  const tokens = lower.split(/\s+/).filter((t) => t.length > 0);
  const required: string[] = [];
  const optional: string[] = [];
  for (const t of tokens) {
    if (t.startsWith('+') && t.length > 1) required.push(t.slice(1));
    else optional.push(t);
  }
  const requiredRegexes = required.map((t) => makeBoundaryRegex(t));
  const allTerms = [...required, ...optional];
  const termRegexes = new Map<string, RegExp>();
  for (const t of allTerms) termRegexes.set(t, makeBoundaryRegex(t));
  return { required, optional, allTerms, requiredRegexes, termRegexes };
}

function makeDescOf(opts: SearchOptions): (spec: ToolSpec) => string {
  const cache = new Map<string, string>();
  return (spec) => {
    const cached = cache.get(spec.id);
    if (cached !== undefined) return cached;
    let d = spec.description;
    try {
      if (opts.descriptionOf !== undefined) d = opts.descriptionOf(spec.id);
    } catch {
      d = '';
    }
    cache.set(spec.id, d);
    return d;
  };
}

function scoreSpec(
  spec: ToolSpec,
  parsed: ParsedQuery,
  descOf: (spec: ToolSpec) => string,
): number {
  const desc = descOf(spec).toLowerCase();
  const hint = (spec.searchHint ?? '').toLowerCase();
  const isMcp = spec.isMcp === true;
  const parts = parseNameParts(spec.id, isMcp);
  const fullName = parts.join(' ');

  if (!matchesRequired(parts, desc, hint, parsed)) return 0;

  let score = 0;
  for (const term of parsed.allTerms) {
    score += scoreTerm(term, parts, fullName, desc, hint, parsed.termRegexes, isMcp);
  }
  return score;
}

function matchesRequired(
  parts: readonly string[],
  desc: string,
  hint: string,
  parsed: ParsedQuery,
): boolean {
  for (let i = 0; i < parsed.required.length; i++) {
    const t = parsed.required[i]!;
    const re = parsed.requiredRegexes[i]!;
    if (!partsHasTerm(parts, t) && !re.test(desc) && !re.test(hint)) return false;
  }
  return true;
}

function scoreTerm(
  term: string,
  parts: readonly string[],
  fullName: string,
  desc: string,
  hint: string,
  termRegexes: ReadonlyMap<string, RegExp>,
  isMcp: boolean,
): number {
  let termScore = 0;
  const exactPart = parts.includes(term);
  const partialPart = !exactPart && parts.some((p) => p.includes(term));
  if (exactPart) termScore += isMcp ? 12 : 10;
  else if (partialPart) termScore += isMcp ? 6 : 5;
  else if (fullName.includes(term)) termScore += 3;
  const re = termRegexes.get(term)!;
  if (hint.length > 0 && re.test(hint)) termScore += 4;
  if (desc.length > 0 && re.test(desc)) termScore += 2;
  return termScore;
}

function partsHasTerm(parts: readonly string[], term: string): boolean {
  if (parts.includes(term)) return true;
  for (const p of parts) if (p.includes(term)) return true;
  return false;
}

function parseNameParts(id: string, isMcp: boolean): readonly string[] {
  if (isMcp) {
    let n = id;
    if (n.startsWith('mcp.')) n = n.slice(4);
    const out: string[] = [];
    for (const seg of n.split('.')) {
      for (const sub of seg.split('_')) {
        const lower = sub.toLowerCase();
        if (lower.length > 0) out.push(lower);
      }
    }
    return out;
  }
  const spaced = id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
  return spaced.split(/\s+/).filter((s) => s.length > 0);
}

function makeBoundaryRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}
