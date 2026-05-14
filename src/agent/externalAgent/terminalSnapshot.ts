import { z } from 'zod';
import type { AdapterRegistry } from './adapterRegistry';
import { describeConfigSchema } from '@/settings/externalAgentResolver';
import type { ExternalAgentState } from './state';

export const EXTERNAL_AGENT_WIDGET_KIND = 'external_agent_widget';

export const TerminalSnapshotSchema = z.object({
  runId: z.string(),
  threadId: z.string(),
  adapterId: z.string(),
  adapterLabel: z.string(),
  terminalPhase: z.enum(['done', 'cancelled', 'error']),
  folder: z.string().nullable(),
  files: z.array(z.string()),
  durationMs: z.number().int().nonnegative(),
  refinedPrompt: z.string(),
  refineTranscript: z.array(
    z.object({
      role: z.enum(['assistant', 'user']),
      content: z.string(),
    }),
  ),
  responseText: z.string(),
  logCount: z.number().int().nonnegative(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  adapterConfigSnapshot: z.record(z.string(), z.unknown()),
  schemaVersion: z.literal(1).default(1),
});

export type ExternalAgentTerminalSnapshot = z.infer<typeof TerminalSnapshotSchema>;

export interface BuildSnapshotInput {
  readonly state: ExternalAgentState;
  readonly registry: AdapterRegistry;
  readonly resolvedConfig: unknown;
  readonly cancelledFromPhase?: 'preparing' | 'awaiting_clarify' | 'ready' | 'running';
}

/**
 * Build a persisted terminal snapshot from the live state. The
 * `adapterConfigSnapshot` is the resolved config blob with every field flagged
 * `.describe('secret')` removed, per FR-EXT-26 + OQ-08.
 */
export function buildTerminalSnapshot(input: BuildSnapshotInput): ExternalAgentTerminalSnapshot {
  const { state, registry, resolvedConfig } = input;
  const adapter = registry.get(state.selectedAdapterId ?? '');
  const adapterLabel = adapter?.label ?? state.selectedAdapterId ?? 'unknown';
  const terminalPhase: 'done' | 'cancelled' | 'error' =
    state.phase === 'done' || state.phase === 'cancelled' || state.phase === 'error'
      ? state.phase
      : 'error';
  const startedAt = state.startedAt ?? 0;
  const endedAt = state.endedAt ?? startedAt;
  const adapterConfigSnapshot =
    adapter !== undefined ? filterSecretFields(adapter.configSchema, resolvedConfig) : {};
  return {
    runId: state.runId,
    threadId: state.threadId,
    adapterId: state.selectedAdapterId ?? 'unknown',
    adapterLabel,
    terminalPhase,
    folder: state.resultFolder,
    files: [...state.writtenFiles],
    durationMs: Math.max(0, endedAt - startedAt),
    refinedPrompt: state.refinedPrompt ?? state.originalAsk,
    refineTranscript: state.refineHistory
      .filter((m) => m.role === 'assistant' || m.role === 'user')
      .map((m) => ({ role: m.role as 'assistant' | 'user', content: m.content })),
    responseText: state.textBuffer,
    logCount: state.logEvents.length,
    error: state.error,
    adapterConfigSnapshot,
    schemaVersion: 1,
  };
}

/**
 * Strip secret fields from a resolved config blob using the adapter's
 * `configSchema` as the source of truth (fields tagged `.describe('secret')`
 * are dropped).
 */
export function filterSecretFields(schema: z.ZodType, resolved: unknown): Record<string, unknown> {
  const fields = describeConfigSchema(schema);
  const out: Record<string, unknown> = {};
  if (resolved === null || typeof resolved !== 'object') return out;
  const obj = resolved as Record<string, unknown>;
  for (const f of fields) {
    if (f.kind === 'secret') continue;
    if (f.kind === 'object' && f.children !== undefined) {
      const childObj = obj[f.path[0]!];
      if (childObj !== undefined && typeof childObj === 'object' && childObj !== null) {
        out[f.path[0]!] = filterObjectChildren(childObj as Record<string, unknown>, f.children);
      }
      continue;
    }
    const key = f.path[0]!;
    if (key in obj) out[key] = obj[key];
  }
  return out;
}

function filterObjectChildren(
  childObj: Record<string, unknown>,
  children: readonly { path: readonly string[]; kind: string }[],
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const child of children) {
    if (child.kind === 'secret') continue;
    const key = child.path[child.path.length - 1]!;
    filtered[key] = childObj[key];
  }
  return filtered;
}

/**
 * Parse a persisted block payload. Returns null if it is missing required
 * fields or fails Zod validation — older snapshots are dropped per AC7.
 */
export function tryParseTerminalSnapshot(raw: unknown): ExternalAgentTerminalSnapshot | null {
  const parsed = TerminalSnapshotSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
