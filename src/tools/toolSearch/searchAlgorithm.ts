import type { ToolSpec } from '@/tools/types';
import type { SearchHit, SearchOptions } from './types';

const DEFAULT_MAX = 5;

export function search(
  rawQuery: string,
  candidates: readonly ToolSpec[],
  opts: SearchOptions = {},
): readonly SearchHit[] {
  const maxResults = opts.maxResults ?? DEFAULT_MAX;
  const query = rawQuery.trim();
  if (query.length === 0) return [];

  const selectMatch = /^select:(.+)$/i.exec(query);
  if (selectMatch !== null) {
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

  const lower = query.toLowerCase();
  const exact = candidates.find((c) => c.id.toLowerCase() === lower);
  if (exact !== undefined) return [{ name: exact.id, score: 100 }];

  if (lower.startsWith('mcp.') && lower.length > 4) {
    const out: SearchHit[] = [];
    for (const c of candidates) {
      if (c.id.toLowerCase().startsWith(lower)) {
        out.push({ name: c.id, score: 50 });
        if (out.length >= maxResults) break;
      }
    }
    if (out.length > 0) return out;
  }

  const tokens = lower.split(/\s+/).filter((t) => t.length > 0);
  const required: string[] = [];
  const optional: string[] = [];
  for (const t of tokens) {
    if (t.startsWith('+') && t.length > 1) required.push(t.slice(1));
    else optional.push(t);
  }

  const requiredRegexes = required.map((t) => makeBoundaryRegex(t));
  const allTerms = [...required, ...optional];
  if (allTerms.length === 0) return [];

  const termRegexes = new Map<string, RegExp>();
  for (const t of allTerms) termRegexes.set(t, makeBoundaryRegex(t));

  const descCache = new Map<string, string>();
  const descOf = (spec: ToolSpec): string => {
    const cached = descCache.get(spec.id);
    if (cached !== undefined) return cached;
    let d = spec.description;
    try {
      // descriptionOf override (e.g. expensive prompt resolution)
      if (opts.descriptionOf !== undefined) d = opts.descriptionOf(spec.id);
    } catch {
      d = '';
    }
    descCache.set(spec.id, d);
    return d;
  };

  const hits: SearchHit[] = [];
  for (const spec of candidates) {
    const desc = descOf(spec).toLowerCase();
    const hint = (spec.searchHint ?? '').toLowerCase();
    const isMcp = spec.isMcp === true;
    const parts = parseNameParts(spec.id, isMcp);
    const fullName = parts.join(' ');

    if (required.length > 0) {
      let allReq = true;
      for (let i = 0; i < required.length; i++) {
        const t = required[i]!;
        const re = requiredRegexes[i]!;
        if (!partsHasTerm(parts, t) && !re.test(desc) && !re.test(hint)) {
          allReq = false;
          break;
        }
      }
      if (!allReq) continue;
    }

    let score = 0;
    for (const term of allTerms) {
      let termScore = 0;
      const exactPart = parts.includes(term);
      const partialPart = !exactPart && parts.some((p) => p.includes(term));
      if (exactPart) termScore += isMcp ? 12 : 10;
      else if (partialPart) termScore += isMcp ? 6 : 5;
      else if (fullName.includes(term)) termScore += 3;
      const re = termRegexes.get(term)!;
      if (hint.length > 0 && re.test(hint)) termScore += 4;
      if (desc.length > 0 && re.test(desc)) termScore += 2;
      score += termScore;
    }
    if (score > 0) hits.push({ name: spec.id, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, maxResults);
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
