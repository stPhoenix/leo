import { z } from 'zod';
import type { WikiOp } from '@/agent/wiki/mutexTypes';
import type { WikiViewModel } from '@/agent/wiki/widgetState';

export const WIKI_TERMINAL_KIND = 'wiki_terminal';

const PerSourceStatusSchema = z.object({
  rawPath: z.string(),
  status: z.enum(['ok', 'skipped', 'replaced', 'error']),
  error: z.string().optional(),
});

const FindingSummarySchema = z.object({
  id: z.string(),
  page: z.string(),
  action: z.string(),
  severity: z.enum(['info', 'warn', 'error']),
  rationale: z.string(),
  accepted: z.boolean().nullable(),
});

export const WikiTerminalSnapshotSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  runId: z.string(),
  threadId: z.string(),
  op: z.enum(['ingest', 'lint']),
  terminalPhase: z.enum(['done', 'cancelled', 'error']),
  durationMs: z.number().int().nonnegative(),
  logLine: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),

  // Ingest counts
  pagesCreated: z.number().int().nonnegative().default(0),
  pagesEdited: z.number().int().nonnegative().default(0),
  sourcesPersisted: z.number().int().nonnegative().default(0),
  perSourceStatuses: z.array(PerSourceStatusSchema).default([]),

  // Lint counts
  findingsTotal: z.number().int().nonnegative().default(0),
  findingsAccepted: z.number().int().nonnegative().default(0),
  findingsRejected: z.number().int().nonnegative().default(0),
  schemaEdited: z.boolean().default(false),
  findings: z.array(FindingSummarySchema).default([]),
});

export type WikiTerminalSnapshot = z.infer<typeof WikiTerminalSnapshotSchema>;

export interface BuildWikiSnapshotInput {
  readonly view: WikiViewModel;
  readonly cancelledFromPhase?: WikiViewModel['phase'];
}

export function buildWikiTerminalSnapshot(input: BuildWikiSnapshotInput): WikiTerminalSnapshot {
  const { view } = input;
  const terminalPhase: 'done' | 'cancelled' | 'error' =
    view.phase === 'done' || view.phase === 'cancelled' || view.phase === 'error'
      ? view.phase
      : 'error';
  const durationMs =
    view.startedAt !== null && view.endedAt !== null && view.endedAt >= view.startedAt
      ? view.endedAt - view.startedAt
      : 0;
  const persisted = (view.perSourceStatuses ?? []).filter(
    (s) => s.status === 'ok' || s.status === 'replaced',
  );
  const findings = view.findings ?? [];
  const accepted = findings.filter((f) => f.accepted === true).length;
  const rejected = findings.filter((f) => f.accepted === false).length;

  return WikiTerminalSnapshotSchema.parse({
    schemaVersion: 1,
    runId: view.runId,
    threadId: view.threadId,
    op: view.op,
    terminalPhase,
    durationMs,
    logLine: view.logLine,
    error: view.error,
    pagesCreated: view.pagesCreated ?? 0,
    pagesEdited: view.pagesEdited ?? 0,
    sourcesPersisted: persisted.length,
    perSourceStatuses: filterPerSource(view.perSourceStatuses ?? []),
    findingsTotal: findings.length,
    findingsAccepted: accepted,
    findingsRejected: rejected,
    schemaEdited: view.schemaPatchPending === true,
    findings: filterFindings(findings),
  } satisfies Partial<WikiTerminalSnapshot>);
}

function filterPerSource(
  list: readonly { rawPath: string; status: string; error?: string }[],
): { rawPath: string; status: 'ok' | 'skipped' | 'replaced' | 'error'; error?: string }[] {
  return list
    .map((s) =>
      s.status === 'ok' || s.status === 'skipped' || s.status === 'replaced' || s.status === 'error'
        ? {
            rawPath: s.rawPath,
            status: s.status as 'ok' | 'skipped' | 'replaced' | 'error',
            ...(s.error !== undefined ? { error: s.error } : {}),
          }
        : null,
    )
    .filter((s): s is { rawPath: string; status: 'ok' | 'skipped' | 'replaced' | 'error'; error?: string } =>
      s !== null,
    );
}

function filterFindings(
  list: readonly {
    id: string;
    page: string;
    action: string;
    severity: 'info' | 'warn' | 'error';
    rationale: string;
    accepted: boolean | null;
  }[],
): {
  id: string;
  page: string;
  action: string;
  severity: 'info' | 'warn' | 'error';
  rationale: string;
  accepted: boolean | null;
}[] {
  return list.map((f) => ({
    id: f.id,
    page: f.page,
    action: f.action,
    severity: f.severity,
    rationale: f.rationale,
    accepted: f.accepted,
  }));
}

export function tryParseWikiTerminalSnapshot(raw: unknown): WikiTerminalSnapshot | null {
  const parsed = WikiTerminalSnapshotSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}

export type WikiTerminalOp = WikiOp;
