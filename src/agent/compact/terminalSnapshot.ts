import { z } from 'zod';
import type { CompactViewModel } from './widgetState';

export const COMPACT_TERMINAL_KIND = 'compact_terminal';

const ErrorCodeSchema = z.enum([
  'no_stream',
  'no_summary',
  'prompt_too_long',
  'circuit_broken',
  'aborted',
  'empty_history',
  'reload',
  'unknown',
]);

export const CompactTerminalSnapshotSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  runId: z.string(),
  threadId: z.string(),
  trigger: z.enum(['manual', 'auto']),
  terminalPhase: z.enum(['done', 'cancelled', 'error']),
  durationMs: z.number().int().nonnegative(),
  preTokens: z.number().int().nonnegative().nullable(),
  postTokens: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  customInstructions: z.string().nullable(),
  attachmentCount: z.number().int().nonnegative().nullable(),
  error: z.object({ code: ErrorCodeSchema, message: z.string() }).nullable(),
});

export type CompactTerminalSnapshot = z.infer<typeof CompactTerminalSnapshotSchema>;

export interface BuildCompactSnapshotInput {
  readonly view: CompactViewModel;
}

export function buildCompactTerminalSnapshot(
  input: BuildCompactSnapshotInput,
): CompactTerminalSnapshot {
  const { view } = input;
  const terminalPhase: 'done' | 'cancelled' | 'error' =
    view.phase === 'done' || view.phase === 'cancelled' || view.phase === 'error'
      ? view.phase
      : 'error';
  const durationMs =
    view.startedAt !== null && view.endedAt !== null && view.endedAt >= view.startedAt
      ? view.endedAt - view.startedAt
      : 0;
  return CompactTerminalSnapshotSchema.parse({
    schemaVersion: 1,
    runId: view.runId,
    threadId: view.threadId,
    trigger: view.trigger,
    terminalPhase,
    durationMs,
    preTokens: view.preTokens,
    postTokens: view.postTokens,
    inputTokens: view.inputTokens,
    outputTokens: view.outputTokens,
    customInstructions: view.customInstructions,
    attachmentCount: view.attachmentCount,
    error: view.error,
  } satisfies Partial<CompactTerminalSnapshot>);
}

export function tryParseCompactTerminalSnapshot(raw: unknown): CompactTerminalSnapshot | null {
  const parsed = CompactTerminalSnapshotSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
