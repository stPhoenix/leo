import { z } from 'zod';
import type { TaskViewModel } from './widgetState';

const ErrorCodeSchema = z.enum([
  'cancelled',
  'timeout',
  'no_summary',
  'graph_throw',
  'reload',
  'busy',
  'denied',
]);

export const TaskTerminalSnapshotSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  runId: z.string(),
  threadId: z.string(),
  prompt: z.string(),
  terminalPhase: z.enum(['done', 'cancelled', 'error']),
  durationMs: z.number().int().nonnegative(),
  toolCallsCount: z.number().int().nonnegative(),
  lastToolId: z.string().nullable(),
  summary: z.string().nullable(),
  error: z.object({ code: ErrorCodeSchema, message: z.string() }).nullable(),
});

export type TaskTerminalSnapshot = z.infer<typeof TaskTerminalSnapshotSchema>;

export interface BuildTaskSnapshotInput {
  readonly view: TaskViewModel;
}

export function buildTaskTerminalSnapshot(input: BuildTaskSnapshotInput): TaskTerminalSnapshot {
  const { view } = input;
  const terminalPhase: 'done' | 'cancelled' | 'error' =
    view.phase === 'done' || view.phase === 'cancelled' || view.phase === 'error'
      ? view.phase
      : 'error';
  const durationMs =
    view.startedAt !== null && view.endedAt !== null && view.endedAt >= view.startedAt
      ? view.endedAt - view.startedAt
      : 0;
  return TaskTerminalSnapshotSchema.parse({
    schemaVersion: 1,
    runId: view.runId,
    threadId: view.threadId,
    prompt: view.prompt,
    terminalPhase,
    durationMs,
    toolCallsCount: view.toolCallsCount,
    lastToolId: view.lastToolId,
    summary: view.summary,
    error: view.error,
  } satisfies Partial<TaskTerminalSnapshot>);
}

export function tryParseTaskTerminalSnapshot(raw: unknown): TaskTerminalSnapshot | null {
  const parsed = TaskTerminalSnapshotSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
