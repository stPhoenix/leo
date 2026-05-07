import { z } from 'zod';
import type { ConfirmationController } from '@/agent/confirmationController';
import { jsonSchemaFromZod } from '@/tools/zodAdapter';
import type { ToolResult, ToolSpec } from '@/tools/types';
import type { CanvasOrchestrator } from '../orchestrator';
import { validateVaultRelativePath } from '../canvasJson';
import { PRESET_IDS, type PresetId } from '../schemas';
import { readSidecar } from '../sidecar';
import { tryParseCurrentCanvas, buildTombstoneSummary } from '../diff';
import type { CanvasToolResult } from '../runPhase';
import { runCanvasConfirmFlow } from './canvasToolFlow';

export const DELEGATE_CANVAS_CONTENT_EDIT_TOOL_ID = 'delegate_canvas_content_edit';

const INSTRUCTION_HARD_LIMIT_CHARS = 16_384;

export interface DelegateCanvasContentEditArgs {
  readonly path: string;
  readonly instruction: string;
  readonly layoutAlgo?: PresetId;
}

const Schema: z.ZodType<DelegateCanvasContentEditArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe(
        'Vault-relative `.canvas` path of the existing canvas to edit. Must end in `.canvas` and not contain traversal segments.',
      ),
    instruction: z
      .string()
      .min(1, 'instruction must be a non-empty string')
      .max(
        INSTRUCTION_HARD_LIMIT_CHARS,
        `instruction exceeds hard limit (${INSTRUCTION_HARD_LIMIT_CHARS} chars)`,
      )
      .describe(
        'Free-form description of the content edit (e.g. "add the team led by Alice"). Refine sub-agent will rewrite into a structured run plan.',
      ),
    layoutAlgo: z
      .enum(PRESET_IDS)
      .optional()
      .describe(
        `Optional layout preset hint. One of ${PRESET_IDS.join(', ')}. If omitted, layout reuses sidecar coords + auto-selects for new nodes.`,
      ),
  })
  .strict() as unknown as z.ZodType<DelegateCanvasContentEditArgs>;

export interface DelegateCanvasContentEditDeps {
  readonly orchestrator: CanvasOrchestrator;
  readonly confirmation: ConfirmationController;
}

const DESCRIPTION = [
  'Edit an existing Obsidian `.canvas` file: add, remove, relabel entities/relations, or change types.',
  '',
  'Use this tool when the user wants to modify a canvas that already exists. The diff pipeline preserves manual layout (locked positions are kept), records tombstones for deleted nodes, and threads tombstones into refine so re-asking for a deleted item triggers a confirmation prompt.',
  '',
  'Every call requires explicit user approval. The tool resolves with the canvas path, insights, and partial state on cancel/error.',
].join('\n');

export function createDelegateCanvasContentEditTool(
  deps: DelegateCanvasContentEditDeps,
): ToolSpec<DelegateCanvasContentEditArgs, CanvasToolResult> {
  return {
    id: DELEGATE_CANVAS_CONTENT_EDIT_TOOL_ID,
    description: DESCRIPTION,
    schema: Schema,
    parameters: jsonSchemaFromZod(Schema),
    requiresConfirmation: true,
    source: 'builtin',
    shouldDefer: true,
    validate(raw): ToolResult<DelegateCanvasContentEditArgs> {
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
        toolId: DELEGATE_CANVAS_CONTENT_EDIT_TOOL_ID,
        orchestrator: deps.orchestrator,
        confirmation: deps.confirmation,
        ctx,
        args,
        allowLabel: 'Prepare canvas edit',
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
          if (!parseRes.ok) {
            return {
              ok: false,
              error: { code: 'canvas_parse_failed', message: parseRes.error.message },
            };
          }
          // Tombstone summary used by refine via subgraph deps; subgraph
          // builds it internally from `initialSidecar`. We compute here only
          // for log visibility — actual threading lives in subgraph.
          const tombstoneSummary = buildTombstoneSummary(
            sidecar.tombstones,
            sidecar.edgeTombstones,
            sidecar,
          );
          ctx.logger?.debug('canvas.contentEdit.tombstoneSummary', {
            thread: ctx.thread,
            path: args.path,
            tombstoneSummaryLen: tombstoneSummary.length,
          });
          return {
            ok: true,
            input: {
              threadId: ctx.thread,
              op: 'content_edit',
              originalAsk: args.instruction,
              targetPath: args.path,
              editInstruction: args.instruction,
              initialSidecar: sidecar,
              ...(args.layoutAlgo !== undefined ? { layoutAlgo: args.layoutAlgo } : {}),
            },
          };
        },
      });
    },
  };
}
