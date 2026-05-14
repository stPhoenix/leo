import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { Logger } from '@/platform/Logger';
import { annotateErrorOnRef, parseInbox, tickRef, type InboxRow } from '@/agent/wiki/inbox/parse';
import { WIKI_INBOX_PATH } from '@/agent/wiki/paths';
import type {
  IngestRunHandle,
  IngestRunInput,
  IngestStartResult,
  IngestTerminalResult,
} from './subgraph';
import type { IngestSource, ProviderOverride } from './types';

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
  providerOverride?: ProviderOverride,
): Promise<InboxBatchResult> {
  if (!(await deps.vault.exists(WIKI_INBOX_PATH))) {
    return { drained: 0, ticked: 0, annotated: 0, perItem: [], cancelled: signal.aborted };
  }
  const initial = await deps.vault.read(WIKI_INBOX_PATH);
  const parsed = parseInbox(initial);
  const open = parsed.rows.filter((r): r is InboxRow => r.status === 'open');

  const acc: { buffer: string; ticked: number; annotated: number; cancelled: boolean } = {
    buffer: initial,
    ticked: 0,
    annotated: 0,
    cancelled: false,
  };
  const perItem: InboxBatchPerItemResult[] = [];

  for (const row of open) {
    if (signal.aborted) {
      acc.cancelled = true;
      break;
    }
    const handled = await processInboxRow(row, threadId, signal, deps, providerOverride, acc);
    perItem.push(handled.result);
    if (handled.stop) break;
  }

  if (acc.buffer !== initial) {
    try {
      await deps.vault.write(WIKI_INBOX_PATH, acc.buffer);
    } catch (err) {
      deps.logger?.warn('wiki.inbox.write-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    drained: open.length,
    ticked: acc.ticked,
    annotated: acc.annotated,
    perItem,
    cancelled: acc.cancelled || signal.aborted,
  };
}

interface InboxBatchAcc {
  buffer: string;
  ticked: number;
  annotated: number;
  cancelled: boolean;
}

async function processInboxRow(
  row: InboxRow,
  threadId: string,
  signal: AbortSignal,
  deps: InboxBatchDeps,
  providerOverride: ProviderOverride | undefined,
  acc: InboxBatchAcc,
): Promise<{ result: InboxBatchPerItemResult; stop: boolean }> {
  const source = inferSource(row.ref, row.note ?? undefined);
  if (source === null) {
    acc.buffer = annotateErrorOnRef(acc.buffer, row.ref, 'invalid_ref', 'cannot infer source kind');
    acc.annotated += 1;
    return {
      result: {
        ref: row.ref,
        status: 'error',
        errorCode: 'invalid_ref',
        errorMessage: 'cannot infer source kind',
      },
      stop: false,
    };
  }
  const start = deps.startRun({
    threadId,
    originalAsk: `Inbox drain: ${row.ref}`,
    sources: [source],
    ...(row.note !== null ? { note: row.note } : {}),
    ...(providerOverride !== undefined ? { providerOverride } : {}),
  });
  if (!start.ok) {
    acc.buffer = annotateErrorOnRef(acc.buffer, row.ref, 'busy', 'wiki mutex held');
    acc.annotated += 1;
    return {
      result: {
        ref: row.ref,
        status: 'busy',
        errorCode: 'busy',
        errorMessage: `mutex held by ${start.busy.activeOp} runId=${start.busy.activeRunId}`,
      },
      stop: false,
    };
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
  return classifyTerminal(row, start.handle.runId, terminal, acc);
}

function classifyTerminal(
  row: InboxRow,
  runId: string,
  terminal: IngestTerminalResult,
  acc: InboxBatchAcc,
): { result: InboxBatchPerItemResult; stop: boolean } {
  if (terminal.ok) {
    acc.buffer = tickRef(acc.buffer, row.ref);
    acc.ticked += 1;
    return { result: { ref: row.ref, status: 'ok', runId }, stop: false };
  }
  if ('cancelled' in terminal && terminal.cancelled === true) {
    acc.cancelled = true;
    return { result: { ref: row.ref, status: 'cancelled', runId }, stop: true };
  }
  if ('error' in terminal) {
    acc.buffer = annotateErrorOnRef(
      acc.buffer,
      row.ref,
      terminal.error.code,
      terminal.error.message,
    );
    acc.annotated += 1;
    return {
      result: {
        ref: row.ref,
        status: 'error',
        errorCode: terminal.error.code,
        errorMessage: terminal.error.message,
        runId,
      },
      stop: false,
    };
  }
  return { result: { ref: row.ref, status: 'ok', runId }, stop: false };
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
