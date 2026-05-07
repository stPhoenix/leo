import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import {
  WIKI_INDEX_PATH,
  WIKI_LOG_PATH,
  WIKI_PAGES_DIR,
  WIKI_SOURCES_DIR,
} from '@/agent/wiki/paths';
import type { LintFindingPatch } from '@/agent/wiki/lint/schemas';
import type { ReducerOutput } from './schemas';

export interface PersistedRawSummary {
  readonly rawPath: string;
  readonly sourceRef: string;
  readonly fetchedAt: string;
  readonly sha256: string;
  readonly summary: string;
  readonly bullets: readonly string[];
}

export interface WriteIngestInput {
  readonly runId: string;
  readonly creates: readonly ReducerOutput[];
  readonly edits: readonly ReducerOutput[];
  readonly sourceSummaries: readonly PersistedRawSummary[];
  readonly logTimestamp?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly cancelledMidWrite?: boolean;
}

export interface WriterResult {
  readonly pagesCreated: number;
  readonly pagesEdited: number;
  readonly sourcesWritten: number;
  readonly indexRegenerated: boolean;
  readonly logAppended: boolean;
  readonly errors: readonly { readonly path: string; readonly message: string }[];
}

export interface WriteIngestDeps {
  readonly vault: VaultAdapter;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

export async function writeIngest(
  input: WriteIngestInput,
  deps: WriteIngestDeps,
): Promise<WriterResult> {
  const errors: { path: string; message: string }[] = [];
  let pagesCreated = 0;
  let pagesEdited = 0;
  let sourcesWritten = 0;

  // 1. Page creates (sorted by slug for deterministic order).
  const creates = [...input.creates].sort((a, b) => a.pageSlug.localeCompare(b.pageSlug));
  for (const out of creates) {
    const path = pagePathFromSlug(out.pageSlug);
    try {
      await deps.vault.mkdir(WIKI_PAGES_DIR);
      await deps.vault.write(path, renderPage(out));
      pagesCreated += 1;
      deps.logger?.debug(WIKI_LOG.ingest.write.ok, { path });
    } catch (err) {
      errors.push({ path, message: errMsg(err) });
      deps.logger?.warn(WIKI_LOG.ingest.write.failed, { path, error: errMsg(err) });
    }
  }

  // 2. Page edits (sorted by slug).
  const edits = [...input.edits].sort((a, b) => a.pageSlug.localeCompare(b.pageSlug));
  for (const out of edits) {
    const path = pagePathFromSlug(out.pageSlug);
    try {
      await deps.vault.write(path, renderPage(out));
      pagesEdited += 1;
      deps.logger?.debug(WIKI_LOG.ingest.write.ok, { path });
    } catch (err) {
      errors.push({ path, message: errMsg(err) });
      deps.logger?.warn(WIKI_LOG.ingest.write.failed, { path, error: errMsg(err) });
    }
  }

  // 3. Source summaries (sorted by raw path).
  const summaries = [...input.sourceSummaries].sort((a, b) => a.rawPath.localeCompare(b.rawPath));
  for (const s of summaries) {
    const path = sourcePathFromRaw(s.rawPath);
    try {
      await deps.vault.mkdir(WIKI_SOURCES_DIR);
      await deps.vault.write(path, renderSource(s));
      sourcesWritten += 1;
    } catch (err) {
      errors.push({ path, message: errMsg(err) });
      deps.logger?.warn(WIKI_LOG.ingest.write.failed, { path, error: errMsg(err) });
    }
  }

  // 4. Regenerate index from current pages/.
  let indexRegenerated = false;
  try {
    const index = await regenerateIndex(deps.vault);
    await deps.vault.write(WIKI_INDEX_PATH, index);
    indexRegenerated = true;
    deps.logger?.debug(WIKI_LOG.ingest.write.ok, { path: WIKI_INDEX_PATH });
  } catch (err) {
    errors.push({ path: WIKI_INDEX_PATH, message: errMsg(err) });
    deps.logger?.warn(WIKI_LOG.ingest.write.failed, {
      path: WIKI_INDEX_PATH,
      error: errMsg(err),
    });
  }

  // 5. Append log entry.
  let logAppended = false;
  try {
    const ts = input.logTimestamp ?? (deps.now ?? ((): Date => new Date()))().toISOString();
    const title = renderLogTitle(input.sourceSummaries);
    const logLine = renderLogLine({
      ts,
      runId: input.runId,
      title,
      pagesCreated,
      pagesEdited,
      sourcesWritten,
      cancelledMidWrite: input.cancelledMidWrite === true,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    });
    const existing = (await deps.vault.exists(WIKI_LOG_PATH))
      ? await deps.vault.read(WIKI_LOG_PATH)
      : '# Wiki log\n\n';
    const next = existing.endsWith('\n') ? `${existing}${logLine}\n` : `${existing}\n${logLine}\n`;
    await deps.vault.write(WIKI_LOG_PATH, next);
    logAppended = true;
  } catch (err) {
    errors.push({ path: WIKI_LOG_PATH, message: errMsg(err) });
    deps.logger?.warn(WIKI_LOG.ingest.write.failed, { path: WIKI_LOG_PATH, error: errMsg(err) });
  }

  return { pagesCreated, pagesEdited, sourcesWritten, indexRegenerated, logAppended, errors };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function pagePathFromSlug(slug: string): string {
  return `${WIKI_PAGES_DIR}/${slug}.md`;
}

function sourcePathFromRaw(rawPath: string): string {
  const base = rawPath.split('/').pop() ?? rawPath;
  const stem = base.replace(/\.md$/i, '');
  return `${WIKI_SOURCES_DIR}/${stem}.md`;
}

function renderPage(out: ReducerOutput): string {
  const lines: string[] = [];
  lines.push('---');
  const fm = out.frontmatter as Record<string, unknown>;
  for (const key of Object.keys(fm).sort((a, b) => a.localeCompare(b))) {
    lines.push(`${key}: ${renderYamlValue(fm[key])}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(sanitizeBody(out.body).trimEnd());
  if (out.sources.length > 0) {
    lines.push('');
    lines.push('## Sources');
    lines.push('');
    const seen = new Set<string>();
    for (const raw of [...out.sources].sort((a, b) => a.localeCompare(b))) {
      const target = stripWikilinkWrap(raw);
      if (target.length === 0 || seen.has(target)) continue;
      seen.add(target);
      lines.push(`- [[${target}]]`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function stripWikilinkWrap(s: string): string {
  let trimmed = s.trim();
  while (trimmed.startsWith('[[') && trimmed.endsWith(']]')) {
    trimmed = trimmed.slice(2, -2).trim();
  }
  return trimmed;
}

function sanitizeBody(body: string): string {
  let text = body;
  const lines = text.split(/\r?\n/);
  let cursor = 0;
  while (cursor < lines.length && (lines[cursor] ?? '').trim() === '') cursor += 1;
  if ((lines[cursor] ?? '').trim() === '---') {
    let end = cursor + 1;
    while (end < lines.length && (lines[end] ?? '').trim() !== '---') end += 1;
    if (end < lines.length) {
      text = lines
        .slice(end + 1)
        .join('\n')
        .replace(/^\s*\n+/, '');
    }
  }
  text = text.replace(/\n#{1,6}\s+Sources\s*\n[\s\S]*$/i, '\n'); // NOSONAR(typescript:S5852): anchored to `$`, bounded `#{1,6}`, single greedy tail; linear.
  return text;
}

function renderSource(s: PersistedRawSummary): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`source_url: ${renderYamlValue(s.sourceRef.startsWith('http') ? s.sourceRef : null)}`);
  lines.push(`fetched_at: ${s.fetchedAt}`);
  lines.push(`sha256: ${s.sha256}`);
  lines.push(`raw_path: ${s.rawPath}`);
  lines.push('---');
  lines.push('');
  if (s.summary.length > 0) {
    lines.push(s.summary.trim());
    lines.push('');
  }
  if (s.bullets.length > 0) {
    for (const b of s.bullets) lines.push(`- ${b}`);
    lines.push('');
  }
  lines.push(`See raw entry: [[${s.rawPath.replace(/\.md$/i, '')}]]`);
  lines.push('');
  return lines.join('\n');
}

function renderYamlValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => renderYamlScalar(v)).join(', ')}]`;
  return renderYamlScalar(value);
}

function renderYamlScalar(value: unknown): string {
  const s = String(value);
  if (/[:#\n"'\\[\]]/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

interface LogLineInput {
  readonly ts: string;
  readonly runId: string;
  readonly title: string;
  readonly pagesCreated: number;
  readonly pagesEdited: number;
  readonly sourcesWritten: number;
  readonly cancelledMidWrite: boolean;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

function renderLogLine(input: LogLineInput): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(input.ts)?.[0] ?? input.ts.slice(0, 10);
  const stats = `created=${input.pagesCreated} edited=${input.pagesEdited} sources=${input.sourcesWritten}`;
  if (input.errorCode !== undefined) {
    return `## [${date}] ingest | ${input.title} | error | ${input.errorCode}: ${input.errorMessage ?? ''} | runId=${input.runId}`;
  }
  if (input.cancelledMidWrite) {
    return `## [${date}] ingest | ${input.title} | cancelled-mid-write | runId=${input.runId}`;
  }
  return `## [${date}] ingest | ${input.title} | ${stats} | runId=${input.runId}`;
}

function renderLogTitle(summaries: readonly PersistedRawSummary[]): string {
  if (summaries.length === 0) return '(no sources)';
  if (summaries.length === 1) {
    const s = summaries[0]!;
    if (s.summary.length > 0) {
      const firstLine = s.summary.split(/\r?\n/, 1)[0]?.trim() ?? '';
      if (firstLine.length > 0) return firstLine.slice(0, 80);
    }
    const base = s.rawPath.split('/').pop() ?? s.rawPath;
    const stem = base.replace(/\.md$/i, '').replace(/^\d{8}-/, '');
    return stem.replace(/[-_]/g, ' ').slice(0, 80) || base;
  }
  return `${summaries.length} sources`;
}

interface PageIndexEntry {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly tags: readonly string[];
}

export async function regenerateIndex(vault: VaultAdapter): Promise<string> {
  if (!(await vault.exists(WIKI_PAGES_DIR))) return defaultEmptyIndex();
  let listing;
  try {
    listing = await vault.list(WIKI_PAGES_DIR);
  } catch {
    return defaultEmptyIndex();
  }
  const pages: PageIndexEntry[] = [];
  for (const path of listing.files) {
    if (!path.endsWith('.md')) continue;
    let body: string;
    try {
      body = await vault.read(path);
    } catch {
      continue;
    }
    const fm = parseFrontmatter(body);
    const slug = path.replace(`${WIKI_PAGES_DIR}/`, '').replace(/\.md$/i, '');
    const title = extractTitle(body) ?? slug.replace(/-/g, ' ');
    const summary = firstBodyLine(body);
    const tags = parseTagsField(fm['tags']);
    pages.push({ slug, title, summary, tags });
  }
  pages.sort((a, b) => a.slug.localeCompare(b.slug));

  const byCategory = new Map<string, PageIndexEntry[]>();
  for (const p of pages) {
    const cats = p.tags.length > 0 ? p.tags : ['Untagged'];
    for (const c of cats) {
      const list = byCategory.get(c);
      if (list === undefined) byCategory.set(c, [p]);
      else list.push(p);
    }
  }
  const categories = [...byCategory.keys()].sort((a, b) => a.localeCompare(b));

  const lines: string[] = ['# Wiki index', ''];
  for (const c of categories) {
    lines.push(`## ${c}`, '');
    for (const p of byCategory.get(c)!) {
      const summary = p.summary.length > 0 ? ` — ${p.summary}` : '';
      lines.push(`- [[pages/${p.slug}]]${summary}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function defaultEmptyIndex(): string {
  return '# Wiki index\n\n_Empty._\n';
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

function parseTagsField(value: string | undefined): string[] {
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

function firstBodyLine(body: string): string {
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const trimmed = (lines[i] ?? '').trim();
    if (trimmed === '') {
      i += 1;
      continue;
    }
    if (trimmed === '---') {
      i += 1;
      while (i < lines.length && (lines[i] ?? '').trim() !== '---') i += 1;
      if (i < lines.length) i += 1;
      continue;
    }
    if (trimmed.startsWith('#')) {
      i += 1;
      continue;
    }
    return trimmed.slice(0, 120);
  }
  return '';
}

export interface WriteSourceSummaryDeps {
  readonly vault: VaultAdapter;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

export type WriteSourceSummaryResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string };

export async function writeSourceSummaryFromPatch(
  rawPath: string,
  patch: LintFindingPatch,
  deps: WriteSourceSummaryDeps,
): Promise<WriteSourceSummaryResult> {
  if (patch.kind !== 'create-source-summary') {
    return { ok: false, message: `unsupported patch kind: ${patch.kind}` };
  }
  if (patch.rawPath !== rawPath && patch.rawPath.length > 0) {
    rawPath = patch.rawPath;
  }
  const path = sourcePathFromRaw(rawPath);
  const fetchedAt = (deps.now ?? ((): Date => new Date()))().toISOString();
  const lines: string[] = [];
  lines.push('---');
  lines.push(`source_url: null`);
  lines.push(`fetched_at: ${fetchedAt}`);
  lines.push(`sha256: ""`);
  lines.push(`raw_path: ${rawPath}`);
  lines.push('---');
  lines.push('');
  lines.push(patch.body.trim());
  lines.push('');
  lines.push(`See raw entry: [[${rawPath.replace(/\.md$/i, '')}]]`);
  lines.push('');
  try {
    await deps.vault.mkdir(WIKI_SOURCES_DIR);
    await deps.vault.write(path, lines.join('\n'));
    deps.logger?.debug(WIKI_LOG.lint.write.ok, { path });
    return { ok: true, path };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.warn(WIKI_LOG.lint.write.failed, { path, error: message });
    return { ok: false, message };
  }
}

export interface AppendLintLogLineInput {
  readonly runId: string;
  readonly applied: number;
  readonly failed: number;
  readonly pagesEdited: number;
  readonly cancelled?: boolean;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly logTimestamp?: string;
}

export interface AppendLogLineDeps {
  readonly vault: VaultAdapter;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

export async function appendLintLogLine(
  input: AppendLintLogLineInput,
  deps: AppendLogLineDeps,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  try {
    const ts = input.logTimestamp ?? (deps.now ?? ((): Date => new Date()))().toISOString();
    const date = /^\d{4}-\d{2}-\d{2}/.exec(ts)?.[0] ?? ts.slice(0, 10);
    let line: string;
    if (input.errorCode !== undefined) {
      line = `## [${date}] lint | error | ${input.errorCode}: ${input.errorMessage ?? ''} | runId=${input.runId}`;
    } else if (input.cancelled === true) {
      line = `## [${date}] lint | cancelled | applied=${input.applied} failed=${input.failed} edited=${input.pagesEdited} | runId=${input.runId}`;
    } else {
      line = `## [${date}] lint | applied=${input.applied} failed=${input.failed} edited=${input.pagesEdited} | runId=${input.runId}`;
    }
    const existing = (await deps.vault.exists(WIKI_LOG_PATH))
      ? await deps.vault.read(WIKI_LOG_PATH)
      : '# Wiki log\n\n';
    const next = existing.endsWith('\n') ? `${existing}${line}\n` : `${existing}\n${line}\n`;
    await deps.vault.write(WIKI_LOG_PATH, next);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.warn(WIKI_LOG.lint.write.failed, { path: WIKI_LOG_PATH, error: message });
    return { ok: false, message };
  }
}
