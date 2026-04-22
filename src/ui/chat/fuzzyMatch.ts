export interface FuzzyMatchResult<T> {
  readonly item: T;
  readonly score: number;
  readonly matches: readonly number[];
}

export function fuzzyMatch(pattern: string, target: string): readonly number[] | null {
  if (pattern.length === 0) return [];
  const p = pattern.toLowerCase();
  const t = target.toLowerCase();
  const out: number[] = [];
  let i = 0;
  for (let j = 0; j < t.length && i < p.length; j += 1) {
    if (t[j] === p[i]) {
      out.push(j);
      i += 1;
    }
  }
  if (i < p.length) return null;
  return out;
}

export function scoreMatches(pattern: string, target: string, matches: readonly number[]): number {
  if (matches.length === 0) return pattern.length === 0 ? 1 : 0;
  let score = 0;
  if (matches[0] === 0) score += 5;
  for (let k = 1; k < matches.length; k += 1) {
    if (matches[k] === matches[k - 1]! + 1) score += 3;
  }
  score += matches.length * 2;
  score -= target.length - matches.length;
  return score;
}

export function fuzzyFilter<T>(
  pattern: string,
  items: readonly T[],
  key: (item: T) => string,
): FuzzyMatchResult<T>[] {
  const results: FuzzyMatchResult<T>[] = [];
  for (const item of items) {
    const target = key(item);
    const matches = fuzzyMatch(pattern, target);
    if (matches === null) continue;
    results.push({ item, matches, score: scoreMatches(pattern, target, matches) });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}
