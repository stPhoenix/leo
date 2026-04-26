import { z } from 'zod';
import type { ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { isSafeVaultPath } from './readNote';

export interface RevealInNoteArgs {
  readonly path: string;
  readonly lineStart: number;
  readonly lineEnd?: number;
  readonly chStart?: number;
  readonly chEnd?: number;
}

export interface RevealInNoteResult {
  readonly path: string;
  readonly from: number;
  readonly to: number;
  readonly status: 'revealed';
}

const RevealInNoteSchema: z.ZodType<RevealInNoteArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative path to the note, e.g. "Notes/Daily.md".')
      .refine(isSafeVaultPath, 'path must be vault-relative and must not traverse parents'),
    lineStart: z.number().int().min(0).describe('0-based start line index (inclusive).'),
    lineEnd: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        '0-based end line index (inclusive). Omit for cursor-only at lineStart. Must be >= lineStart.',
      ),
    chStart: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('0-based column on lineStart. Omit for line beginning.'),
    chEnd: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('0-based column on lineEnd (exclusive end of selection). Omit for whole-line end.'),
  })
  .strict()
  .refine(
    (v) => v.lineEnd === undefined || v.lineEnd >= v.lineStart,
    'lineEnd must be >= lineStart',
  );

export function createRevealInNoteTool(): ToolSpec<RevealInNoteArgs, RevealInNoteResult> {
  return {
    id: 'reveal_in_note',
    description:
      'Open a note (if not already open), place the cursor or select a range, scroll into view, and briefly highlight the target. Use when the user asks to show or jump to a specific place — section, line, paragraph, heading. lineStart is required; lineEnd makes it a range; chStart/chEnd narrow within those lines.',
    schema: RevealInNoteSchema,
    parameters: jsonSchemaFromZod(RevealInNoteSchema),
    requiresConfirmation: false,
    isReadOnly: true,
    source: 'builtin',
    validate: validateFromZod(RevealInNoteSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      if (ctx.navigator === undefined) {
        return { ok: false, error: 'navigator unavailable' };
      }
      const result = await ctx.navigator.revealInNote({
        path: args.path,
        lineStart: args.lineStart,
        ...(args.lineEnd !== undefined ? { lineEnd: args.lineEnd } : {}),
        ...(args.chStart !== undefined ? { chStart: args.chStart } : {}),
        ...(args.chEnd !== undefined ? { chEnd: args.chEnd } : {}),
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: { path: args.path, from: result.from, to: result.to, status: 'revealed' },
      };
    },
  };
}
