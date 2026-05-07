import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import {
  WIKI_INDEX_PATH,
  WIKI_INTRODUCTION_PATH,
  WIKI_LOG_PATH,
  WIKI_PAGES_DIR,
  WIKI_RAW_DIR,
  WIKI_SCHEMA_PATH,
  WIKI_SOURCES_DIR,
} from '@/agent/wiki/paths';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';

export interface PageNode {
  readonly path: string;
  readonly slug: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly outbound: readonly string[];
}

export interface SourceNode {
  readonly path: string;
  readonly rawPath: string | null;
}

export interface LintScanResult {
  readonly pages: readonly PageNode[];
  readonly sources: readonly SourceNode[];
  readonly rawPaths: readonly string[];
  readonly adjacency: ReadonlyMap<string, ReadonlySet<string>>;
  readonly inboundCount: ReadonlyMap<string, number>;
  readonly orphanPages: readonly string[];
  readonly orphanRawPaths: readonly string[];
  readonly schemaMd: string;
}

export interface LintScanDeps {
  readonly vault: VaultAdapter;
  readonly logger?: Logger;
}

const WIKILINK_RE = /\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]]*)?\]\]/g; // NOSONAR(typescript:S5852): negated char classes terminate at `]`/`|`/`#`/newline, linear.

const SKIP_PAGE_PATHS = new Set<string>([
  WIKI_INDEX_PATH,
  WIKI_LOG_PATH,
  WIKI_INTRODUCTION_PATH,
  WIKI_SCHEMA_PATH,
]);

export async function scanWiki(deps: LintScanDeps): Promise<LintScanResult> {
  const { vault } = deps;
  const pages = await loadPages(vault);
  const sources = await loadSources(vault);
  const rawPaths = await listMarkdownFiles(vault, WIKI_RAW_DIR);
  const schemaMd = (await vault.exists(WIKI_SCHEMA_PATH)) ? await vault.read(WIKI_SCHEMA_PATH) : '';

  const adjacency = buildAdjacency(pages);
  const inboundCount = countInbound(adjacency, pages);
  const orphanPages = pages
    .map((p) => p.path)
    .filter((p) => (inboundCount.get(p) ?? 0) === 0)
    .sort((a, b) => a.localeCompare(b));

  const sourceRawPaths = new Set<string>();
  for (const s of sources) if (s.rawPath !== null) sourceRawPaths.add(s.rawPath);
  const orphanRawPaths = rawPaths
    .filter((r) => !sourceRawPaths.has(r))
    .sort((a, b) => a.localeCompare(b));

  deps.logger?.debug(WIKI_LOG.lint.scan.ok, {
    pages: pages.length,
    sources: sources.length,
    rawPaths: rawPaths.length,
    orphanPages: orphanPages.length,
    orphanRawPaths: orphanRawPaths.length,
  });

  return {
    pages,
    sources,
    rawPaths,
    adjacency,
    inboundCount,
    orphanPages,
    orphanRawPaths,
    schemaMd,
  };
}

async function loadPages(vault: VaultAdapter): Promise<readonly PageNode[]> {
  const out: PageNode[] = [];
  const files = await listMarkdownFiles(vault, WIKI_PAGES_DIR);
  for (const path of files) {
    if (SKIP_PAGE_PATHS.has(path)) continue;
    let body: string;
    try {
      body = await vault.read(path);
    } catch {
      continue;
    }
    const fm = parseFrontmatter(body);
    const slug = path.replace(`${WIKI_PAGES_DIR}/`, '').replace(/\.md$/i, '');
    const title = extractTitle(body) ?? slug.replace(/-/g, ' ');
    const tags = parseTagsField(fm['tags']);
    const outbound = extractWikilinkPaths(body);
    out.push({ path, slug, title, tags, outbound });
  }
  return out;
}

async function loadSources(vault: VaultAdapter): Promise<readonly SourceNode[]> {
  const out: SourceNode[] = [];
  const files = await listMarkdownFiles(vault, WIKI_SOURCES_DIR);
  for (const path of files) {
    let body: string;
    try {
      body = await vault.read(path);
    } catch {
      continue;
    }
    const fm = parseFrontmatter(body);
    out.push({ path, rawPath: fm['raw_path']?.trim() ?? null });
  }
  return out;
}

async function listMarkdownFiles(vault: VaultAdapter, dir: string): Promise<readonly string[]> {
  if (!(await vault.exists(dir))) return [];
  let listing;
  try {
    listing = await vault.list(dir);
  } catch {
    return [];
  }
  return listing.files
    .filter((f) => f.endsWith('.md'))
    .slice()
    .sort((a, b) => a.localeCompare(b));
}

function buildAdjacency(pages: readonly PageNode[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const p of pages) adjacency.set(p.path, new Set());
  for (const p of pages) {
    const set = adjacency.get(p.path);
    if (set === undefined) continue;
    for (const target of p.outbound) {
      const normalized = normalizeWikilinkTarget(target);
      set.add(normalized);
      // Symmetric merge: targets back-link to source so both directions show
      // up in inbound counts even when the lifestream graph cache is sparse.
      const backList = adjacency.get(normalized);
      if (backList !== undefined) backList.add(p.path);
    }
  }
  return adjacency;
}

function countInbound(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  pages: readonly PageNode[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of pages) out.set(p.path, 0);
  for (const [src, targets] of adjacency.entries()) {
    for (const t of targets) {
      if (t === src) continue;
      const cur = out.get(t);
      if (cur !== undefined) out.set(t, cur + 1);
    }
  }
  return out;
}

function parseFrontmatter(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return out;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') break;
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(line); // NOSONAR(typescript:S5852): anchored YAML key:value, char class + lazy capture, linear per line.
    if (m === null) continue;
    out[m[1]!] = m[2] ?? '';
  }
  return out;
}

function parseTagsField(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter((s) => s.length > 0);
  }
  return trimmed
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function extractTitle(body: string): string | null {
  const lines = body.split(/\r?\n/);
  let inFm = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (i === 0 && line === '---') {
      inFm = true;
      continue;
    }
    if (inFm) {
      if (line === '---') inFm = false;
      continue;
    }
    if (line.startsWith('# ')) return line.slice(2).trim();
  }
  return null;
}

function extractWikilinkPaths(body: string): readonly string[] {
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
  const withExt = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
  return withExt.startsWith('wiki/') ? withExt : `wiki/${withExt}`;
}
