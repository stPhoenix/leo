import { z } from 'zod';
import type { ToolResult, ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { appendRow } from '@/agent/wiki/inbox/parse';
import { WIKI_INBOX_PATH } from '@/agent/wiki/paths';
import type { VaultAdapter } from '@/storage/vaultAdapter';

const InboxAddSchema: z.ZodType<InboxAddArgs> = z
  .object({
    ref: z
      .string()
      .min(1)
      .max(2048)
      .describe('URL, vault path, or attachment id to enqueue for later wiki ingest.'),
    note: z
      .string()
      .max(2048)
      .optional()
      .describe('Optional one-line note about why this item is in the inbox.'),
  })
  .strict() as unknown as z.ZodType<InboxAddArgs>;

export interface InboxAddArgs {
  readonly ref: string;
  readonly note?: string;
}

export interface InboxAddResult {
  readonly added: true;
  readonly inboxPath: string;
}

export const INBOX_ADD_TOOL_ID = 'inbox_add';

export interface InboxAddDeps {
  readonly vault: VaultAdapter;
}

export function createInboxAddTool(deps: InboxAddDeps): ToolSpec<InboxAddArgs, InboxAddResult> {
  return {
    id: INBOX_ADD_TOOL_ID,
    description:
      'Append a pending ingest item to wiki-inbox.md. Read-only with respect to the wiki content (it edits the inbox checklist only); no confirmation required.',
    schema: InboxAddSchema,
    parameters: jsonSchemaFromZod(InboxAddSchema),
    requiresConfirmation: false,
    isReadOnly: true,
    source: 'builtin',
    shouldDefer: true,
    validate: validateFromZod(InboxAddSchema),
    async invoke(args, ctx): Promise<ToolResult<InboxAddResult>> {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        const existing = (await deps.vault.exists(WIKI_INBOX_PATH))
          ? await deps.vault.read(WIKI_INBOX_PATH)
          : '';
        const next = appendRow(existing, args.ref, args.note);
        await deps.vault.write(WIKI_INBOX_PATH, next);
        return { ok: true, data: { added: true, inboxPath: WIKI_INBOX_PATH } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
