import { z } from 'zod';
import type { ConfirmationController } from '@/agent/confirmationController';
import { jsonSchemaFromZod } from '@/tools/zodAdapter';
import type { ToolResult, ToolSpec } from '@/tools/types';
import type { CanvasOrchestrator } from '../orchestrator';
import { validateVaultRelativePath } from '../canvasJson';
import { PRESET_IDS } from '../schemas';
import type { LayoutHint } from '../layouts';
import { readSidecar } from '../sidecar';
import { tryParseCurrentCanvas } from '../diff';
import type { CanvasToolResult } from '../runPhase';
import { runCanvasConfirmFlow } from './canvasToolFlow';

export const DELEGATE_CANVAS_LAYOUT_EDIT_TOOL_ID = 'delegate_canvas_layout_edit';

const INSTRUCTION_HARD_LIMIT_CHARS = 4_096;

const LayoutHintSchema = z.enum([...PRESET_IDS, 'auto']);

export interface DelegateCanvasLayoutEditArgs {
  readonly path: string;
  readonly layoutAlgo: LayoutHint;
  readonly instruction?: string;
}

const Schema: z.ZodType<DelegateCanvasLayoutEditArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe(
        'Vault-relative `.canvas` path to relayout. Must end in `.canvas` and not contain traversal segments.',
      ),
    layoutAlgo: LayoutHintSchema.describe(
      `Layout preset to apply. One of ${PRESET_IDS.join(', ')}, or 'auto' to let the engine pick from graph shape.`,
    ),
    instruction: z
      .string()
      .min(1)
      .max(
        INSTRUCTION_HARD_LIMIT_CHARS,
        `instruction exceeds hard limit (${INSTRUCTION_HARD_LIMIT_CHARS} chars)`,
      )
      .optional()
      .describe(
        'Optional free-form note about what the user wants from the relayout. Recorded for traceability; does not invoke refine.',
      ),
  })
  .strict() as unknown as z.ZodType<DelegateCanvasLayoutEditArgs>;

export interface DelegateCanvasLayoutEditDeps {
  readonly orchestrator: CanvasOrchestrator;
  readonly confirmation: ConfirmationController;
}

const DESCRIPTION = [
  'Relayout an existing Obsidian `.canvas` file with a new preset (or auto-pick), preserving entities/edges and any nodes the user has manually moved.',
  '',
  'Use this tool when the user wants to change the visual arrangement only — no schema changes, no new entities. The pipeline skips planning/fetching/extraction/reduction/diffing and runs only LAYING_OUT → PREVIEWING → WRITING.',
  '',
  'Every call requires explicit user approval. Resolves with the canvas path on DONE; busy/cancel/error variants per the canvas tool result shape.',
].join('\n');

export function createDelegateCanvasLayoutEditTool(
  deps: DelegateCanvasLayoutEditDeps,
): ToolSpec<DelegateCanvasLayoutEditArgs, CanvasToolResult> {
  return {
    id: DELEGATE_CANVAS_LAYOUT_EDIT_TOOL_ID,
    description: DESCRIPTION,
    schema: Schema,
    parameters: jsonSchemaFromZod(Schema),
    requiresConfirmation: true,
    source: 'builtin',
    shouldDefer: true,
    validate(raw): ToolResult<DelegateCanvasLayoutEditArgs> {
      const parsed = Schema.safeParse(raw);
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
      const pathCheck = validateVaultRelativePath(parsed.data.path);
      if (!pathCheck.ok) {
        return { ok: false, error: `path: ${pathCheck.error.message}` };
      }
      return { ok: true, data: parsed.data };
    },
    async invoke(args, ctx): Promise<ToolResult<CanvasToolResult>> {
      return runCanvasConfirmFlow({
        toolId: DELEGATE_CANVAS_LAYOUT_EDIT_TOOL_ID,
        orchestrator: deps.orchestrator,
        confirmation: deps.confirmation,
        ctx,
        args,
        allowLabel: 'Prepare canvas relayout',
        buildStartInput: async () => {
          const sidecarRes = await readSidecar(
            { adapter: ctx.vault, ...(ctx.logger !== undefined ? { logger: ctx.logger } : {}) },
            args.path,
          );
          if (!sidecarRes.ok) {
            return {
              ok: false,
              error: { code: 'sidecar_corrupt', message: sidecarRes.error.message },
            };
          }
          const sidecar = sidecarRes.value;
          if (sidecar === null) {
            return {
              ok: false,
              error: { code: 'sidecar_missing', message: `no sidecar for ${args.path}` },
            };
          }
          const parseRes = await tryParseCurrentCanvas(ctx.vault, args.path);
          const initialCanvasJson = parseRes.ok ? parseRes.value : null;
          return {
            ok: true,
            input: {
              threadId: ctx.thread,
              op: 'layout_edit',
              originalAsk: args.instruction ?? `relayout ${args.path} as ${args.layoutAlgo}`,
              targetPath: args.path,
              layoutAlgo: args.layoutAlgo,
              initialSidecar: sidecar,
              ...(initialCanvasJson !== null ? { initialCanvasJson } : {}),
              ...(args.instruction !== undefined ? { editInstruction: args.instruction } : {}),
            },
          };
        },
      });
    },
  };
}
