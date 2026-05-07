import { z } from 'zod';
import { roughTokenCountEstimation } from '@/agent/tokenEstimator';
import type { ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { isSafeVaultPath } from './readNote';
import {
  addLineNumbers,
  byteLength,
  findSimilarPaths,
  looksBinary,
  readFileInRange,
} from './readFileShared';

export interface ReadFileArgs {
  readonly path: string;
  readonly maxBytes?: number;
  readonly offset?: number;
  readonly limit?: number;
}

export interface ReadFileResult {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly totalLines?: number;
  readonly startLine?: number;
  readonly numLines?: number;
  readonly unchanged?: boolean;
}

const DEFAULT_MAX_BYTES = 200 * 1024;
const HARD_MAX_BYTES = 2 * 1024 * 1024;
const MAX_TOKENS_DEFAULT = 25_000;

const ReadFileSchema: z.ZodType<ReadFileArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe(
        'Vault-relative path to any text file (e.g. "src/config.json", "notes/draft.md"). No "..", no leading "/".',
      )
      .refine(isSafeVaultPath, 'path must be vault-relative and must not traverse parents'),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(HARD_MAX_BYTES)
      .optional()
      .describe(`Optional cap on returned content size in bytes. Default ${DEFAULT_MAX_BYTES}.`),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Optional 1-indexed line number to start reading from.'),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Optional max number of lines to read. When set, the byte cap is disabled to allow slicing large files.',
      ),
  })
  .strict();

export function createReadFileTool(): ToolSpec<ReadFileArgs, ReadFileResult> {
  return {
    id: 'read_file',
    description:
      'Read the contents of any text file from the vault by its vault-relative path. Use offset/limit to slice large files. Returns line-numbered content (`<n>\\t<line>`). Errors on binaries — attach those instead.',
    schema: ReadFileSchema,
    parameters: jsonSchemaFromZod(ReadFileSchema),
    requiresConfirmation: false,
    isReadOnly: true,
    source: 'builtin',
    validate: validateFromZod(ReadFileSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        if (!(await ctx.vault.exists(args.path))) {
          const suggestions = await findSimilarPaths(ctx.vault, args.path, 3, ctx.signal);
          const suffix = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
          return { ok: false, error: `file not found: ${args.path}.${suffix}` };
        }
        const stat = await ctx.vault.stat(args.path);
        const mtimeMs = Math.floor(stat?.mtimeMs ?? 0);
        const startLine = args.offset ?? 1;
        if (ctx.readState !== undefined && stat !== null) {
          const cached = ctx.readState.matches(
            ctx.thread,
            args.path,
            mtimeMs,
            args.offset,
            args.limit,
          );
          if (cached !== undefined) {
            return {
              ok: true,
              data: {
                path: args.path,
                content:
                  '<system-reminder>File unchanged since last read. The content from the earlier read_file tool result in this conversation is still current — refer to that instead of re-reading.</system-reminder>',
                bytes: 0,
                truncated: false,
                unchanged: true,
              },
            };
          }
        }
        const raw = await ctx.vault.read(args.path);
        if (looksBinary(raw)) {
          return {
            ok: false,
            error: `file appears to be binary: ${args.path}. Attach it instead of reading.`,
          };
        }
        const limitProvided = args.limit !== undefined;
        const cap = Math.min(args.maxBytes ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
        const totalBytes = byteLength(raw);
        let truncatedByBytes = false;
        let working = raw;
        if (!limitProvided && totalBytes > cap) {
          working = sliceToBytes(raw, cap);
          truncatedByBytes = true;
        }
        const range = readFileInRange(working, Math.max(0, startLine - 1), args.limit);
        const tokens = roughTokenCountEstimation(range.content);
        if (tokens > MAX_TOKENS_DEFAULT) {
          return {
            ok: false,
            error: `file content (~${tokens} tokens) exceeds maximum allowed tokens (${MAX_TOKENS_DEFAULT}). Use offset and limit parameters to read specific portions of the file.`,
          };
        }
        if (range.totalLines === 0) {
          if (ctx.readState !== undefined) {
            ctx.readState.set(ctx.thread, args.path, {
              content: '',
              mtimeMs,
              offset: args.offset,
              limit: args.limit,
              isPartialView: limitProvided,
            });
          }
          return {
            ok: true,
            data: {
              path: args.path,
              content:
                '<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>',
              bytes: 0,
              truncated: false,
              totalLines: 0,
              startLine,
              numLines: 0,
            },
          };
        }
        if (startLine > range.totalLines) {
          return {
            ok: true,
            data: {
              path: args.path,
              content: `<system-reminder>Warning: the file exists but is shorter than the provided offset (${startLine}). The file has ${range.totalLines} lines.</system-reminder>`,
              bytes: 0,
              truncated: false,
              totalLines: range.totalLines,
              startLine,
              numLines: 0,
            },
          };
        }
        const numbered = addLineNumbers(range.content, startLine);
        if (ctx.readState !== undefined) {
          ctx.readState.set(ctx.thread, args.path, {
            content: range.content,
            mtimeMs,
            offset: args.offset,
            limit: args.limit,
            isPartialView: limitProvided || truncatedByBytes,
          });
        }
        return {
          ok: true,
          data: {
            path: args.path,
            content: numbered,
            bytes: byteLength(range.content),
            truncated:
              truncatedByBytes ||
              (limitProvided && range.numLines < range.totalLines - (startLine - 1)),
            totalLines: range.totalLines,
            startLine,
            numLines: range.numLines,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  };
}

function sliceToBytes(text: string, cap: number): string {
  if (typeof TextEncoder === 'undefined' || typeof TextDecoder === 'undefined') {
    return text.slice(0, cap);
  }
  const enc = new TextEncoder().encode(text);
  if (enc.length <= cap) return text;
  return new TextDecoder('utf-8', { fatal: false }).decode(enc.slice(0, cap));
}
