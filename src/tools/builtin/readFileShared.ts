import type { VaultAdapter } from '@/storage/vaultAdapter';

export interface ReadRange {
  readonly content: string;
  readonly numLines: number;
  readonly totalLines: number;
  readonly totalBytes: number;
  readonly readBytes: number;
}

export function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  let b = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else b += 3;
  }
  return b;
}

export function looksBinary(text: string): boolean {
  const sample = text.length > 8_192 ? text.slice(0, 8_192) : text;
  if (sample.length === 0) return false;
  let nul = 0;
  let ctrl = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    if (code === 0) nul += 1;
    else if (code < 32 && code !== 9 && code !== 10 && code !== 13) ctrl += 1;
  }
  if (nul > 0) return true;
  return ctrl / sample.length > 0.05;
}

export function readFileInRange(
  raw: string,
  lineOffset: number,
  limit: number | undefined,
): ReadRange {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const totalBytes = byteLength(text);
  if (text.length === 0) {
    return { content: '', numLines: 0, totalLines: 0, totalBytes: 0, readBytes: 0 };
  }
  const startIndex = Math.max(0, lineOffset);
  const cap = limit !== undefined && limit > 0 ? limit : Number.POSITIVE_INFINITY;
  const collected: string[] = [];
  let lineIndex = 0;
  let cursor = 0;
  while (cursor <= text.length) {
    const next = text.indexOf('\n', cursor);
    const end = next === -1 ? text.length : next;
    let line = text.slice(cursor, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (lineIndex >= startIndex && collected.length < cap) collected.push(line);
    lineIndex += 1;
    if (next === -1) break;
    cursor = next + 1;
  }
  const content = collected.join('\n');
  return {
    content,
    numLines: collected.length,
    totalLines: lineIndex,
    totalBytes,
    readBytes: byteLength(content),
  };
}

export function addLineNumbers(content: string, startLine: number): string {
  if (content.length === 0) return '';
  const lines = content.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    out.push(`${startLine + i}\t${lines[i]}`);
  }
  return out.join('\n');
}

const LINE_NUMBER_PREFIX = /^\s*\d+\t(.*)$/;

export function stripLineNumberPrefix(line: string): string {
  const m = LINE_NUMBER_PREFIX.exec(line);
  return m !== null ? (m[1] ?? '') : line;
}

const FIND_SIMILAR_MAX_VISIT = 5000;
const FIND_SIMILAR_MAX_DISTANCE = 3;

export async function findSimilarPaths(
  vault: VaultAdapter,
  missingPath: string,
  max = 3,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const target = basename(missingPath).toLowerCase();
  if (target.length === 0) return [];
  const candidates: { path: string; distance: number }[] = [];
  const queue: string[] = [''];
  let visited = 0;
  while (queue.length > 0) {
    if (signal?.aborted) break;
    if (visited >= FIND_SIMILAR_MAX_VISIT) break;
    const cur = queue.shift() as string;
    let listing;
    try {
      listing = await vault.list(cur);
    } catch {
      continue;
    }
    visited += 1;
    for (const f of listing.files) {
      const base = basename(f).toLowerCase();
      const distance = scoreDistance(base, target);
      if (distance >= 0) candidates.push({ path: f, distance });
    }
    for (const d of listing.folders) {
      if (basename(d).startsWith('.')) continue;
      queue.push(d);
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.slice(0, Math.max(1, max)).map((c) => c.path);
}

function scoreDistance(candidate: string, target: string): number {
  if (candidate === target) return 0;
  if (candidate.includes(target) || target.includes(candidate)) {
    return Math.abs(candidate.length - target.length);
  }
  const distance = levenshtein(candidate, target, FIND_SIMILAR_MAX_DISTANCE);
  return distance <= FIND_SIMILAR_MAX_DISTANCE ? distance : -1;
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function levenshtein(a: string, b: string, threshold: number): number {
  if (Math.abs(a.length - b.length) > threshold) return threshold + 1;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j += 1) prev[j] = j;
  for (let i = 1; i <= al; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      const candidate = curr[j] ?? rowMin;
      if (candidate < rowMin) rowMin = candidate;
    }
    if (rowMin > threshold) return threshold + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[bl] ?? threshold + 1;
}
