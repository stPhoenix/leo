import type { Logger } from '@/platform/Logger';
import type { PlanModeController } from '@/agent/planModeController';
import type { PlanApprovalController } from '@/agent/planApprovalController';
import type { PlanStore } from '@/storage/planStore';
import type { ToolSpec } from './types';

export interface EnterPlanModeArgs {
  readonly reason?: string;
}

export interface EnterPlanModeResult {
  readonly mode: 'plan';
}

export interface ExitPlanModeArgs {
  readonly plan: string;
}

export interface ExitPlanModeResult {
  readonly mode: 'normal';
  readonly message: string;
  readonly planWasEdited?: boolean;
}

export const ENTER_PLAN_MODE_DESCRIPTION =
  'Enter plan mode. While active, only read-only tools may be invoked. Use this when the user requests a plan before writes. Exit with ExitPlanMode carrying the final plan text.';

export const EXIT_PLAN_MODE_DESCRIPTION =
  'Exit plan mode and persist the proposed plan. Pass the full plan markdown as `plan`; it will be written to the vault plans directory and presented to the user for approval.';

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
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Optional short reason for entering plan mode.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    requiresConfirmation: false,
    source: 'builtin',
    validate(raw) {
      if (raw === null || raw === undefined) return { ok: true, data: {} };
      if (typeof raw !== 'object') return { ok: false, error: 'args must be object' };
      const obj = raw as Record<string, unknown>;
      if (obj.reason !== undefined && typeof obj.reason !== 'string')
        return { ok: false, error: 'reason must be string' };
      return { ok: true, data: obj.reason === undefined ? {} : { reason: obj.reason } };
    },
    async invoke(_args, ctx) {
      if (!isMainAgent(ctx.agentId)) {
        opts.controller.recordSubagentReject(ctx.thread, 'EnterPlanMode');
        return { ok: false, error: 'plan mode forbidden in subagent' };
      }
      opts.controller.enterPlan(ctx.thread);
      return { ok: true, data: { mode: 'plan' } };
    },
  };
}

export function createExitPlanModeTool(
  opts: ExitPlanModeOptions,
): ToolSpec<ExitPlanModeArgs, ExitPlanModeResult> {
  return {
    id: 'ExitPlanMode',
    description: EXIT_PLAN_MODE_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        plan: {
          type: 'string',
          description:
            'The plan markdown to present for approval. Will be written to the vault on approve or edit before mode flips back to normal.',
        },
      },
      required: ['plan'],
      additionalProperties: false,
    },
    requiresConfirmation: false,
    source: 'builtin',
    validate(raw) {
      if (raw === null || typeof raw !== 'object')
        return { ok: false, error: 'args must be object' };
      const obj = raw as Record<string, unknown>;
      if (typeof obj.plan !== 'string') return { ok: false, error: 'plan must be a string' };
      return { ok: true, data: { plan: obj.plan } };
    },
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
        await opts.planStore.writePlan(outcome.plan);
        opts.controller.exitPlan(threadId);
        opts.logger?.info('plan.approval.edit', { threadId, planWasEdited: true });
        return {
          ok: true,
          data: {
            mode: 'normal',
            message: `## Approved Plan (edited by user):\n${outcome.plan}`,
            planWasEdited: true,
          },
        };
      }
      // approve
      opts.controller.exitPlan(threadId);
      opts.logger?.info('plan.approval.approve', { threadId, planWasEdited: false });
      return {
        ok: true,
        data: {
          mode: 'normal',
          message: `## Approved Plan:\n${outcome.plan}`,
          planWasEdited: false,
        },
      };
    },
  };
}

function isMainAgent(agentId: string | null | undefined): boolean {
  return agentId === null || agentId === undefined;
}
