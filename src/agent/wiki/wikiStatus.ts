import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { WikiMutexState } from '@/agent/wiki/mutexTypes';
import { parseWikiIndex } from '@/agent/wiki/indexReader';
import {
  WIKI_INDEX_PATH,
  WIKI_LOG_PATH,
  WIKI_PAGES_DIR,
  WIKI_RAW_DIR,
  WIKI_SOURCES_DIR,
} from '@/agent/wiki/paths';

export interface WikiStatus {
  readonly indexPageCount: number;
  readonly indexSizeBytes: number;
  readonly lastLintTimestamp: string | null;
  readonly lastLintRunId: string | null;
  readonly orphanPageCount: number;
  readonly orphanRawCount: number;
  readonly mutexState: WikiMutexState;
}

export interface CollectWikiStatusDeps {
  readonly vault: VaultAdapter;
  readonly getMutexState: () => WikiMutexState;
}

const LINT_LOG_RE = /^##\s+\[([^\]]+)\]\s+lint\s+\|\s+runId=([A-Za-z0-9_-]+)/; // NOSONAR(typescript:S5852): anchored, negated char class terminates capture, linear.
const WIKILINK_RE = /\[\[([^\]\n|#]+)(?:\|[^\]]*)?\]\]/g;

export async function collectWikiStatus(deps: CollectWikiStatusDeps): Promise<WikiStatus> {
  const { vault, getMutexState } = deps;

  let indexPageCount = 0;
  let indexSizeBytes = 0;
  if (await vault.exists(WIKI_INDEX_PATH)) {
    const raw = await vault.read(WIKI_INDEX_PATH);
    indexSizeBytes = byteLength(raw);
    indexPageCount = parseWikiIndex(raw).length;
  }

  let lastLintTimestamp: string | null = null;
  let lastLintRunId: string | null = null;
  if (await vault.exists(WIKI_LOG_PATH)) {
    const log = await vault.read(WIKI_LOG_PATH);
    const lines = log.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const m = LINT_LOG_RE.exec(lines[i] ?? '');
      if (m === null) continue;
      lastLintTimestamp = m[1] ?? null;
      lastLintRunId = m[2] ?? null;
      break;
    }
  }

  const { orphanPageCount, orphanRawCount } = await scanOrphans(vault);

  return {
    indexPageCount,
    indexSizeBytes,
    lastLintTimestamp,
    lastLintRunId,
    orphanPageCount,
    orphanRawCount,
    mutexState: getMutexState(),
  };
}

interface OrphanCounts {
  readonly orphanPageCount: number;
  readonly orphanRawCount: number;
}

async function scanOrphans(vault: VaultAdapter): Promise<OrphanCounts> {
  const pageFiles = await listMarkdownFiles(vault, WIKI_PAGES_DIR);
  const sourceFiles = await listMarkdownFiles(vault, WIKI_SOURCES_DIR);
  const rawFiles = await listMarkdownFiles(vault, WIKI_RAW_DIR);

  const inbound = new Map<string, number>();
  for (const p of pageFiles) inbound.set(stripExt(p), 0);

  for (const p of pageFiles) {
    let body: string;
    try {
      body = await vault.read(p);
    } catch {
      continue;
    }
    for (const target of extractWikilinkTargets(body)) {
      const key = stripExt(normalizeWikilinkTarget(target));
      const current = inbound.get(key);
      if (current !== undefined) inbound.set(key, current + 1);
    }
  }
  let orphanPageCount = 0;
  for (const count of inbound.values()) if (count === 0) orphanPageCount += 1;

  const sourceRawPaths = new Set<string>();
  for (const sp of sourceFiles) {
    let body: string;
    try {
      body = await vault.read(sp);
    } catch {
      continue;
    }
    const fmRaw = extractFrontmatterField(body, 'raw_path');
    if (fmRaw !== null) sourceRawPaths.add(fmRaw.trim());
  }
  let orphanRawCount = 0;
  for (const r of rawFiles) {
    if (!sourceRawPaths.has(r)) orphanRawCount += 1;
  }

  return { orphanPageCount, orphanRawCount };
}

async function listMarkdownFiles(vault: VaultAdapter, dir: string): Promise<readonly string[]> {
  if (!(await vault.exists(dir))) return [];
  let listing;
  try {
    listing = await vault.list(dir);
  } catch {
    return [];
  }
  return listing.files.filter((f) => f.endsWith('.md'));
}

function stripExt(path: string): string {
  return path.endsWith('.md') ? path.slice(0, -3) : path;
}

function extractWikilinkTargets(body: string): readonly string[] {
  const out: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  for (let m = WIKILINK_RE.exec(body); m !== null; m = WIKILINK_RE.exec(body)) {
    const target = (m[1] ?? '').trim();
    if (target.length > 0) out.push(target);
  }
  return out;
}

function normalizeWikilinkTarget(target: string): string {
  const trimmed = target.trim();
  if (trimmed.startsWith('wiki/')) return trimmed;
  return `wiki/${trimmed}`;
}

function extractFrontmatterField(body: string, field: string): string | null {
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') return null;
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(line); // NOSONAR(typescript:S5852): anchored YAML key:value, char class + lazy capture, linear per line.
    if (m === null) continue;
    if (m[1] === field) return (m[2] ?? '').replace(/^["']|["']$/g, '');
  }
  return null;
}

function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
  return text.length;
}
