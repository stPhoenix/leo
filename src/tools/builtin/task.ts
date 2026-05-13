import { z } from 'zod';
import type { ConfirmationController } from '@/agent/confirmationController';
import { prettifyArgs } from '@/agent/confirmationController';
import type { TaskOrchestrator, TaskRunHandle, TaskToolResult } from '@/agent/task/orchestrator';
import { TASK_LOG } from '@/agent/task/loggingNamespaces';
import { TASK_TOOL_DESCRIPTION } from '@/prompts/tools/builtin/taskDescription';
import type { ToolResult, ToolSpec } from '../types';
import { jsonSchemaFromZod } from '../zodAdapter';

export const TASK_TOOL_ID = 'task';

const PROMPT_HARD_LIMIT_CHARS = 16_384;
const SUMMARY_INSTRUCTIONS_LIMIT = 2_048;
const TIMEOUT_HARD_LIMIT_MS = 30 * 60_000;

export interface TaskArgs {
  readonly prompt: string;
  readonly summaryInstructions?: string;
  readonly timeoutMs?: number;
}

const TaskArgsSchema: z.ZodType<TaskArgs> = z
  .object({
    prompt: z
      .string()
      .min(1, 'prompt must be a non-empty string')
      .max(PROMPT_HARD_LIMIT_CHARS, `prompt exceeds hard limit (${PROMPT_HARD_LIMIT_CHARS} chars)`)
      .describe(
        'Self-contained instruction for the subagent. Restate every fact, file path, and constraint — the subagent sees none of this conversation. Describe the desired outcome and final-summary shape, not the steps.',
      ),
    summaryInstructions: z
      .string()
      .min(1)
      .max(SUMMARY_INSTRUCTIONS_LIMIT)
      .optional()
      .describe(
        'Optional shape constraint for the subagent\'s final answer (e.g. "bullet list of paths", "JSON {path, score}[]"). Defaults to free-form prose.',
      ),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(TIMEOUT_HARD_LIMIT_MS)
      .optional()
      .describe('Wall-clock cap for the subagent run in ms. Defaults to 600_000 (10 min).'),
  })
  .strict() as unknown as z.ZodType<TaskArgs>;

export interface TaskToolDeps {
  readonly orchestrator: TaskOrchestrator;
  readonly confirmation: ConfirmationController;
  /**
   * Called once per run after the subgraph kicks off. Hosts wire the
   * controller into the live registry and append the chat widget row.
   * Forwarded from `TaskOrchestratorDeps.onHandle` — exposed here so tests
   * can verify wiring without constructing an orchestrator.
   */
  readonly onHandle?: (handle: TaskRunHandle) => void;
}

export function createTaskTool(deps: TaskToolDeps): ToolSpec<TaskArgs, TaskToolResult> {
  return {
    id: TASK_TOOL_ID,
    description: TASK_TOOL_DESCRIPTION,
    schema: TaskArgsSchema,
    parameters: jsonSchemaFromZod(TaskArgsSchema),
    requiresConfirmation: false,
    source: 'builtin',
    shouldDefer: false,
    validate(raw): ToolResult<TaskArgs> {
      const parsed = TaskArgsSchema.safeParse(raw);
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
    async invoke(args, ctx): Promise<ToolResult<TaskToolResult>> {
      const argsJson = JSON.stringify(args);
      const decision = await deps.confirmation.request({
        toolId: TASK_TOOL_ID,
        thread: ctx.thread,
        argsJson,
        argsPretty: prettifyArgs(argsJson),
        category: 'write',
        actionLabels: { allow: 'Spawn subagent', deny: 'Deny' },
        disableAllowForThread: true,
      });
      if (decision === 'deny') {
        ctx.logger?.info(TASK_LOG.denied, { thread: ctx.thread });
        return {
          ok: true,
          data: {
            ok: false,
            runId: '',
            summary: '',
            toolCallsCount: 0,
            durationMs: 0,
            error: { code: 'denied', message: 'User denied task subagent' },
          },
        };
      }

      const start = deps.orchestrator.start({
        parentThreadId: ctx.thread,
        prompt: args.prompt,
        ...(args.summaryInstructions !== undefined
          ? { summaryInstructions: args.summaryInstructions }
          : {}),
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        signal: ctx.signal,
      });

      if (!start.ok) {
        ctx.logger?.info(TASK_LOG.busy, {
          thread: ctx.thread,
          activeRunIds: start.activeRunIds,
        });
        return {
          ok: true,
          data: {
            ok: false,
            runId: '',
            summary: '',
            toolCallsCount: 0,
            durationMs: 0,
            error: {
              code: 'busy',
              message: `too many concurrent task subagents: ${start.activeRunIds.length}`,
            },
          },
        };
      }

      deps.onHandle?.(start.handle);

      const invokedAt = Date.now();
      const onAbort = (): void => {
        ctx.logger?.warn(TASK_LOG.ctxSignalAborted, {
          thread: ctx.thread,
          runId: start.handle.runId,
          elapsedMs: Date.now() - invokedAt,
        });
        start.handle.cancel();
      };
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const terminal = await start.handle.terminal;
        return { ok: true, data: terminal };
      } finally {
        ctx.signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
