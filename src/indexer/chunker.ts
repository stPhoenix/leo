// Heading-aware Obsidian Markdown splitter. LangChain `RecursiveCharacterTextSplitter`
// covers fixed-size windowing but cannot preserve the heading-path metadata (`#H1 / ##H2`)
// that RAG citations and graph-boost scoring depend on. Heading parse uses
// `MetadataCache.getFileCache(file).headings` so chunks stay in lock-step with Obsidian.
import { estimateTokens } from '@/agent/tokenCount';

export const CHUNK_TARGET_TOKENS = 512 as const;
export const CHUNK_OVERLAP_TOKENS = 64 as const;

export interface PositionLike {
  readonly start: { readonly line: number };
  readonly end: { readonly line: number };
}

export interface HeadingCacheLike {
  readonly heading: string;
  readonly level: number;
  readonly position: PositionLike;
}

export interface TagCacheLike {
  readonly tag: string;
  readonly position: PositionLike;
}

export interface FrontmatterPositionLike {
  readonly start: { readonly line: number };
  readonly end: { readonly line: number };
}

export interface CachedMetadataLike {
  readonly headings?: readonly HeadingCacheLike[];
  readonly frontmatter?: Readonly<Record<string, unknown>>;
  readonly frontmatterPosition?: FrontmatterPositionLike;
  readonly tags?: readonly TagCacheLike[];
}

export interface Chunk {
  readonly path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly heading_path: readonly string[];
  readonly frontmatter_tags: readonly string[];
  readonly inline_tags: readonly string[];
  readonly text: string;
}

export interface ChunkerInput {
  readonly path: string;
  readonly source: string;
  readonly fileCache: CachedMetadataLike;
}

export function chunk(input: ChunkerInput): readonly Chunk[] {
  if (input.source.length === 0) return [];
  const lines = input.source.split('\n');
  const frontmatterTags = normalizeFrontmatterTags(input.fileCache.frontmatter);
  const frontmatterEnd = input.fileCache.frontmatterPosition?.end.line ?? -1;
  const headings = input.fileCache.headings ?? [];
  const sections = computeSections(headings, lines.length);
  if (sections.length === 0) {
    return emitSection({
      path: input.path,
      lines,
      startLine: 0,
      endLine: lines.length - 1,
      headingPath: [],
      frontmatterTags,
      fileTags: input.fileCache.tags ?? [],
      frontmatterEnd,
    });
  }
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const sectionChunks = emitSection({
      path: input.path,
      lines,
      startLine: section.startLine,
      endLine: section.endLine,
      headingPath: section.headingPath,
      frontmatterTags,
      fileTags: input.fileCache.tags ?? [],
      frontmatterEnd,
    });
    for (const c of sectionChunks) chunks.push(c);
  }
  return chunks;
}

interface Section {
  readonly startLine: number;
  readonly endLine: number;
  readonly headingPath: readonly string[];
}

function computeSections(headings: readonly HeadingCacheLike[], totalLines: number): Section[] {
  if (headings.length === 0) return [];
  const stack: HeadingCacheLike[] = [];
  const sections: Section[] = [];
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i]!;
    while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) stack.pop();
    stack.push(h);
    const startLine = h.position.start.line;
    let endLine = totalLines - 1;
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j]!.level <= h.level) {
        endLine = headings[j]!.position.start.line - 1;
        break;
      }
    }
    sections.push({
      startLine,
      endLine,
      headingPath: stack.map((e) => e.heading.trim()),
    });
  }
  return sections;
}

interface SectionInputs {
  readonly path: string;
  readonly lines: readonly string[];
  readonly startLine: number;
  readonly endLine: number;
  readonly headingPath: readonly string[];
  readonly frontmatterTags: readonly string[];
  readonly fileTags: readonly TagCacheLike[];
  readonly frontmatterEnd: number;
}

function emitSection(s: SectionInputs): Chunk[] {
  if (s.startLine > s.endLine) return [];
  const sectionText = s.lines.slice(s.startLine, s.endLine + 1).join('\n');
  const tokens = estimateTokens(sectionText);
  if (tokens <= CHUNK_TARGET_TOKENS) {
    return [buildChunk(s, s.startLine, s.endLine)];
  }
  const windows = slideWindows(s.lines, s.startLine, s.endLine);
  return windows.map((w) => buildChunk(s, w.startLine, w.endLine));
}

function slideWindows(
  lines: readonly string[],
  startLine: number,
  endLine: number,
): ReadonlyArray<{ readonly startLine: number; readonly endLine: number }> {
  const out: Array<{ startLine: number; endLine: number }> = [];
  let i = startLine;
  while (i <= endLine) {
    let j = i;
    let tokens = 0;
    while (j <= endLine) {
      const t = estimateTokens(lines[j]!) + 1;
      if (tokens + t > CHUNK_TARGET_TOKENS && j > i) break;
      tokens += t;
      j += 1;
    }
    const windowEnd = Math.min(j - 1, endLine);
    out.push({ startLine: i, endLine: windowEnd });
    if (windowEnd >= endLine) break;
    let ovTokens = 0;
    let ov = windowEnd;
    while (ov > i && ovTokens < CHUNK_OVERLAP_TOKENS) {
      ovTokens += estimateTokens(lines[ov]!) + 1;
      ov -= 1;
    }
    const nextStart = ov + 1;
    i = nextStart > i ? nextStart : i + 1;
  }
  return out;
}

function buildChunk(s: SectionInputs, startLine: number, endLine: number): Chunk {
  const text = s.lines.slice(startLine, endLine + 1).join('\n');
  const inlineTags = scopedInlineTags(s.fileTags, startLine, endLine, s.frontmatterEnd);
  return {
    path: s.path,
    line_start: startLine,
    line_end: endLine,
    heading_path: s.headingPath,
    frontmatter_tags: s.frontmatterTags,
    inline_tags: inlineTags,
    text,
  };
}

function scopedInlineTags(
  fileTags: readonly TagCacheLike[],
  startLine: number,
  endLine: number,
  frontmatterEnd: number,
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of fileTags) {
    const start = t.position.start.line;
    const end = t.position.end.line;
    if (frontmatterEnd >= 0 && start <= frontmatterEnd) continue;
    if (end < startLine || start > endLine) continue;
    const normalized = t.tag.trim().replace(/^#+/, '').trim();
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeFrontmatterTags(
  fm: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  if (fm === undefined) return [];
  const raw = fm.tags !== undefined ? fm.tags : fm.tag;
  if (raw === undefined || raw === null) return [];
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim().replace(/^#+/, '').trim();
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

const INLINE_TAG_RE = /(?<![\p{L}\p{N}_/])#([\p{L}\p{N}_\-/]+)/gu;

export function extractInlineTagsFromText(body: string): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  INLINE_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_TAG_RE.exec(body)) !== null) {
    const raw = match[1];
    if (raw === undefined) continue;
    const normalized = raw.trim();
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
