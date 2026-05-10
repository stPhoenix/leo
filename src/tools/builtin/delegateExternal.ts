import { z } from 'zod';
import type { ConfirmationController } from '@/agent/confirmationController';
import { prettifyArgs } from '@/agent/confirmationController';
import type { ExternalAgentOrchestrator } from '@/agent/externalAgent/orchestrator';
import type { DelegateExternalToolResult } from '@/agent/externalAgent/runPhase';
import type { RunHandle } from '@/agent/externalAgent/subgraph';
import type { ToolResult, ToolSpec } from '../types';
import { jsonSchemaFromZod } from '../zodAdapter';
import { DELEGATE_EXTERNAL_DESCRIPTION } from '@/prompts/tools/builtin/delegateExternalDescription';

export const DELEGATE_EXTERNAL_TOOL_ID = 'delegate_external';

const ASK_HARD_LIMIT_CHARS = 16_384;

export interface DelegateExternalArgs {
  readonly ask: string;
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
        'The original user ask to escalate. The refine sub-agent will turn this into a self-contained prompt before sending to the external agent. The adapter has no access to the vault, your tools, this conversation, or the local filesystem — describe the desired outcome and output shape, not the steps or commands to take.',
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
    shouldDefer: true,
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
      const invokedAt = Date.now();
      const onAbort = (): void => {
        ctx.logger?.warn('externalAgent.delegate.ctxSignal.aborted', {
          thread: ctx.thread,
          runId: start.handle.runId,
          elapsedMs: Date.now() - invokedAt,
          reason:
            (ctx.signal as AbortSignal & { reason?: unknown }).reason instanceof Error
              ? (
                  (ctx.signal as AbortSignal & { reason?: { message: string } }).reason as {
                    message: string;
                  }
                ).message
              : String((ctx.signal as AbortSignal & { reason?: unknown }).reason ?? 'unknown'),
        });
        start.handle.cancel();
      };
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
