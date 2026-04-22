import { minimatch } from 'minimatch';

export type ExcludeList = readonly string[];

export function normalizePatterns(raw: readonly string[]): ExcludeList {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function matches(path: string, patterns: ExcludeList): boolean {
  if (patterns.length === 0) return false;
  for (const pattern of patterns) {
    if (minimatch(path, pattern, { matchBase: false, dot: true })) return true;
  }
  return false;
}

export function compileMatcher(patterns: ExcludeList): (path: string) => boolean {
  if (patterns.length === 0) return (): boolean => false;
  return (path: string): boolean => matches(path, patterns);
}
