import { z } from 'zod';
import { minimatch } from 'minimatch';
import type { ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { isSafeVaultPath } from './readNote';
import { byteLength, looksBinary } from './readFileShared';

export type GrepOutputMode = 'content' | 'files_with_matches' | 'count';

export interface GrepVaultArgs {
  readonly pattern: string;
  readonly path?: string;
  readonly glob?: string;
  readonly output_mode?: GrepOutputMode;
  readonly '-A'?: number;
  readonly '-B'?: number;
  readonly '-C'?: number;
  readonly context?: number;
  readonly '-n'?: boolean;
  readonly '-i'?: boolean;
  readonly head_limit?: number;
  readonly offset?: number;
  readonly multiline?: boolean;
}

export interface GrepVaultResult {
  readonly mode: GrepOutputMode;
  readonly numFiles: number;
  readonly filenames: readonly string[];
  readonly content?: string;
  readonly numLines?: number;
  readonly numMatches?: number;
  readonly appliedLimit?: number;
  readonly appliedOffset?: number;
  readonly truncated?: boolean;
  readonly durationMs: number;
}

const DEFAULT_HEAD_LIMIT = 250;
const MAX_FILES_SCANNED = 5000;
const MAX_BYTES_SCANNED = 200 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

const GrepVaultSchema = z
  .object({
    pattern: z.string().min(1).describe('Regex pattern (JS regex syntax).'),
    path: z
      .string()
      .optional()
      .refine(
        (p) => p === undefined || p === '' || isSafeVaultPath(p),
        'path must be vault-relative and must not traverse parents',
      )
      .describe('Vault-relative folder to search under. Empty/omitted = vault root.'),
    glob: z
      .string()
      .optional()
      .describe('Optional file-name glob filter. Comma- or space-separated patterns allowed.'),
    output_mode: z
      .enum(['content', 'files_with_matches', 'count'])
      .optional()
      .describe('Output mode. Default "files_with_matches".'),
    '-A': z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Lines after each match (content mode only).'),
    '-B': z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Lines before each match (content mode only).'),
    '-C': z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Lines before AND after each match (overrides -A/-B).'),
    context: z.number().int().min(0).optional().describe('Alias for -C (lines before AND after).'),
    '-n': z.boolean().optional().describe('Show line numbers in content mode. Default true.'),
    '-i': z.boolean().optional().describe('Case-insensitive match.'),
    head_limit: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(`Limit results. 0 = unlimited; default ${DEFAULT_HEAD_LIMIT}.`),
    offset: z.number().int().min(0).optional().describe('Skip N results before head_limit.'),
    multiline: z
      .boolean()
      .optional()
      .describe('Enable cross-line matching (regex flags: s, m). Default false.'),
  })
  .strict();

function hasHiddenSegment(p: string): boolean {
  if (p.length === 0) return false;
  for (const seg of p.split('/')) {
    if (seg.startsWith('.')) return true;
  }
  return false;
}

function splitGlobPatterns(raw: string): readonly string[] {
  const result: string[] = [];
  for (const part of raw.split(/\s+/)) {
    if (part.length === 0) continue;
    if (part.includes('{') && part.includes('}')) {
      result.push(part);
    } else {
      for (const sub of part.split(',')) if (sub.length > 0) result.push(sub);
    }
  }
  return result;
}

function applyHeadLimit<T>(
  items: readonly T[],
  limit: number | undefined,
  offset: number,
): { items: T[]; appliedLimit: number | undefined } {
  if (limit === 0) return { items: items.slice(offset), appliedLimit: undefined };
  const eff = limit ?? DEFAULT_HEAD_LIMIT;
  const sliced = items.slice(offset, offset + eff);
  const truncated = items.length - offset > eff;
  return { items: sliced, appliedLimit: truncated ? eff : undefined };
}

interface ContentMatch {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export function createGrepVaultTool(): ToolSpec<GrepVaultArgs, GrepVaultResult> {
  return {
    id: 'grep_vault',
    description:
      'Pure-JS regex search over vault files. Supports `output_mode: content | files_with_matches | count`, context (-A/-B/-C), case-insensitive (-i), multiline, head_limit + offset pagination, and a glob file filter. Honors the user exclude-list. Files >2MB and binaries are skipped.',
    schema: GrepVaultSchema as unknown as z.ZodType<GrepVaultArgs>,
    parameters: jsonSchemaFromZod(GrepVaultSchema),
    requiresConfirmation: false,
    isReadOnly: true,
    source: 'builtin',
    validate: validateFromZod(GrepVaultSchema as unknown as z.ZodType<GrepVaultArgs>),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      const start = now();
      const root = args.path ?? '';
      const mode: GrepOutputMode = args.output_mode ?? 'files_with_matches';
      const showLineNumbers = args['-n'] !== false; // default true
      const offset = args.offset ?? 0;
      const headLimit = args.head_limit;
      const contextC = args.context ?? args['-C'];
      const contextBefore = contextC ?? args['-B'] ?? 0;
      const contextAfter = contextC ?? args['-A'] ?? 0;
      let flags = 'g';
      if (args['-i'] === true) flags += 'i';
      if (args.multiline === true) flags += 'sm';
      let regex: RegExp;
      try {
        regex = new RegExp(args.pattern, flags);
      } catch (err) {
        return {
          ok: false,
          error: `invalid regex: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      try {
        if (root.length > 0 && !(await ctx.vault.exists(root))) {
          return { ok: false, error: `path not found: ${root}` };
        }
        const globPatterns = args.glob !== undefined ? splitGlobPatterns(args.glob) : null;
        const candidates = await collectCandidates(ctx, root, globPatterns);
        if (candidates === 'aborted') return { ok: false, error: 'aborted' };
        let bytesScanned = 0;
        let filesScanned = 0;
        const contentMatches: ContentMatch[] = [];
        const fileMatchSet = new Set<string>();
        const countByFile = new Map<string, number>();
        for (const file of candidates) {
          if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
          if (filesScanned >= MAX_FILES_SCANNED) break;
          if (bytesScanned >= MAX_BYTES_SCANNED) break;
          const stat = await ctx.vault.stat(file);
          if (stat !== null && stat.size > MAX_FILE_SIZE_BYTES) continue;
          let raw: string;
          try {
            raw = await ctx.vault.read(file);
          } catch {
            continue;
          }
          if (looksBinary(raw)) continue;
          filesScanned += 1;
          bytesScanned += byteLength(raw);
          if (args.multiline === true) {
            regex.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = regex.exec(raw)) !== null) {
              const lineNum = countLinesUpTo(raw, m.index) + 1;
              const lineText = lineAt(raw, m.index);
              if (mode === 'files_with_matches') {
                fileMatchSet.add(file);
                break;
              } else if (mode === 'count') {
                countByFile.set(file, (countByFile.get(file) ?? 0) + 1);
              } else {
                contentMatches.push({ file, line: lineNum, text: lineText });
                if (contentMatches.length >= MAX_FILES_SCANNED * 100) break;
              }
              if (m.index === regex.lastIndex) regex.lastIndex += 1;
            }
          } else {
            const lines = raw.split('\n');
            for (let i = 0; i < lines.length; i += 1) {
              regex.lastIndex = 0;
              if (!regex.test(lines[i] ?? '')) continue;
              if (mode === 'files_with_matches') {
                fileMatchSet.add(file);
                break;
              } else if (mode === 'count') {
                countByFile.set(file, (countByFile.get(file) ?? 0) + 1);
              } else {
                contentMatches.push({ file, line: i + 1, text: lines[i] ?? '' });
              }
            }
          }
        }
        const durationMs = Math.round(now() - start);
        if (mode === 'files_with_matches') {
          const matched = [...fileMatchSet];
          const stats = await Promise.allSettled(matched.map((p) => ctx.vault.stat(p)));
          const decorated = matched.map((p, i) => {
            const r = stats[i];
            const mtime = r?.status === 'fulfilled' && r.value !== null ? r.value.mtimeMs : 0;
            return { path: p, mtime };
          });
          decorated.sort((a, b) => {
            if (b.mtime !== a.mtime) return b.mtime - a.mtime;
            return a.path.localeCompare(b.path);
          });
          const sorted = decorated.map((d) => d.path);
          const { items, appliedLimit } = applyHeadLimit(sorted, headLimit, offset);
          return {
            ok: true,
            data: {
              mode,
              numFiles: items.length,
              filenames: items,
              durationMs,
              ...(appliedLimit !== undefined ? { appliedLimit, truncated: true } : {}),
              ...(offset > 0 ? { appliedOffset: offset } : {}),
            },
          };
        }
        if (mode === 'count') {
          const entries = [...countByFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));
          const { items, appliedLimit } = applyHeadLimit(entries, headLimit, offset);
          const numMatches = items.reduce((acc, [, n]) => acc + n, 0);
          const lines = items.map(([p, n]) => `${p}:${n}`);
          return {
            ok: true,
            data: {
              mode,
              numFiles: items.length,
              filenames: [],
              content: lines.join('\n'),
              numMatches,
              durationMs,
              ...(appliedLimit !== undefined ? { appliedLimit, truncated: true } : {}),
              ...(offset > 0 ? { appliedOffset: offset } : {}),
            },
          };
        }
        // content mode
        const rendered = renderContentMatches(contentMatches, {
          showLineNumbers,
          contextBefore,
          contextAfter,
          ctxFiles: candidates,
          vault: ctx.vault,
        });
        const lines = await rendered;
        const { items, appliedLimit } = applyHeadLimit(lines, headLimit, offset);
        return {
          ok: true,
          data: {
            mode,
            numFiles: 0,
            filenames: [],
            content: items.join('\n'),
            numLines: items.length,
            durationMs,
            ...(appliedLimit !== undefined ? { appliedLimit, truncated: true } : {}),
            ...(offset > 0 ? { appliedOffset: offset } : {}),
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

async function collectCandidates(
  ctx: {
    vault: { list(p: string): Promise<{ files: readonly string[]; folders: readonly string[] }> };
    signal: AbortSignal;
    excludeMatcher?: (p: string) => boolean;
  },
  root: string,
  globPatterns: readonly string[] | null,
): Promise<string[] | 'aborted'> {
  const out: string[] = [];
  const queue: string[] = [root];
  let visited = 0;
  while (queue.length > 0) {
    if (ctx.signal.aborted) return 'aborted';
    if (visited >= MAX_FILES_SCANNED) break;
    const cur = queue.shift() as string;
    let listing;
    try {
      listing = await ctx.vault.list(cur);
    } catch {
      continue;
    }
    visited += 1;
    for (const f of listing.files) {
      if (hasHiddenSegment(f)) continue;
      if (ctx.excludeMatcher !== undefined && ctx.excludeMatcher(f)) continue;
      if (globPatterns !== null) {
        const rel = root.length > 0 && f.startsWith(`${root}/`) ? f.slice(root.length + 1) : f;
        let matched = false;
        for (const g of globPatterns) {
          if (minimatch(rel, g, { dot: true, matchBase: false })) {
            matched = true;
            break;
          }
        }
        if (!matched) continue;
      }
      out.push(f);
    }
    for (const d of listing.folders) {
      if (hasHiddenSegment(d)) continue;
      queue.push(d);
    }
  }
  return out;
}

async function renderContentMatches(
  matches: readonly ContentMatch[],
  opts: {
    showLineNumbers: boolean;
    contextBefore: number;
    contextAfter: number;
    ctxFiles: readonly string[];
    vault: { read(p: string): Promise<string> };
  },
): Promise<readonly string[]> {
  if (opts.contextBefore === 0 && opts.contextAfter === 0) {
    return matches.map((m) =>
      opts.showLineNumbers ? `${m.file}:${m.line}:${m.text}` : `${m.file}:${m.text}`,
    );
  }
  const fileLines = new Map<string, readonly string[]>();
  const out: string[] = [];
  let prevFile: string | null = null;
  let prevTo = -1;
  for (const m of matches) {
    let lines = fileLines.get(m.file);
    if (lines === undefined) {
      let raw: string;
      try {
        raw = await opts.vault.read(m.file);
      } catch {
        continue;
      }
      lines = raw.split('\n');
      fileLines.set(m.file, lines);
    }
    const from = Math.max(1, m.line - opts.contextBefore);
    const to = Math.min(lines.length, m.line + opts.contextAfter);
    if (prevFile !== null && (prevFile !== m.file || from > prevTo + 1)) {
      out.push('--');
    }
    for (let lineNum = from; lineNum <= to; lineNum += 1) {
      const text = lines[lineNum - 1] ?? '';
      out.push(opts.showLineNumbers ? `${m.file}:${lineNum}:${text}` : `${m.file}:${text}`);
    }
    prevFile = m.file;
    prevTo = to;
  }
  return out;
}

function countLinesUpTo(text: string, index: number): number {
  let count = 0;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  return text.slice(start, end);
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
