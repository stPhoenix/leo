import { z } from 'zod';
import type { ConfirmationController } from '@/agent/confirmationController';
import { prettifyArgs } from '@/agent/confirmationController';
import type { ExternalAgentOrchestrator } from '@/agent/externalAgent/orchestrator';
import type { DelegateExternalToolResult } from '@/agent/externalAgent/runPhase';
import type { RunHandle } from '@/agent/externalAgent/subgraph';
import type { ToolResult, ToolSpec } from '../types';
import { jsonSchemaFromZod } from '../zodAdapter';

export const DELEGATE_EXTERNAL_TOOL_ID = 'delegate_external';

const ASK_HARD_LIMIT_CHARS = 16_384;

export interface DelegateExternalArgs {
  readonly ask: string;
  readonly preferredAdapterId?: string;
  readonly timeoutMs?: number;
  readonly refineBudget?: number;
}

const DelegateExternalSchema: z.ZodType<DelegateExternalArgs> = z
  .object({
    ask: z
      .string()
      .min(1, 'ask must be a non-empty string')
      .max(ASK_HARD_LIMIT_CHARS, `ask exceeds hard limit (${ASK_HARD_LIMIT_CHARS} chars)`)
      .describe(
        'The original user ask to escalate. The refine sub-agent will turn this into a final, self-contained prompt before sending to the external agent.',
      ),
    preferredAdapterId: z
      .string()
      .optional()
      .describe(
        'Optional adapter id (e.g. "claude-code"). When omitted, the user-configured default is used.',
      ),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Optional adapter call timeout override in ms. Defaults to adapter.defaultTimeoutMs.',
      ),
    refineBudget: z
      .number()
      .int()
      .positive()
      .max(10)
      .optional()
      .describe('Optional clarifying-question budget override (default 3, hard cap 10).'),
  })
  .strict() as unknown as z.ZodType<DelegateExternalArgs>;

export interface DelegateExternalDeps {
  readonly orchestrator: ExternalAgentOrchestrator;
  readonly confirmation: ConfirmationController;
  /**
   * Called once with the live `RunHandle` after the subgraph starts. The
   * widget controller (F07) subscribes to project state into the widget store
   * and to wire user actions (Send / Edit / Cancel / clarify-answer) back
   * into the run. Without a subscriber the run will never reach a terminal
   * state because READY phase blocks on a Send action.
   */
  readonly onHandle?: (handle: RunHandle) => void;
}

const DELEGATE_EXTERNAL_DESCRIPTION = [
  'Escalate the user request to an external agent (e.g. Claude Code CLI, OpenAI-compatible HTTP).',
  '',
  'Use this tool ONLY when:',
  '- no other registered tool fits the user request, AND',
  '- the task plausibly benefits from an external system: web research, deep research,',
  '  long-running computation, or invoking a third-party CLI/HTTP agent.',
  '',
  'Every call requires explicit user approval — there is no per-thread allowlist for this tool.',
  'If the user has not yet approved escalation, prefer asking them in chat first to avoid a',
  'wasted confirmation prompt.',
  '',
  'On approval, a refine sub-agent will turn the ask into a self-contained prompt (possibly',
  'asking the user clarifying questions in a widget) and stream the result through an',
  'inline widget. The tool resolves with the final structured payload.',
].join('\n');

export function createDelegateExternalTool(
  deps: DelegateExternalDeps,
): ToolSpec<DelegateExternalArgs, DelegateExternalToolResult> {
  return {
    id: DELEGATE_EXTERNAL_TOOL_ID,
    description: DELEGATE_EXTERNAL_DESCRIPTION,
    schema: DelegateExternalSchema,
    parameters: jsonSchemaFromZod(DelegateExternalSchema),
    requiresConfirmation: false, // F06 owns its own per-call confirmation
    source: 'builtin',
    validate(raw): ToolResult<DelegateExternalArgs> {
      const parsed = DelegateExternalSchema.safeParse(raw);
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
    async invoke(args, ctx): Promise<ToolResult<DelegateExternalToolResult>> {
      const argsJson = JSON.stringify(args);
      const decision = await deps.confirmation.request({
        toolId: DELEGATE_EXTERNAL_TOOL_ID,
        thread: ctx.thread,
        argsJson,
        argsPretty: prettifyArgs(argsJson),
        category: 'write',
        actionLabels: { allow: 'Prepare external agent request', deny: 'Deny' },
        disableAllowForThread: true,
      });
      if (decision === 'deny') {
        ctx.logger?.info('externalAgent.delegate.denied', { thread: ctx.thread });
        const data: DelegateExternalToolResult = {
          ok: false,
          error: { code: 'denied', message: 'User denied delegate_external' },
          folder: null,
          files: [],
        };
        // Surface the structured payload as `data` (ok at the wrapper level)
        // so the LLM observes the FR-EXT-03 / FR-EXT-24 shape verbatim.
        return { ok: true, data };
      }

      const start = deps.orchestrator.start({
        threadId: ctx.thread,
        originalAsk: args.ask,
        ...(args.refineBudget !== undefined ? { refineBudget: args.refineBudget } : {}),
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        ...(args.preferredAdapterId !== undefined
          ? { preferredAdapterId: args.preferredAdapterId }
          : {}),
      });

      if (!start.ok) {
        ctx.logger?.info('externalAgent.delegate.busy', {
          thread: ctx.thread,
          activeRunId: start.activeRunId,
        });
        const data: DelegateExternalToolResult = {
          ok: false,
          error: { code: 'busy', message: `slot busy: activeRunId=${start.activeRunId}` },
          folder: null,
          files: [],
        };
        return { ok: true, data };
      }

      deps.onHandle?.(start.handle);
      const onAbort = (): void => start.handle.cancel();
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const terminal = await start.terminal;
        return { ok: true, data: terminal };
      } finally {
        ctx.signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
