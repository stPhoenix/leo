import { z } from 'zod';
import type { JsonSchema, ToolResult, ToolSpec } from '../types';
import type {
  IngestRunHandle,
  IngestRunInput,
  IngestStartResult,
  IngestTerminalResult,
} from '@/agent/wiki/ingest/subgraph';
import type { IngestSource, ProviderOverride } from '@/agent/wiki/ingest/types';
import { runInboxBatch, type InboxBatchResult } from '@/agent/wiki/ingest/inboxBatch';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { Logger } from '@/platform/Logger';
import type { WikiWidgetController } from '@/agent/wiki/widgetController';
import {
  DELEGATE_WIKI_INGEST_DESCRIPTION,
  DELEGATE_WIKI_INGEST_KIND_DESCRIPTION as KIND_DESCRIPTION,
} from '@/prompts/tools/builtin/delegateWikiIngestDescription';

export const DELEGATE_WIKI_INGEST_TOOL_ID = 'delegate_wiki_ingest';

const NOTE_MAX = 2_000;

const VALID_KINDS = ['url', 'vaultPath', 'attachment', 'conversation', 'inbox'] as const;

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

export interface PickerOutcome {
  readonly override: ProviderOverride;
  readonly runId: string;
  readonly controller: WikiWidgetController;
}

export interface DelegateWikiIngestDeps {
  readonly vault: VaultAdapter;
  readonly beginPickerFlow: (args: {
    readonly threadId: string;
    readonly originalAsk: string;
    readonly sourcesSummary: string;
  }) => Promise<PickerOutcome | null>;
  readonly startRun: (
    input: IngestRunInput,
    runId: string,
    controller: WikiWidgetController,
  ) => IngestStartResult;
  readonly isAllowedVaultPath: (path: string) => boolean;
  readonly onHandle?: (handle: IngestRunHandle) => void;
  readonly inbox?: {
    readonly vault: VaultAdapter;
    readonly logger?: Logger;
  };
}

export const VAULT_FOLDER_FANOUT_MAX = 50;

// Flat JSON Schema is hand-rolled because `z.discriminatedUnion('kind', …)` (above)
// generates `oneOf`, which several LM Studio GGUF models (qwen3-coder, gpt-oss) reject
// or mis-route into reasoning_content. Keep in sync with `DelegateWikiIngestSchema`.
const DELEGATE_WIKI_INGEST_PARAMETERS: JsonSchema = {
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: VALID_KINDS,
      description: KIND_DESCRIPTION,
    },
    url: {
      type: 'string',
      description: 'For kind="url": absolute http(s) URL to fetch and ingest.',
    },
    path: {
      type: 'string',
      description:
        'For kind="vaultPath": vault-relative path (file or folder). Must be inside wiki/ or externalAgentResults/. Folders fan out to every `.md` file inside them recursively.',
    },
    attachmentId: {
      type: 'string',
      description: 'For kind="attachment": attachment id from the current conversation.',
    },
    title: {
      type: 'string',
      description: 'For kind="conversation": short title to file the answer under.',
    },
    body: {
      type: 'string',
      description: 'For kind="conversation": the answer/analysis body to persist.',
    },
    citedSources: {
      type: 'array',
      items: { type: 'string' },
      description: 'For kind="conversation": optional list of cited URLs or vault paths.',
    },
    threadId: {
      type: 'string',
      description: 'For kind="conversation": current thread id.',
    },
    turnIndex: {
      type: 'integer',
      description: 'For kind="conversation": index of the turn the answer comes from.',
    },
    note: {
      type: 'string',
      description: 'Optional free-text note attached to the source (max 2000 chars).',
    },
  },
};

export function createDelegateWikiIngestTool(
  deps: DelegateWikiIngestDeps,
): ToolSpec<DelegateWikiIngestArgs, DelegateWikiIngestData> {
  return {
    id: DELEGATE_WIKI_INGEST_TOOL_ID,
    description: DELEGATE_WIKI_INGEST_DESCRIPTION,
    schema: DelegateWikiIngestSchema as unknown as z.ZodType<DelegateWikiIngestArgs>,
    parameters: DELEGATE_WIKI_INGEST_PARAMETERS,
    requiresConfirmation: false,
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
      if (parsed.data.kind === 'vaultPath' && !deps.isAllowedVaultPath(parsed.data.path)) {
        return {
          ok: false,
          error: `path: "${parsed.data.path}" outside wiki sandbox — vault paths must be inside wiki/ or externalAgentResults/`,
        };
      }
      return { ok: true, data: parsed.data };
    },
    async invoke(args, ctx): Promise<ToolResult<DelegateWikiIngestData>> {
      let preparedSources: readonly IngestSource[] | null = null;
      let preparedOriginalAsk: string | null = null;
      let preparedSummary: string | null = null;
      if (args.kind === 'vaultPath') {
        const expanded = await expandVaultPathSources(deps.vault, args);
        if (!expanded.ok) {
          return {
            ok: true,
            data: {
              ok: false,
              error: { code: 'fetch_vault_empty_folder', message: expanded.error },
            },
          };
        }
        preparedSources = expanded.sources;
        preparedOriginalAsk =
          expanded.fileCount > 1
            ? `Ingest folder into wiki: ${args.path} (${expanded.fileCount} files)`
            : `Ingest vault path into wiki: ${args.path}`;
        preparedSummary =
          expanded.fileCount > 1 ? `${args.path} (${expanded.fileCount} files)` : args.path;
      }

      const originalAsk = preparedOriginalAsk ?? describeArgsAsAsk(args);
      const sourcesSummary = preparedSummary ?? describeArgsAsSummary(args);

      const outcome = await deps.beginPickerFlow({
        threadId: ctx.thread,
        originalAsk,
        sourcesSummary,
      });
      if (outcome === null) {
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
        const batch = await runInboxBatch(
          ctx.thread,
          ctx.signal,
          {
            vault: deps.inbox.vault,
            ...(deps.inbox.logger !== undefined ? { logger: deps.inbox.logger } : {}),
            startRun: (input) => deps.startRun(input, outcome.runId, outcome.controller),
            ...(deps.onHandle !== undefined ? { onHandle: deps.onHandle } : {}),
          },
          outcome.override,
        );
        return { ok: true, data: { ok: true, data: { mode: 'inbox', batch } } };
      }

      const sources: readonly IngestSource[] = preparedSources ?? [argsToSource(args)];
      const start = deps.startRun(
        {
          threadId: ctx.thread,
          originalAsk,
          sources,
          ...(args.note !== undefined ? { note: args.note } : {}),
          providerOverride: outcome.override,
        },
        outcome.runId,
        outcome.controller,
      );
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

type ExpandResult =
  | { readonly ok: true; readonly sources: readonly IngestSource[]; readonly fileCount: number }
  | { readonly ok: false; readonly error: string };

async function expandVaultPathSources(
  vault: VaultAdapter,
  args: { readonly path: string; readonly note?: string },
): Promise<ExpandResult> {
  const stat = await vault.stat(args.path);
  if (stat?.kind !== 'folder') {
    return {
      ok: true,
      sources: [
        {
          kind: 'vaultPath',
          path: args.path,
          ...(args.note !== undefined ? { note: args.note } : {}),
        },
      ],
      fileCount: 1,
    };
  }
  const files: string[] = [];
  await collectMarkdownFiles(vault, args.path, files);
  if (files.length === 0) {
    return {
      ok: false,
      error: `vault path ${args.path} is a folder containing no .md files`,
    };
  }
  files.sort((a, b) => a.localeCompare(b));
  const sources: IngestSource[] = files.map((p) => ({
    kind: 'vaultPath',
    path: p,
    ...(args.note !== undefined ? { note: args.note } : {}),
  }));
  return { ok: true, sources, fileCount: files.length };
}

async function collectMarkdownFiles(
  vault: VaultAdapter,
  dir: string,
  out: string[],
): Promise<void> {
  if (out.length >= VAULT_FOLDER_FANOUT_MAX) return;
  const listing = await vault.list(dir);
  for (const f of listing.files) {
    if (out.length >= VAULT_FOLDER_FANOUT_MAX) return;
    if (f.toLowerCase().endsWith('.md')) out.push(f);
  }
  for (const sub of listing.folders) {
    if (out.length >= VAULT_FOLDER_FANOUT_MAX) return;
    await collectMarkdownFiles(vault, sub, out);
  }
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

function describeArgsAsSummary(args: DelegateWikiIngestArgs): string {
  switch (args.kind) {
    case 'url':
      return args.url;
    case 'vaultPath':
      return args.path;
    case 'attachment':
      return `attachment:${args.attachmentId}`;
    case 'conversation':
      return `conversation: ${args.title}`;
    case 'inbox':
      return 'inbox queue (all open rows)';
  }
}
