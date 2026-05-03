import { z } from 'zod';
import type { ConfirmationController } from '@/agent/confirmationController';
import { prettifyArgs } from '@/agent/confirmationController';
import type { ToolResult, ToolSpec } from '../types';
import { jsonSchemaFromZod } from '../zodAdapter';
import type {
  IngestRunHandle,
  IngestRunInput,
  IngestStartResult,
  IngestTerminalResult,
} from '@/agent/wiki/ingest/subgraph';
import type { IngestSource } from '@/agent/wiki/ingest/types';
import { runInboxBatch, type InboxBatchResult } from '@/agent/wiki/ingest/inboxBatch';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { Logger } from '@/platform/Logger';

export const DELEGATE_WIKI_INGEST_TOOL_ID = 'delegate_wiki_ingest';

const NOTE_MAX = 2_000;

const VALID_KINDS = ['url', 'vaultPath', 'attachment', 'conversation', 'inbox'] as const;
const KIND_DESCRIPTION =
  'Source kind. Must be exactly one of: "url" (remote http(s) page), ' +
  '"vaultPath" (file already in the vault), "attachment" (chat attachment id), ' +
  '"conversation" (current-conversation answer body), "inbox" (drain wiki-inbox.md).';

const UrlInput = z.object({
  kind: z.literal('url').describe(KIND_DESCRIPTION),
  url: z.string().url(),
  note: z.string().max(NOTE_MAX).optional(),
});

const VaultInput = z.object({
  kind: z.literal('vaultPath').describe(KIND_DESCRIPTION),
  path: z.string().min(1).max(1024),
  note: z.string().max(NOTE_MAX).optional(),
});

const AttachmentInput = z.object({
  kind: z.literal('attachment').describe(KIND_DESCRIPTION),
  attachmentId: z.string().min(1).max(256),
  note: z.string().max(NOTE_MAX).optional(),
});

const ConversationInput = z.object({
  kind: z.literal('conversation').describe(KIND_DESCRIPTION),
  title: z.string().min(1).max(256),
  body: z.string().min(1),
  citedSources: z.array(z.string()).optional(),
  note: z.string().max(NOTE_MAX).optional(),
  threadId: z.string().min(1).max(256),
  turnIndex: z.number().int().nonnegative(),
});

const InboxInput = z.object({
  kind: z.literal('inbox').describe(KIND_DESCRIPTION),
});

const DelegateWikiIngestSchema = z.discriminatedUnion('kind', [
  UrlInput,
  VaultInput,
  AttachmentInput,
  ConversationInput,
  InboxInput,
]);

export type DelegateWikiIngestArgs = z.infer<typeof DelegateWikiIngestSchema>;

export type DelegateWikiIngestSuccessPayload =
  | { readonly mode: 'single'; readonly terminal: IngestTerminalResult }
  | { readonly mode: 'inbox'; readonly batch: InboxBatchResult };

export type DelegateWikiIngestData =
  | { readonly ok: true; readonly data: DelegateWikiIngestSuccessPayload }
  | {
      readonly ok: false;
      readonly denied?: true;
      readonly busy?: true;
      readonly activeRunId?: string;
      readonly activeOp?: 'ingest' | 'lint';
      readonly error?: { readonly code: string; readonly message: string };
    };

export interface DelegateWikiIngestDeps {
  readonly confirmation: ConfirmationController;
  readonly startRun: (input: IngestRunInput) => IngestStartResult;
  readonly onHandle?: (handle: IngestRunHandle) => void;
  readonly inbox?: {
    readonly vault: VaultAdapter;
    readonly logger?: Logger;
  };
}

const DESCRIPTION = [
  'File a knowledge source into the local wiki at `wiki/`. Use for: URL, vault path, chat attachment, or a current-conversation answer/analysis.',
  '',
  'When to call:',
  '- The user asks to ingest a page, doc, or knowledge source into the wiki.',
  '- The conversation has produced factual content worth saving as a wiki page; use `kind:"conversation"` with the answer body and a short title to file the result back into the wiki without asking the user to re-paste.',
  '',
  'Every call requires explicit user approval; nothing is fetched or written without confirmation.',
  '',
  'On approval, an ingest subgraph runs (refine → fetch → persist → plan → extract → reduce → write). For the conversation kind, fetching is skipped — the supplied body is persisted directly. Live progress streams into an inline widget; the tool resolves with the final structured payload.',
].join('\n');

export function createDelegateWikiIngestTool(
  deps: DelegateWikiIngestDeps,
): ToolSpec<DelegateWikiIngestArgs, DelegateWikiIngestData> {
  return {
    id: DELEGATE_WIKI_INGEST_TOOL_ID,
    description: DESCRIPTION,
    schema: DelegateWikiIngestSchema as unknown as z.ZodType<DelegateWikiIngestArgs>,
    parameters: jsonSchemaFromZod(DelegateWikiIngestSchema as unknown as z.ZodType<unknown>),
    requiresConfirmation: false, // owns own confirmation surface below
    source: 'builtin',
    shouldDefer: true,
    validate(raw): ToolResult<DelegateWikiIngestArgs> {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: 'input must be an object' };
      }
      const rawKind = (raw as Record<string, unknown>).kind;
      if (typeof rawKind !== 'string' || rawKind.length === 0) {
        return {
          ok: false,
          error: `kind: missing — must be one of ${VALID_KINDS.join(', ')}`,
        };
      }
      if (!(VALID_KINDS as readonly string[]).includes(rawKind)) {
        return {
          ok: false,
          error: `kind: "${rawKind}" is not valid — must be one of ${VALID_KINDS.join(', ')}`,
        };
      }
      const parsed = DelegateWikiIngestSchema.safeParse(raw);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return {
          ok: false,
          error:
            first !== undefined
              ? `${first.path.join('.') || '<root>'}: ${first.message}`
              : 'invalid input',
        };
      }
      return { ok: true, data: parsed.data };
    },
    async invoke(args, ctx): Promise<ToolResult<DelegateWikiIngestData>> {
      const argsJson = JSON.stringify(args);
      const decision = await deps.confirmation.request({
        toolId: DELEGATE_WIKI_INGEST_TOOL_ID,
        thread: ctx.thread,
        argsJson,
        argsPretty: prettifyArgs(argsJson),
        category: 'write',
        actionLabels: { allow: 'Prepare wiki ingest', deny: 'Deny' },
        disableAllowForThread: true,
      });
      if (decision === 'deny') {
        ctx.logger?.info('wiki.ingest.tool.denied', { thread: ctx.thread });
        return { ok: true, data: { ok: false, denied: true } };
      }

      if (args.kind === 'inbox') {
        if (deps.inbox === undefined) {
          return {
            ok: true,
            data: {
              ok: false,
              error: { code: 'inbox_unconfigured', message: 'inbox runner not wired' },
            },
          };
        }
        const batch = await runInboxBatch(ctx.thread, ctx.signal, {
          vault: deps.inbox.vault,
          ...(deps.inbox.logger !== undefined ? { logger: deps.inbox.logger } : {}),
          startRun: deps.startRun,
          ...(deps.onHandle !== undefined ? { onHandle: deps.onHandle } : {}),
        });
        return { ok: true, data: { ok: true, data: { mode: 'inbox', batch } } };
      }

      const sources: readonly IngestSource[] = [argsToSource(args)];
      const start = deps.startRun({
        threadId: ctx.thread,
        originalAsk: describeArgsAsAsk(args),
        sources,
        ...(args.note !== undefined ? { note: args.note } : {}),
      });
      if (!start.ok) {
        ctx.logger?.info('wiki.ingest.tool.busy', {
          thread: ctx.thread,
          activeRunId: start.busy.activeRunId,
          activeOp: start.busy.activeOp,
        });
        return {
          ok: true,
          data: {
            ok: false,
            busy: true,
            activeRunId: start.busy.activeRunId,
            activeOp: start.busy.activeOp,
          },
        };
      }
      deps.onHandle?.(start.handle);
      const onAbort = (): void => start.handle.abort();
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const terminal = await start.handle.terminal;
        return { ok: true, data: { ok: true, data: { mode: 'single', terminal } } };
      } finally {
        ctx.signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

function argsToSource(args: DelegateWikiIngestArgs): IngestSource {
  switch (args.kind) {
    case 'url':
      return {
        kind: 'url',
        url: args.url,
        ...(args.note !== undefined ? { note: args.note } : {}),
      };
    case 'vaultPath':
      return {
        kind: 'vaultPath',
        path: args.path,
        ...(args.note !== undefined ? { note: args.note } : {}),
      };
    case 'attachment':
      return {
        kind: 'attachment',
        attachmentId: args.attachmentId,
        ...(args.note !== undefined ? { note: args.note } : {}),
      };
    case 'conversation':
      return {
        kind: 'conversation',
        title: args.title,
        body: args.body,
        threadId: args.threadId,
        turnIndex: args.turnIndex,
        ...(args.citedSources !== undefined ? { citedSources: args.citedSources } : {}),
        ...(args.note !== undefined ? { note: args.note } : {}),
      };
    case 'inbox':
      // Should never reach here — inbox is routed before argsToSource.
      throw new Error('inbox routed via runInboxBatch, not argsToSource');
  }
}

function describeArgsAsAsk(args: DelegateWikiIngestArgs): string {
  switch (args.kind) {
    case 'url':
      return `Ingest URL into wiki: ${args.url}`;
    case 'vaultPath':
      return `Ingest vault path into wiki: ${args.path}`;
    case 'attachment':
      return `Ingest attachment into wiki: ${args.attachmentId}`;
    case 'conversation':
      return `File conversation answer/analysis into wiki: ${args.title}`;
    case 'inbox':
      return 'Drain wiki-inbox.md sequentially';
  }
}
