export type DiffKind = 'add' | 'del' | 'ctx';

export interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
  readonly beforeLine?: number;
  readonly afterLine?: number;
}

export interface DiffStats {
  readonly added: number;
  readonly removed: number;
}

export function computeUnifiedDiff(
  before: string,
  after: string,
  opts: { context?: number } = {},
): { lines: readonly DiffLine[]; stats: DiffStats } {
  const a = splitLines(before);
  const b = splitLines(after);
  const lcs = buildLcs(a, b);
  const raw = walk(a, b, lcs);
  const ctxN = opts.context ?? 3;
  const lines = trimContext(raw, ctxN);
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === 'add') added += 1;
    else if (l.kind === 'del') removed += 1;
  }
  return { lines, stats: { added, removed } };
}

function splitLines(s: string): string[] {
  if (s === '') return [];
  return s.split('\n');
}

function buildLcs(a: readonly string[], b: readonly string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  return dp;
}

function walk(a: readonly string[], b: readonly string[], dp: number[][]): DiffLine[] {
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'ctx', text: a[i]!, beforeLine: i + 1, afterLine: j + 1 });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: 'del', text: a[i]!, beforeLine: i + 1 });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j]!, afterLine: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: 'del', text: a[i]!, beforeLine: i + 1 });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: 'add', text: b[j]!, afterLine: j + 1 });
    j += 1;
  }
  return out;
}

function trimContext(lines: DiffLine[], ctx: number): DiffLine[] {
  if (lines.length === 0) return lines;
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.kind !== 'ctx') {
      const start = Math.max(0, i - ctx);
      const end = Math.min(lines.length - 1, i + ctx);
      for (let k = start; k <= end; k += 1) keep[k] = true;
    }
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (keep[i]) out.push(lines[i]!);
  }
  return out;
}
