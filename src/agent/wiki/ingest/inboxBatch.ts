import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { Logger } from '@/platform/Logger';
import {
  annotateErrorOnRef,
  parseInbox,
  tickRef,
  type InboxRow,
} from '@/agent/wiki/inbox/parse';
import { WIKI_INBOX_PATH } from '@/agent/wiki/paths';
import type {
  IngestRunHandle,
  IngestRunInput,
  IngestStartResult,
  IngestTerminalResult,
} from './subgraph';
import type { IngestSource } from './types';

export interface InboxBatchPerItemResult {
  readonly ref: string;
  readonly status: 'ok' | 'cancelled' | 'busy' | 'error';
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly runId?: string;
}

export interface InboxBatchResult {
  readonly drained: number;
  readonly ticked: number;
  readonly annotated: number;
  readonly perItem: readonly InboxBatchPerItemResult[];
  readonly cancelled: boolean;
}

export interface InboxBatchDeps {
  readonly vault: VaultAdapter;
  readonly logger?: Logger;
  readonly startRun: (input: IngestRunInput) => IngestStartResult;
  readonly onHandle?: (handle: IngestRunHandle) => void;
}

export async function runInboxBatch(
  threadId: string,
  signal: AbortSignal,
  deps: InboxBatchDeps,
): Promise<InboxBatchResult> {
  if (!(await deps.vault.exists(WIKI_INBOX_PATH))) {
    return { drained: 0, ticked: 0, annotated: 0, perItem: [], cancelled: signal.aborted };
  }
  const initial = await deps.vault.read(WIKI_INBOX_PATH);
  const parsed = parseInbox(initial);
  const open = parsed.rows.filter((r): r is InboxRow => r.status === 'open');

  let buffer = initial;
  const perItem: InboxBatchPerItemResult[] = [];
  let ticked = 0;
  let annotated = 0;
  let cancelled = false;

  for (const row of open) {
    if (signal.aborted) {
      cancelled = true;
      break;
    }
    const source = inferSource(row.ref, row.note ?? undefined);
    if (source === null) {
      buffer = annotateErrorOnRef(buffer, row.ref, 'invalid_ref', 'cannot infer source kind');
      annotated += 1;
      perItem.push({
        ref: row.ref,
        status: 'error',
        errorCode: 'invalid_ref',
        errorMessage: 'cannot infer source kind',
      });
      continue;
    }
    const start = deps.startRun({
      threadId,
      originalAsk: `Inbox drain: ${row.ref}`,
      sources: [source],
      ...(row.note !== null ? { note: row.note } : {}),
    });
    if (!start.ok) {
      perItem.push({
        ref: row.ref,
        status: 'busy',
        errorCode: 'busy',
        errorMessage: `mutex held by ${start.busy.activeOp} runId=${start.busy.activeRunId}`,
      });
      buffer = annotateErrorOnRef(buffer, row.ref, 'busy', 'wiki mutex held');
      annotated += 1;
      continue;
    }
    deps.onHandle?.(start.handle);
    const onAbort = (): void => start.handle.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let terminal: IngestTerminalResult;
    try {
      terminal = await start.handle.terminal;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (terminal.ok) {
      buffer = tickRef(buffer, row.ref);
      ticked += 1;
      perItem.push({ ref: row.ref, status: 'ok', runId: start.handle.runId });
    } else if ('cancelled' in terminal && terminal.cancelled === true) {
      cancelled = true;
      perItem.push({ ref: row.ref, status: 'cancelled', runId: start.handle.runId });
      break;
    } else if ('error' in terminal) {
      buffer = annotateErrorOnRef(buffer, row.ref, terminal.error.code, terminal.error.message);
      annotated += 1;
      perItem.push({
        ref: row.ref,
        status: 'error',
        errorCode: terminal.error.code,
        errorMessage: terminal.error.message,
        runId: start.handle.runId,
      });
    }
  }

  if (buffer !== initial) {
    try {
      await deps.vault.write(WIKI_INBOX_PATH, buffer);
    } catch (err) {
      deps.logger?.warn('wiki.inbox.write-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    drained: open.length,
    ticked,
    annotated,
    perItem,
    cancelled: cancelled || signal.aborted,
  };
}

export function inferSource(ref: string, note?: string): IngestSource | null {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: 'url', url: trimmed, ...(note !== undefined ? { note } : {}) };
  }
  if (trimmed.startsWith('attachment:')) {
    return {
      kind: 'attachment',
      attachmentId: trimmed.slice('attachment:'.length),
      ...(note !== undefined ? { note } : {}),
    };
  }
  // Default to vault path.
  return { kind: 'vaultPath', path: trimmed, ...(note !== undefined ? { note } : {}) };
}
