import { z } from 'zod';
import { parseCanvasJson, validateVaultRelativePath } from '@/agent/canvas/canvasJson';
import type { CanvasBbox, CanvasNavigatorWarning } from '@/editor/canvasNavigator';
import type { ToolCtx, ToolSpec } from '@/tools/types';
import { jsonSchemaFromZod, validateFromZod } from '@/tools/zodAdapter';

const BBOX_PADDING = 80;

export interface RevealInCanvasArgs {
  readonly path: string;
  readonly nodeIds?: readonly string[];
  readonly bbox?: CanvasBbox;
}

export interface RevealInCanvasResult {
  readonly path: string;
  readonly viewportApplied: boolean;
  readonly warning?: CanvasNavigatorWarning;
}

const BboxSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite(),
    h: z.number().finite(),
  })
  .strict()
  .describe('Explicit viewport rectangle. Takes precedence over nodeIds when both are supplied.');

const RevealInCanvasSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe('Vault-relative path to the canvas, e.g. "canvases/foo.canvas".'),
    nodeIds: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Optional list of canvas node ids. Their union bbox (padded) frames the viewport. Ignored when bbox is supplied. Unknown ids are skipped.',
      ),
    bbox: BboxSchema.optional(),
  })
  .strict();

export interface CreateRevealInCanvasToolOptions {
  readonly description?: string;
}

export function createRevealInCanvasTool(
  _opts: CreateRevealInCanvasToolOptions = {},
): ToolSpec<RevealInCanvasArgs, RevealInCanvasResult> {
  return {
    id: 'reveal_in_canvas',
    description:
      'Open a vault `.canvas` file and pan/zoom either to a supplied bbox or to the union bbox of `nodeIds`. Read-only. Allowed in plan mode.',
    schema: RevealInCanvasSchema,
    parameters: jsonSchemaFromZod(RevealInCanvasSchema),
    requiresConfirmation: false,
    isReadOnly: true,
    source: 'builtin',
    validate: validateFromZod(RevealInCanvasSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      if (ctx.canvasNavigator === undefined) {
        return { ok: false, error: 'canvas navigator unavailable' };
      }
      const pathCheck = validateVaultRelativePath(args.path);
      if (!pathCheck.ok) {
        return { ok: false, error: pathCheck.error.message };
      }
      const opened = await ctx.canvasNavigator.openCanvas(args.path);
      if (!opened.ok) return { ok: false, error: opened.error };

      let target: CanvasBbox | null = null;
      if (args.bbox !== undefined) {
        target = args.bbox;
      } else if (args.nodeIds !== undefined && args.nodeIds.length > 0) {
        const computed = await computeBboxFromNodeIds(ctx, args.path, args.nodeIds);
        target = computed;
      }

      if (target === null) {
        return { ok: true, data: { path: args.path, viewportApplied: false } };
      }

      const ok = ctx.canvasNavigator.panZoomToBbox(opened.leaf, target, BBOX_PADDING);
      if (!ok) {
        return {
          ok: true,
          data: {
            path: args.path,
            viewportApplied: false,
            warning: 'reveal_unsupported_in_this_obsidian_version',
          },
        };
      }
      return { ok: true, data: { path: args.path, viewportApplied: true } };
    },
  };
}

async function computeBboxFromNodeIds(
  ctx: ToolCtx,
  path: string,
  nodeIds: readonly string[],
): Promise<CanvasBbox | null> {
  let raw: string;
  try {
    raw = await ctx.vault.read(path);
  } catch {
    return null;
  }
  const parsed = parseCanvasJson(raw);
  if (!parsed.ok) return null;
  const ids = new Set(nodeIds);
  const matched = parsed.value.nodes.filter((n) => ids.has(n.id));
  if (matched.length === 0) return null;
  const missing = nodeIds.filter((id) => !parsed.value.nodes.some((n) => n.id === id));
  if (missing.length > 0) {
    ctx.logger?.debug('canvas.reveal.unknownNodeIds', { path, missing });
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of matched) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
