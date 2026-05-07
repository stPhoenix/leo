import { z } from 'zod';
import { Insights } from '@/agent/canvas/schemas';
import type { CanvasViewModel } from './widgetState';

export const CANVAS_TERMINAL_KIND = 'canvas_terminal';

const CanvasFailedSourceSchema = z.object({
  ref: z.string(),
  code: z.string(),
  message: z.string(),
});

const CanvasErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const CanvasTerminalSnapshotSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  runId: z.string(),
  threadId: z.string(),
  op: z.enum(['create', 'content_edit', 'layout_edit']),
  outcome: z.enum(['done', 'cancelled', 'error']),
  phaseAtTerminal: z.string(),
  targetPath: z.string(),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  insights: Insights.optional(),
  error: CanvasErrorPayloadSchema.optional(),
  failedSources: z.array(CanvasFailedSourceSchema).default([]),
  nodeCount: z.number().int().nonnegative().default(0),
  edgeCount: z.number().int().nonnegative().default(0),
  paletteId: z.string().optional(),
});

export type CanvasTerminalSnapshot = z.infer<typeof CanvasTerminalSnapshotSchema>;

export interface BuildCanvasTerminalSnapshotInput {
  readonly view: CanvasViewModel;
  readonly nodeCount?: number;
  readonly edgeCount?: number;
  readonly now?: number;
}

export function buildCanvasTerminalSnapshot(
  input: BuildCanvasTerminalSnapshotInput,
): CanvasTerminalSnapshot {
  const { view } = input;
  const outcome: 'done' | 'cancelled' | 'error' =
    view.phase === 'done' || view.phase === 'cancelled' || view.phase === 'error'
      ? view.phase
      : 'error';
  const durationMs =
    view.startedAt !== null && view.endedAt !== null && view.endedAt >= view.startedAt
      ? view.endedAt - view.startedAt
      : 0;
  const createdAt = input.now ?? Date.now();

  return CanvasTerminalSnapshotSchema.parse({
    schemaVersion: 1,
    runId: view.runId,
    threadId: view.threadId,
    op: view.op,
    outcome,
    phaseAtTerminal: view.phase,
    targetPath: view.targetPath,
    durationMs,
    createdAt,
    insights: view.insights,
    error: view.error ?? undefined,
    failedSources: (view.failedSources ?? []).map((f) => ({
      ref: f.ref,
      code: f.code,
      message: f.message,
    })),
    nodeCount: input.nodeCount ?? 0,
    edgeCount: input.edgeCount ?? 0,
    ...(view.paletteId !== undefined ? { paletteId: view.paletteId } : {}),
  } satisfies Partial<CanvasTerminalSnapshot>);
}

export function tryParseCanvasTerminalSnapshot(raw: unknown): CanvasTerminalSnapshot | null {
  const parsed = CanvasTerminalSnapshotSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
