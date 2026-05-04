import { z } from 'zod';
import type { ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import {
  runRename,
  type RenameNoteArgs,
  type RenameNoteResult,
  type RenameNoteToolOptions,
} from './renameNote';

const MoveNoteSchema: z.ZodType<RenameNoteArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative path to the note to move.')
      .refine(isSafeVaultPath, 'unsafe path'),
    new_path: z
      .string()
      .min(1, 'new_path must be a non-empty string')
      .describe(
        'Vault-relative destination path including filename. Must not already exist. Use this to change the folder while keeping or changing the basename.',
      )
      .refine(isSafeVaultPath, 'unsafe path'),
  })
  .strict()
  .refine((v) => v.path !== v.new_path, 'new_path must differ from path');

export type MoveNoteToolOptions = RenameNoteToolOptions;
export type MoveNoteArgs = RenameNoteArgs;
export type MoveNoteResult = RenameNoteResult;

export function createMoveNoteTool(
  opts: MoveNoteToolOptions,
): ToolSpec<MoveNoteArgs, MoveNoteResult> {
  return {
    id: 'move_note',
    description:
      'Move a vault note to a different folder by changing its `new_path`. Updates wiki-links across the vault via Obsidian fileManager. Fails if the destination already exists. Use rename_note when the intent is to change only the filename in place.',
    schema: MoveNoteSchema,
    parameters: jsonSchemaFromZod(MoveNoteSchema),
    requiresConfirmation: true,
    source: 'builtin',
    shouldDefer: true,
    validate: validateFromZod(MoveNoteSchema),
    invoke(args, ctx) {
      return runRename(ctx, args, opts, 'move');
    },
  };
}
