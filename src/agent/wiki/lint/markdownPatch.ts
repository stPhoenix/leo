import type { LintFindingPatch } from './schemas';

export type ApplyMarkdownPatchFailReason =
  | 'section_not_found'
  | 'unsupported_kind'
  | 'invalid_input'
  | 'body_size_drift';

export interface ApplyMarkdownPatchInput {
  readonly currentBody: string;
  readonly patch: LintFindingPatch;
}

export type ApplyMarkdownPatchResult =
  | { readonly ok: true; readonly nextBody: string; readonly changed: boolean }
  | { readonly ok: false; readonly reason: ApplyMarkdownPatchFailReason; readonly message: string };

export interface SplitFrontmatterResult {
  readonly frontmatter: string;
  readonly rest: string;
}

export interface StripSourcesSectionResult {
  readonly content: string;
  readonly sourcesBlock: string;
}

export interface SectionRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly level: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/; // NOSONAR(typescript:S5852): anchored heading, bounded `#{1,6}`, lazy capture, linear per line.
const SOURCES_RE = /^(#{1,6})\s+sources\s*$/i;
const REPLACE_BODY_DRIFT_THRESHOLD = 0.5;

export function splitFrontmatter(body: string): SplitFrontmatterResult {
  if (!body.startsWith('---')) return { frontmatter: '', rest: body };
  const lines = body.split('\n');
  if (lines[0] !== '---' && lines[0]?.trim() !== '---') {
    return { frontmatter: '', rest: body };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { frontmatter: '', rest: body };
  const frontmatter = `${lines.slice(0, end + 1).join('\n')}\n`;
  const rest = lines.slice(end + 1).join('\n');
  const restTrimmedLeading = rest.replace(/^\n+/, '');
  return { frontmatter, rest: restTrimmedLeading };
}

export function stripSourcesSection(rest: string): StripSourcesSectionResult {
  const lines = rest.split('\n');
  let startIdx = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = SOURCES_RE.exec(lines[i] ?? '');
    if (m !== null) {
      startIdx = i;
      level = m[1]!.length;
      break;
    }
  }
  if (startIdx === -1) return { content: rest, sourcesBlock: '' };
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const m = HEADING_RE.exec(lines[i] ?? '');
    if (m !== null && m[1]!.length <= level) {
      endIdx = i;
      break;
    }
  }
  const before = lines.slice(0, startIdx).join('\n');
  const sourcesBlock = lines.slice(startIdx, endIdx).join('\n');
  const after = lines.slice(endIdx).join('\n');
  const content = after.length > 0 ? `${before}\n${after}` : before;
  return { content: stripTrailingBlankLines(content), sourcesBlock };
}

export function findSection(content: string, sectionTitle: string): SectionRange | null {
  const target = normaliseHeading(sectionTitle);
  const lines = content.split('\n');
  let startLine = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = HEADING_RE.exec(lines[i] ?? '');
    if (m === null) continue;
    if (normaliseHeading(m[2] ?? '') === target) {
      startLine = i;
      level = m[1]!.length;
      break;
    }
  }
  if (startLine === -1) return null;
  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i += 1) {
    const m = HEADING_RE.exec(lines[i] ?? '');
    if (m !== null && m[1]!.length <= level) {
      endLine = i;
      break;
    }
  }
  return { startLine, endLine, level };
}

export function applyMarkdownPatch(input: ApplyMarkdownPatchInput): ApplyMarkdownPatchResult {
  const { currentBody, patch } = input;
  if (typeof currentBody !== 'string') {
    return { ok: false, reason: 'invalid_input', message: 'currentBody must be a string' };
  }
  const { frontmatter, rest } = splitFrontmatter(currentBody);
  const { content, sourcesBlock } = stripSourcesSection(rest);

  switch (patch.kind) {
    case 'replace_body':
      return patchReplaceBody(currentBody, patch, frontmatter, sourcesBlock);
    case 'replace_section':
      return patchReplaceSection(currentBody, patch, frontmatter, content, sourcesBlock);
    case 'append':
      return patchAppend(currentBody, patch, frontmatter, content, sourcesBlock);
    case 'delete':
      return patchDelete(currentBody, patch, frontmatter, content, sourcesBlock);
    case 'create-source-summary':
      return {
        ok: false,
        reason: 'unsupported_kind',
        message: 'create-source-summary targets wiki/sources/, not a page body',
      };
    default: {
      const exhaustive: never = patch;
      return {
        ok: false,
        reason: 'unsupported_kind',
        message: `unknown patch kind: ${JSON.stringify(exhaustive)}`,
      };
    }
  }
}

function patchReplaceBody(
  currentBody: string,
  patch: Extract<ApplyMarkdownPatchInput['patch'], { kind: 'replace_body' }>,
  frontmatter: string,
  sourcesBlock: string,
): ApplyMarkdownPatchResult {
  const driftRatio =
    Math.abs(currentBody.length - patch.body.length) / Math.max(currentBody.length, 1);
  if (driftRatio > REPLACE_BODY_DRIFT_THRESHOLD) {
    return {
      ok: false,
      reason: 'body_size_drift',
      message: `replace_body delta ${(driftRatio * 100).toFixed(0)}% exceeds 50% guardrail`,
    };
  }
  const cleaned = stripStrayShell(patch.body);
  const next = recompose(frontmatter, cleaned, sourcesBlock);
  return { ok: true, nextBody: next, changed: next !== currentBody };
}

function patchReplaceSection(
  currentBody: string,
  patch: Extract<ApplyMarkdownPatchInput['patch'], { kind: 'replace_section' }>,
  frontmatter: string,
  content: string,
  sourcesBlock: string,
): ApplyMarkdownPatchResult {
  const range = findSection(content, patch.section);
  if (range === null) {
    return {
      ok: false,
      reason: 'section_not_found',
      message: `section not found: ${patch.section}`,
    };
  }
  const lines = content.split('\n');
  const heading = `${'#'.repeat(range.level)} ${patch.section.trim()}`;
  const replacement = patch.body.trimEnd();
  const before = lines.slice(0, range.startLine);
  const after = lines.slice(range.endLine);
  const merged = [
    ...before,
    heading,
    '',
    replacement,
    ...(after.length > 0 ? [''] : []),
    ...after,
  ].join('\n');
  const newContent = stripTrailingBlankLines(merged);
  const next = recompose(frontmatter, newContent, sourcesBlock);
  return { ok: true, nextBody: next, changed: next !== currentBody };
}

function patchAppend(
  currentBody: string,
  patch: Extract<ApplyMarkdownPatchInput['patch'], { kind: 'append' }>,
  frontmatter: string,
  content: string,
  sourcesBlock: string,
): ApplyMarkdownPatchResult {
  const sectionName = patch.section ?? null;
  if (sectionName === null) {
    const trimmed = stripTrailingBlankLines(content);
    const sep = trimmed.length > 0 ? '\n\n' : '';
    const newContent = `${trimmed}${sep}${patch.body.trimEnd()}`;
    const next = recompose(frontmatter, newContent, sourcesBlock);
    return { ok: true, nextBody: next, changed: next !== currentBody };
  }
  const range = findSection(content, sectionName);
  if (range === null) {
    return {
      ok: false,
      reason: 'section_not_found',
      message: `section not found: ${sectionName}`,
    };
  }
  const lines = content.split('\n');
  const sectionLines = lines.slice(range.startLine, range.endLine);
  const trimmedSection = stripTrailingBlankLines(sectionLines.join('\n'));
  const newSection = `${trimmedSection}\n\n${patch.body.trimEnd()}`;
  const before = lines.slice(0, range.startLine).join('\n');
  const after = lines.slice(range.endLine).join('\n');
  const newContent = stripTrailingBlankLines(
    [before, newSection, after].filter((s) => s.length > 0).join('\n'),
  );
  const next = recompose(frontmatter, newContent, sourcesBlock);
  return { ok: true, nextBody: next, changed: next !== currentBody };
}

function patchDelete(
  currentBody: string,
  patch: Extract<ApplyMarkdownPatchInput['patch'], { kind: 'delete' }>,
  frontmatter: string,
  content: string,
  sourcesBlock: string,
): ApplyMarkdownPatchResult {
  const sectionName = patch.section ?? null;
  if (sectionName === null) {
    return {
      ok: false,
      reason: 'unsupported_kind',
      message: 'delete requires a section name; whole-body delete is forbidden',
    };
  }
  const range = findSection(content, sectionName);
  if (range === null) {
    return {
      ok: false,
      reason: 'section_not_found',
      message: `section not found: ${sectionName}`,
    };
  }
  const lines = content.split('\n');
  const before = lines.slice(0, range.startLine).join('\n');
  const after = lines.slice(range.endLine).join('\n');
  const newContent = stripTrailingBlankLines(
    [before, after].filter((s) => s.length > 0).join('\n'),
  );
  const next = recompose(frontmatter, newContent, sourcesBlock);
  return { ok: true, nextBody: next, changed: next !== currentBody };
}

function recompose(frontmatter: string, content: string, sourcesBlock: string): string {
  const trimmedContent = stripTrailingBlankLines(content);
  const sources = sourcesBlock.length > 0 ? `\n\n${sourcesBlock}\n` : '';
  const tail = sources.length > 0 ? sources : '\n';
  return `${frontmatter}${trimmedContent}${tail}`;
}

function stripTrailingBlankLines(s: string): string {
  return s.replace(/\n+$/, ''); // NOSONAR(typescript:S5852): anchored trailing-newline trim, linear.
}

function stripStrayShell(body: string): string {
  const { rest } = splitFrontmatter(body);
  const { content } = stripSourcesSection(rest);
  return content;
}

function normaliseHeading(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}
