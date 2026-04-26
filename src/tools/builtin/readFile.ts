import { z } from 'zod';
import type { ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { isSafeVaultPath } from './readNote';

export interface ReadFileArgs {
  readonly path: string;
  readonly maxBytes?: number;
}

export interface ReadFileResult {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

const DEFAULT_MAX_BYTES = 200 * 1024;
const HARD_MAX_BYTES = 2 * 1024 * 1024;

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
  })
  .strict();

export function createReadFileTool(): ToolSpec<ReadFileArgs, ReadFileResult> {
  return {
    id: 'read_file',
    description:
      'Read the contents of any text file from the vault by its vault-relative path. Use this for non-markdown files (configs, source code, JSON, etc.). Returns an error for binary files — attach those instead of reading.',
    schema: ReadFileSchema,
    parameters: jsonSchemaFromZod(ReadFileSchema),
    requiresConfirmation: false,
    source: 'builtin',
    validate: validateFromZod(ReadFileSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        if (!(await ctx.vault.exists(args.path))) {
          return { ok: false, error: `file not found: ${args.path}` };
        }
        const raw = await ctx.vault.read(args.path);
        if (looksBinary(raw)) {
          return {
            ok: false,
            error: `file appears to be binary: ${args.path}. Attach it instead of reading.`,
          };
        }
        const cap = Math.min(args.maxBytes ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
        const totalBytes = byteLength(raw);
        let content = raw;
        let truncated = false;
        if (totalBytes > cap) {
          content = sliceToBytes(raw, cap);
          truncated = true;
        }
        return {
          ok: true,
          data: { path: args.path, content, bytes: byteLength(content), truncated },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  };
}

function byteLength(text: string): number {
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

function looksBinary(text: string): boolean {
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

function sliceToBytes(text: string, cap: number): string {
  if (typeof TextEncoder === 'undefined' || typeof TextDecoder === 'undefined') {
    return text.slice(0, cap);
  }
  const enc = new TextEncoder().encode(text);
  if (enc.length <= cap) return text;
  return new TextDecoder('utf-8', { fatal: false }).decode(enc.slice(0, cap));
}
