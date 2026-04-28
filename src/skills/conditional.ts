// Doc §7 conditional activation. Leo deviations: cwd is the vault root, paths
// are vault-relative (forward slash only), and the matcher runs inside the
// Electron renderer so we rely on the `ignore` npm package.

import ignore, { type Ignore } from 'ignore';

export interface ConditionalMatcher {
  matches(relativePath: string): boolean;
}

export function createConditionalMatcher(patterns: readonly string[]): ConditionalMatcher | null {
  const filtered = patterns.filter((p) => isUsablePattern(p));
  if (filtered.length === 0) return null;
  const instance: Ignore = ignore();
  instance.add(filtered.slice());
  return {
    matches(relativePath) {
      if (!isEligiblePath(relativePath)) return false;
      return instance.ignores(normalize(relativePath));
    },
  };
}

function isUsablePattern(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === '**' || trimmed === '**/*') return false;
  return true;
}

function isEligiblePath(relativePath: string): boolean {
  if (relativePath.length === 0) return false;
  if (relativePath.startsWith('..')) return false;
  if (/^[A-Za-z]:[\\/]/.test(relativePath)) return false;
  if (relativePath.startsWith('/')) return false;
  return true;
}

function normalize(relativePath: string): string {
  return relativePath.replace(/\\/g, '/');
}
