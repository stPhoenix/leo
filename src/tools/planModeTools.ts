import { z } from 'zod';
import type { Logger } from '@/platform/Logger';
import type { PlanModeController } from '@/agent/planModeController';
import type { PlanApprovalController } from '@/agent/planApprovalController';
import type { PlanStore } from '@/storage/planStore';
import type { ToolSpec } from './types';
import { jsonSchemaFromZod, validateFromZod } from './zodAdapter';
import {
  ENTER_PLAN_MODE_DESCRIPTION,
  EXIT_PLAN_MODE_DESCRIPTION,
} from '@/prompts/tools/planModeDescriptions';

const EnterPlanModeSchema: z.ZodType<{ reason?: string }> = z
  .object({
    reason: z.string().optional().describe('Optional short reason for entering plan mode.'),
  })
  .strict();

const ExitPlanModeSchema: z.ZodType<{ plan: string }> = z
  .object({
    plan: z
      .string({ error: 'plan must be a string' })
      .describe(
        'The plan markdown to present for approval. Will be written to the vault on approve or edit before mode flips back to normal.',
      ),
  })
  .strict();

export interface EnterPlanModeArgs {
  readonly reason?: string;
}

export interface EnterPlanModeResult {
  readonly mode: 'plan';
  readonly planFilePath: string;
}

export interface ExitPlanModeArgs {
  readonly plan: string;
}

export interface ExitPlanModeResult {
  readonly mode: 'normal';
  readonly message: string;
  readonly planWasEdited?: boolean;
  readonly planFilePath?: string;
}

export const PLAN_APPROVAL_CASE_2_MESSAGE =
  'User has approved the plan. There is nothing else needed from you now. Please respond with "ok"';

export const PLAN_APPROVAL_CASE_3_MESSAGE =
  'User has approved exiting plan mode. You can now proceed.';

export class PlanApprovalRejected extends Error {
  override readonly name = 'PlanApprovalRejected';
}

export interface PlanModeToolsOptions {
  readonly controller: PlanModeController;
  readonly planStore: PlanStore;
  readonly logger?: Logger;
}

export interface ExitPlanModeOptions extends PlanModeToolsOptions {
  readonly approval: PlanApprovalController;
}

export function createEnterPlanModeTool(
  opts: PlanModeToolsOptions,
): ToolSpec<EnterPlanModeArgs, EnterPlanModeResult> {
  return {
    id: 'EnterPlanMode',
    description: ENTER_PLAN_MODE_DESCRIPTION,
    schema: EnterPlanModeSchema,
    parameters: jsonSchemaFromZod(EnterPlanModeSchema),
    requiresConfirmation: false,
    isReadOnly: true,
    source: 'builtin',
    validate(raw) {
      if (raw === null || raw === undefined) return { ok: true, data: {} };
      return validateFromZod(EnterPlanModeSchema)(raw);
    },
    async invoke(_args, ctx) {
      if (!isMainAgent(ctx.agentId)) {
        opts.controller.recordSubagentReject(ctx.thread, 'EnterPlanMode');
        return { ok: false, error: 'plan mode forbidden in subagent' };
      }
      const slug = await opts.planStore.currentSlug(ctx.thread);
      const planFilePath = opts.planStore.planPath(slug);
      opts.controller.enterPlan(ctx.thread, planFilePath);
      return { ok: true, data: { mode: 'plan', planFilePath } };
    },
  };
}

export function createExitPlanModeTool(
  opts: ExitPlanModeOptions,
): ToolSpec<ExitPlanModeArgs, ExitPlanModeResult> {
  return {
    id: 'ExitPlanMode',
    description: EXIT_PLAN_MODE_DESCRIPTION,
    schema: ExitPlanModeSchema,
    parameters: jsonSchemaFromZod(ExitPlanModeSchema),
    requiresConfirmation: false,
    source: 'builtin',
    validate: validateFromZod(ExitPlanModeSchema),
    async invoke(args, ctx) {
      const threadId = ctx.thread;
      const isSubagent = !isMainAgent(ctx.agentId);
      // Case 2 — subagent context short-circuits to the "already approved" payload
      // per plan.md §5.8; no dialog, no writePlan, no mode flip.
      if (isSubagent) {
        opts.logger?.info('plan.approval.request', {
          threadId,
          isSubagent: true,
          planLength: args.plan.length,
        });
        return { ok: true, data: { mode: 'normal', message: PLAN_APPROVAL_CASE_2_MESSAGE } };
      }
      // Case 3 — empty/whitespace-only plan short-circuits to the generic exit payload;
      // no dialog mount, no writePlan call, but the mode flag still flips back to normal.
      if (args.plan.trim().length === 0) {
        opts.controller.exitPlan(threadId);
        return { ok: true, data: { mode: 'normal', message: PLAN_APPROVAL_CASE_3_MESSAGE } };
      }
      // Case 1 — main agent + non-empty plan: present the approval dialog.
      opts.logger?.info('plan.approval.request', {
        threadId,
        isSubagent: false,
        planLength: args.plan.length,
      });
      const outcome = await opts.approval.present({
        plan: args.plan,
        threadId,
        isSubagent: false,
      });
      if (outcome.type === 'reject') {
        opts.logger?.info('plan.approval.reject', { threadId });
        return { ok: false, error: 'plan approval rejected' };
      }
      if (outcome.type === 'edit') {
        const planFilePath = await opts.planStore.writePlan(threadId, outcome.plan);
        opts.controller.exitPlan(threadId);
        opts.logger?.info('plan.approval.edit', { threadId, planWasEdited: true, planFilePath });
        return {
          ok: true,
          data: {
            mode: 'normal',
            message: buildApprovedPlanMessage({
              plan: outcome.plan,
              planFilePath,
              planWasEdited: true,
            }),
            planWasEdited: true,
            planFilePath,
          },
        };
      }
      // approve
      const planFilePath = await opts.planStore.writePlan(threadId, outcome.plan);
      opts.controller.exitPlan(threadId);
      opts.logger?.info('plan.approval.approve', {
        threadId,
        planWasEdited: false,
        planFilePath,
      });
      return {
        ok: true,
        data: {
          mode: 'normal',
          message: buildApprovedPlanMessage({
            plan: outcome.plan,
            planFilePath,
            planWasEdited: false,
          }),
          planWasEdited: false,
          planFilePath,
        },
      };
    },
  };
}

interface ApprovedPlanMessageInput {
  readonly plan: string;
  readonly planFilePath: string;
  readonly planWasEdited: boolean;
}

export function buildApprovedPlanMessage(input: ApprovedPlanMessageInput): string {
  const header = input.planWasEdited ? '## Approved Plan (edited by user):' : '## Approved Plan:';
  return [
    'User has approved your plan. You can now start with the note authoring. Update your todo list if applicable.',
    '',
    `Your plan has been saved to: ${input.planFilePath}`,
    'You can refer back to it during implementation.',
    '',
    header,
    input.plan,
  ].join('\n');
}

function isMainAgent(agentId: string | null | undefined): boolean {
  return agentId === null || agentId === undefined;
}
