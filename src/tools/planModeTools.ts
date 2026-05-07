import { z } from 'zod';
import type { Logger } from '@/platform/Logger';
import type { PlanModeController } from '@/agent/planModeController';
import type { PlanApprovalController } from '@/agent/planApprovalController';
import type { PlanStore } from '@/storage/planStore';
import type { ToolSpec } from './types';
import { jsonSchemaFromZod, validateFromZod } from './zodAdapter';

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

export const ENTER_PLAN_MODE_DESCRIPTION = [
  'Enter plan mode for note-authoring tasks. While active, write tools (create_note, edit_note, append_to_note, create_folder, delegate_external) are blocked; only read-only exploration tools, TodoWrite, AskUserQuestion, and ExitPlanMode are allowed. Use ExitPlanMode to present your plan for user approval before any vault writes.',
  '',
  '## When to use',
  '',
  'Use ANY of these conditions to trigger plan mode:',
  '1. New multi-note structure — hub + linked notes, concept-MOC pair, templated set, dataview-driven index.',
  '2. Multiple valid structures — one deep note vs several connected notes; flat vs hierarchical; tag-driven vs folder-driven.',
  '3. Restructuring existing notes — moving sections to new notes, splitting, merging, retagging, link-graph reshape.',
  '4. Architectural decisions on linking strategy — MOC vs nested folders vs tag taxonomy vs frontmatter properties.',
  '5. The change touches more than 2–3 existing notes.',
  '6. Unclear scope — you need to explore the vault before designing.',
  '7. User preference matters and several reasonable structures exist.',
  '',
  '## When NOT to use',
  '',
  '- Single-line addition or correction in one existing note.',
  '- Creating one short note whose content the user already specified.',
  '- Pure information / Q&A about Obsidian or the vault contents.',
  '- The user gave very specific instructions ("create a note titled X with content Y").',
  '',
  '## What to do once in plan mode',
  '',
  '1. Explore the vault read-only with read_note, read_file, search_vault, list_notes, glob_vault, grep_vault, open_note, reveal_in_note, reveal_in_canvas.',
  '2. Inspect existing frontmatter, links, tags, headings, structure of relevant notes.',
  '3. Use AskUserQuestion if the structure depends on a user preference you cannot infer (flat vs hierarchical, MOC vs tag-driven, one deep note vs several connected notes). Provide 2–4 concrete options with one-line trade-offs.',
  '4. Design the structure: which notes to create, which to edit, link graph, headings, frontmatter, ordering of operations.',
  '5. Use TodoWrite if the planning itself has multiple sub-steps to track.',
  '6. Present the final plan markdown via ExitPlanMode for approval.',
  '7. Do NOT create or edit notes — write tools are blocked.',
  '',
  '## Examples',
  '',
  'GOOD — use EnterPlanMode:',
  '- "Set up a vault for my dissertation on consensus algorithms" — multi-note structure, taxonomy decisions.',
  '- "Reorganize my reading-notes folder into MOC + concept notes with backlinks" — restructure, link-graph reshape.',
  '- "Build a project hub with linked sub-notes for each phase" — hub + concept notes, multiple valid structures.',
  '- "Refactor my journal to extract recurring themes into concept notes and link from existing dailies" — touches many notes.',
  '',
  'BAD — skip EnterPlanMode:',
  '- "Fix typo in note X" — trivial single-line edit.',
  '- "Add tag #review to today\'s daily" — single trivial action.',
  '- "Search my vault for notes about Raft" — pure research, no authoring.',
  "- \"Create a quick scratch note titled 'Today's idea'\" — single short note with specified content.",
  '',
  'This tool requires no arguments. After it succeeds, a system reminder will tell you the path your plan file will be saved to on approval.',
].join('\n');

export const EXIT_PLAN_MODE_DESCRIPTION = [
  'Exit plan mode and present the proposed plan for user approval. Pass the full plan markdown as `plan`. The user will see it in an inline approval dialog with three outcomes: Approve, Edit (user can tweak the plan in-place), or Reject (mode stays in plan).',
  '',
  '## When to use',
  '',
  'Call this when ALL of:',
  '- The task involves authoring or restructuring notes (not pure research or Q&A).',
  '- The plan is concrete and unambiguous: file paths, headings, link graph, frontmatter, ordering of operations all decided.',
  '- You have no remaining questions for the user (use AskUserQuestion first if you do).',
  '',
  '## When NOT to use',
  '',
  '- Pure-research turns ("find notes about X"). Do not enter plan mode in the first place for those.',
  '- To ask "is the plan okay?" or "should I proceed?" — this tool IS the approval mechanism. Don\'t double-ask.',
  '- For *detail* clarifications — use AskUserQuestion instead.',
  '',
  '## How the plan is delivered',
  '',
  '- Pass the complete plan markdown as the `plan` argument. The approval dialog renders it as Markdown.',
  '- On approve, the plan is written to a file in the vault plans directory and the path is returned in the tool result.',
  "- On edit, the user's edited version is written to disk; the tool result indicates the plan was edited.",
  '- On reject, the tool returns an error and you remain in plan mode.',
  '- An empty/whitespace-only `plan` short-circuits with a generic exit message — only call with empty `plan` if the user explicitly asked to leave plan mode without a plan.',
  '',
  '## Examples',
  '',
  '1. Initial task: "Help me organize my reading notes" — use ExitPlanMode after deciding the structure.',
  '2. Initial task: "Search my vault for notes about consensus algorithms" — do NOT use; this is pure research with no authoring step.',
  '3. Initial task: "Set up a vault for my dissertation" — if the structure is ambiguous, use AskUserQuestion first; then ExitPlanMode after the user picks.',
].join('\n');

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
