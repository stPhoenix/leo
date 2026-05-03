import { z } from 'zod';
import type { ConfirmationController } from '@/agent/confirmationController';
import { prettifyArgs } from '@/agent/confirmationController';
import type { ToolResult, ToolSpec } from '../types';
import { jsonSchemaFromZod } from '../zodAdapter';
import type {
  LintConfirmDecision,
  LintRunHandle,
  LintRunInput,
  LintStartResult,
  LintTerminalResult,
} from '@/agent/wiki/lint/subgraph';
import type { LintFinding, LintSchemaPatch } from '@/agent/wiki/lint/schemas';

export const DELEGATE_WIKI_LINT_TOOL_ID = 'delegate_wiki_lint';

const AllScope = z.object({ kind: z.literal('all') });
const PagesScope = z.object({ kind: z.literal('pages'), glob: z.string().min(1).max(512) });
const OrphansScope = z.object({ kind: z.literal('orphans') });

const ScopeSchema = z.discriminatedUnion('kind', [AllScope, PagesScope, OrphansScope]);

const DelegateWikiLintSchema = z
  .object({
    scope: ScopeSchema.optional(),
  })
  .strict();

export type DelegateWikiLintArgs = z.infer<typeof DelegateWikiLintSchema>;

export type DelegateWikiLintData =
  | { readonly ok: true; readonly data: LintTerminalResult }
  | {
      readonly ok: false;
      readonly denied?: true;
      readonly busy?: true;
      readonly activeRunId?: string;
      readonly activeOp?: 'ingest' | 'lint';
      readonly error?: { readonly code: string; readonly message: string };
    };

export interface DelegateWikiLintDeps {
  readonly confirmation: ConfirmationController;
  /**
   * Call into F18's `startLintRun`, with the `requestConfirmation` callback
   * already wired by the caller. The tool only handles the confirmation +
   * widget-mount surface; F18 owns the FSM.
   */
  readonly startRun: (
    input: LintRunInput,
    requestConfirmation: (
      runId: string,
      findings: readonly LintFinding[],
      schemaPatch: LintSchemaPatch | null,
    ) => Promise<LintConfirmDecision | null>,
  ) => LintStartResult;
  readonly onHandle?: (
    handle: LintRunHandle,
    setConfirmResolver: (resolver: (decision: LintConfirmDecision | null) => void) => void,
  ) => void;
}

const DESCRIPTION = [
  'Run a lint pass over the wiki: scan, check, propose, then surface a multi-select findings list for confirmation.',
  '',
  'When to call:',
  '- The user asks to "lint the wiki", "check for stale pages", "find orphans", or otherwise audit `wiki/`.',
  '- Routine maintenance after a batch of ingests.',
  '',
  'Every call requires explicit user approval. Schema patches require a per-run secondary confirm; nothing is auto-applied.',
  '',
  'On approval, the lint subgraph runs (scan → check → propose → confirm → write). Live progress streams into an inline widget; the tool resolves with the final structured payload.',
].join('\n');

export function createDelegateWikiLintTool(
  deps: DelegateWikiLintDeps,
): ToolSpec<DelegateWikiLintArgs, DelegateWikiLintData> {
  return {
    id: DELEGATE_WIKI_LINT_TOOL_ID,
    description: DESCRIPTION,
    schema: DelegateWikiLintSchema as unknown as z.ZodType<DelegateWikiLintArgs>,
    parameters: jsonSchemaFromZod(DelegateWikiLintSchema as unknown as z.ZodType<unknown>),
    requiresConfirmation: false,
    source: 'builtin',
    shouldDefer: true,
    validate(raw): ToolResult<DelegateWikiLintArgs> {
      const parsed = DelegateWikiLintSchema.safeParse(raw);
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
    async invoke(args, ctx): Promise<ToolResult<DelegateWikiLintData>> {
      const argsJson = JSON.stringify(args);
      const decision = await deps.confirmation.request({
        toolId: DELEGATE_WIKI_LINT_TOOL_ID,
        thread: ctx.thread,
        argsJson,
        argsPretty: prettifyArgs(argsJson),
        category: 'write',
        actionLabels: { allow: 'Run wiki lint', deny: 'Deny' },
        disableAllowForThread: true,
      });
      if (decision === 'deny') {
        ctx.logger?.info('wiki.lint.tool.denied', { thread: ctx.thread });
        return { ok: true, data: { ok: false, denied: true } };
      }

      let pendingResolver: ((d: LintConfirmDecision | null) => void) | null = null;
      const requestConfirmation = (
        _runId: string,
        _findings: readonly LintFinding[],
        _schemaPatch: LintSchemaPatch | null,
      ): Promise<LintConfirmDecision | null> =>
        new Promise<LintConfirmDecision | null>((resolve) => {
          pendingResolver = resolve;
        });

      const start = deps.startRun(
        {
          threadId: ctx.thread,
          ...(args.scope !== undefined ? { scope: args.scope } : {}),
        },
        requestConfirmation,
      );
      if (!start.ok) {
        ctx.logger?.info('wiki.lint.tool.busy', {
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
      deps.onHandle?.(start.handle, (resolver) => {
        pendingResolver = resolver;
      });
      // Bridge: when widget calls applyLintConfirm, forward to the pending resolver.
      start.handle.controller.setActions({
        applyLintConfirm: (payload) => {
          pendingResolver?.({
            accepted: payload.accepted,
            rejected: payload.rejected,
            applySchema: payload.applySchema,
          });
          pendingResolver = null;
        },
        cancel: () => {
          pendingResolver?.(null);
          pendingResolver = null;
          start.handle.abort();
        },
      });
      const onAbort = (): void => {
        pendingResolver?.(null);
        pendingResolver = null;
        start.handle.abort();
      };
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const terminal = await start.handle.terminal;
        return { ok: true, data: { ok: true, data: terminal } };
      } finally {
        ctx.signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
