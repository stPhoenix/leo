import { z } from 'zod';
import type { ConfirmationController } from '@/agent/confirmationController';
import { jsonSchemaFromZod } from '@/tools/zodAdapter';
import type { ToolResult, ToolSpec } from '@/tools/types';
import type { CanvasOrchestrator } from '../orchestrator';
import { validateVaultRelativePath } from '../canvasJson';
import { PRESET_IDS, type PresetId } from '../schemas';
import type { CanvasToolResult } from '../runPhase';
import { runCanvasConfirmFlow } from './canvasToolFlow';

export const DELEGATE_CANVAS_CREATE_TOOL_ID = 'delegate_canvas_create';

const ASK_HARD_LIMIT_CHARS = 16_384;

export interface DelegateCanvasCreateArgs {
  readonly ask: string;
  readonly targetPath?: string;
  readonly layoutAlgo?: PresetId;
}

const DelegateCanvasCreateSchema: z.ZodType<DelegateCanvasCreateArgs> = z
  .object({
    ask: z
      .string()
      .min(1, 'ask must be a non-empty string')
      .max(ASK_HARD_LIMIT_CHARS, `ask exceeds hard limit (${ASK_HARD_LIMIT_CHARS} chars)`)
      .describe(
        'Free-form description of the canvas to build. Refine sub-agent will turn this into a structured run plan (entity types, relation types, source hints) before extraction begins. Describe the desired insight, not the procedure.',
      ),
    targetPath: z
      .string()
      .optional()
      .describe(
        'Optional vault-relative `.canvas` path to write. If omitted, refine derives from the ask. Must end in `.canvas` and not contain traversal segments.',
      ),
    layoutAlgo: z
      .enum(PRESET_IDS)
      .optional()
      .describe(
        `Optional layout preset hint. One of ${PRESET_IDS.join(', ')}. If omitted, auto-selected from graph shape.`,
      ),
  })
  .strict() as unknown as z.ZodType<DelegateCanvasCreateArgs>;

export interface DelegateCanvasCreateDeps {
  readonly orchestrator: CanvasOrchestrator;
  readonly confirmation: ConfirmationController;
}

const DELEGATE_CANVAS_CREATE_DESCRIPTION = [
  'Create a new Obsidian `.canvas` file by extracting entities + relations from sources and laying them out visually.',
  '',
  'Use this tool when the user asks for a graph, map, diagram, or visual overview synthesised from notes, URLs, attachments, or this conversation. Suitable for org charts, knowledge graphs, timelines, hub-and-spoke topic maps.',
  '',
  'Every call requires explicit user approval — there is no per-thread allowlist. The user picks the layout preset and target path before the run begins. Expect a refine sub-agent to ask clarifying questions when the ask is ambiguous; phrase the ask as an outcome, not a procedure.',
  '',
  'On approval, the run streams through an inline widget showing fetch / extract / reduce / layout / preview phases. The tool resolves with the canvas path and graph insights when the user approves the preview.',
].join('\n');

export function createDelegateCanvasCreateTool(
  deps: DelegateCanvasCreateDeps,
): ToolSpec<DelegateCanvasCreateArgs, CanvasToolResult> {
  return {
    id: DELEGATE_CANVAS_CREATE_TOOL_ID,
    description: DELEGATE_CANVAS_CREATE_DESCRIPTION,
    schema: DelegateCanvasCreateSchema,
    parameters: jsonSchemaFromZod(DelegateCanvasCreateSchema),
    requiresConfirmation: true,
    source: 'builtin',
    shouldDefer: false,
    validate(raw): ToolResult<DelegateCanvasCreateArgs> {
      const parsed = DelegateCanvasCreateSchema.safeParse(raw);
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
      if (parsed.data.targetPath !== undefined) {
        const pathCheck = validateVaultRelativePath(parsed.data.targetPath);
        if (!pathCheck.ok) {
          return { ok: false, error: `targetPath: ${pathCheck.error.message}` };
        }
      }
      return { ok: true, data: parsed.data };
    },
    async invoke(args, ctx): Promise<ToolResult<CanvasToolResult>> {
      return runCanvasConfirmFlow({
        toolId: DELEGATE_CANVAS_CREATE_TOOL_ID,
        orchestrator: deps.orchestrator,
        confirmation: deps.confirmation,
        ctx,
        args,
        allowLabel: 'Prepare canvas create',
        buildStartInput: () => ({
          ok: true,
          input: {
            threadId: ctx.thread,
            op: 'create',
            originalAsk: args.ask,
            ...(args.targetPath !== undefined ? { targetPath: args.targetPath } : {}),
            ...(args.layoutAlgo !== undefined ? { layoutAlgo: args.layoutAlgo } : {}),
          },
        }),
      });
    },
  };
}
