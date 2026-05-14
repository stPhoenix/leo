import { estimateTokens } from '@/agent/tokenCount';

export interface CanvasChunk {
  readonly index: number;
  readonly text: string;
  readonly headingPath: readonly string[];
}

export interface ChunkCanvasBodyInput {
  readonly body: string;
  readonly contentType?: string;
  readonly targetTokens: number;
  readonly overlapTokens: number;
  readonly maxChunks: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/; // NOSONAR(typescript:S5852): bounded `#{1,6}` + greedy `.+` to end-of-line, linear in line length.
const MARKDOWN_CONTENT_TYPE_RE = /^text\/markdown\b/i;
const HAS_HEADING_RE = /^#{1,6} /m;

/**
 * Split a fetched canvas source body into token-budgeted chunks for per-chunk
 * extraction. Generic — no Obsidian metadataCache dependency, so URL,
 * attachment, and conversation sources are handled identically to vault notes.
 *
 * Markdown sources (by `contentType` or by detecting any `^#{1,6} ` line)
 * split on ATX headings; sections exceeding `targetTokens` sub-split with a
 * line-granular sliding window using `overlapTokens` overlap. Non-markdown
 * sources fall through to fixed-window splitting only and emit empty
 * `headingPath`.
 */
export function chunkCanvasBody(input: ChunkCanvasBodyInput): readonly CanvasChunk[] {
  const { body, contentType, targetTokens, overlapTokens, maxChunks } = input;
  if (targetTokens < 1) throw new Error('targetTokens must be >= 1');
  if (maxChunks < 1) return [];
  if (body.length === 0 || body.trim().length === 0) return [];

  if (estimateTokens(body) <= targetTokens) {
    return [{ index: 0, text: body, headingPath: [] }];
  }

  const lines = body.split('\n');
  const sections = splitSections(lines, body, contentType);

  const chunks: CanvasChunk[] = [];
  for (const section of sections) {
    if (section.startLine > section.endLine) continue;
    const reached = appendSectionChunks(
      chunks,
      lines,
      section,
      targetTokens,
      overlapTokens,
      maxChunks,
    );
    if (reached) return chunks;
  }

  return chunks;
}

function splitSections(
  lines: readonly string[],
  body: string,
  contentType: string | undefined,
): readonly SectionRange[] {
  const isMarkdown =
    (contentType !== undefined && MARKDOWN_CONTENT_TYPE_RE.test(contentType)) ||
    HAS_HEADING_RE.test(body);
  return isMarkdown
    ? splitByHeadings(lines)
    : [{ headingPath: [], startLine: 0, endLine: lines.length - 1 }];
}

function appendSectionChunks(
  chunks: CanvasChunk[],
  lines: readonly string[],
  section: SectionRange,
  targetTokens: number,
  overlapTokens: number,
  maxChunks: number,
): boolean {
  const sectionText = lines.slice(section.startLine, section.endLine + 1).join('\n');
  if (sectionText.trim().length === 0) return false;

  if (estimateTokens(sectionText) <= targetTokens) {
    chunks.push({ index: chunks.length, text: sectionText, headingPath: section.headingPath });
    return chunks.length >= maxChunks;
  }

  const windows = slideWindows(
    lines,
    section.startLine,
    section.endLine,
    targetTokens,
    overlapTokens,
  );
  for (const w of windows) {
    const text = lines.slice(w.startLine, w.endLine + 1).join('\n');
    chunks.push({ index: chunks.length, text, headingPath: section.headingPath });
    if (chunks.length >= maxChunks) return true;
  }
  return false;
}

interface SectionRange {
  readonly headingPath: readonly string[];
  readonly startLine: number;
  readonly endLine: number;
}

function splitByHeadings(lines: readonly string[]): readonly SectionRange[] {
  const out: SectionRange[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let sectionStart = 0;
  let pathSnapshot: readonly string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = HEADING_RE.exec(lines[i]!);
    if (m === null) continue;
    if (i > sectionStart) {
      out.push({ headingPath: pathSnapshot, startLine: sectionStart, endLine: i - 1 });
    }
    const level = m[1]!.length;
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
    stack.push({ level, title: m[2]!.trim() });
    pathSnapshot = stack.map((s) => s.title);
    sectionStart = i;
  }
  if (sectionStart <= lines.length - 1) {
    out.push({ headingPath: pathSnapshot, startLine: sectionStart, endLine: lines.length - 1 });
  }
  return out;
}

function slideWindows(
  lines: readonly string[],
  startLine: number,
  endLine: number,
  targetTokens: number,
  overlapTokens: number,
): ReadonlyArray<{ readonly startLine: number; readonly endLine: number }> {
  const out: Array<{ startLine: number; endLine: number }> = [];
  let i = startLine;
  while (i <= endLine) {
    let j = i;
    let tokens = 0;
    while (j <= endLine) {
      const t = estimateTokens(lines[j]!) + 1;
      if (tokens + t > targetTokens && j > i) break;
      tokens += t;
      j += 1;
    }
    const windowEnd = Math.min(j - 1, endLine);
    out.push({ startLine: i, endLine: windowEnd });
    if (windowEnd >= endLine) break;
    let ovTokens = 0;
    let ov = windowEnd;
    while (ov > i && ovTokens < overlapTokens) {
      ovTokens += estimateTokens(lines[ov]!) + 1;
      ov -= 1;
    }
    const nextStart = ov + 1;
    i = nextStart > i ? nextStart : i + 1;
  }
  return out;
}
