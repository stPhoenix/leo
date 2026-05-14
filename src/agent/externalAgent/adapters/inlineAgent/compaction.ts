import type { RewriteMessage } from './multistep/messageRewriter';
import type { InlineAgentRunState } from './runState';

const CHARS_PER_TOKEN_ESTIMATE = 4;
const KEEP_TAIL_MESSAGES = 6;

export const COMPACT_BOUNDARY_MARKER = '[inline-agent.compact.boundary]';

export function estimateMessagesTokens(messages: readonly RewriteMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += m.content.length;
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

export interface CompactionDecision {
  readonly shouldCompact: boolean;
  readonly estimatedTokens: number;
  readonly thresholdTokens: number;
}

export function decideCompaction(
  messages: readonly RewriteMessage[],
  contextWindowTokens: number,
  thresholdPct: number,
): CompactionDecision {
  const estimatedTokens = estimateMessagesTokens(messages);
  const thresholdTokens = Math.floor(contextWindowTokens * thresholdPct);
  return {
    shouldCompact: estimatedTokens > thresholdTokens,
    estimatedTokens,
    thresholdTokens,
  };
}

export interface CompactionResult {
  readonly messages: RewriteMessage[];
  readonly droppedCount: number;
  readonly preTokens: number;
  readonly postTokens: number;
}

export function compactMessages(
  messages: readonly RewriteMessage[],
  runState: InlineAgentRunState,
): CompactionResult {
  const preTokens = estimateMessagesTokens(messages);
  if (messages.length <= KEEP_TAIL_MESSAGES + 2) {
    return { messages: [...messages], droppedCount: 0, preTokens, postTokens: preTokens };
  }
  const head: RewriteMessage[] = [];
  let i = 0;
  while (i < messages.length && messages[i]?.role === 'system') {
    head.push(messages[i]!);
    i += 1;
  }
  const firstUserIdx = messages.findIndex(
    (m, idx) => idx >= i && (m.role === 'user' || m.role === 'human'),
  );
  if (firstUserIdx !== -1) {
    head.push(messages[firstUserIdx]!);
  }
  const tail = messages.slice(Math.max(messages.length - KEEP_TAIL_MESSAGES, firstUserIdx + 1));
  const droppedCount = messages.length - head.length - tail.length;
  if (droppedCount <= 0) {
    return { messages: [...messages], droppedCount: 0, preTokens, postTokens: preTokens };
  }

  const droppedSlice = messages.slice(head.length, messages.length - tail.length);
  const fetchedUrls = collectFetchedUrls(droppedSlice);
  const writtenPaths = collectWrittenPaths(droppedSlice);
  const summary = buildCompactionSummary(runState, droppedCount, fetchedUrls, writtenPaths);
  const compacted: RewriteMessage[] = [...head, { role: 'system', content: summary }, ...tail];
  const postTokens = estimateMessagesTokens(compacted);
  return { messages: compacted, droppedCount, preTokens, postTokens };
}

const FETCH_URL_RE = /"url"\s*:\s*"([^"]+)"/g;
const WRITE_PATH_RE = /"relPath"\s*:\s*"([^"]+)"/g;
const URL_LIST_CAP = 50;
const PATH_LIST_CAP = 50;

function collectFetchedUrls(dropped: readonly RewriteMessage[]): readonly string[] {
  const seen = new Set<string>();
  for (const m of dropped) {
    if (m.role !== 'assistant') continue;
    if (!m.content.includes('fetch_url')) continue;
    FETCH_URL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FETCH_URL_RE.exec(m.content)) !== null) {
      const url = match[1];
      if (typeof url === 'string' && url.length > 0) {
        seen.add(url);
        if (seen.size >= URL_LIST_CAP) return [...seen];
      }
    }
  }
  return [...seen];
}

function collectWrittenPaths(dropped: readonly RewriteMessage[]): readonly string[] {
  const seen = new Set<string>();
  for (const m of dropped) {
    if (m.role !== 'assistant') continue;
    if (!/write_file|append_file/.test(m.content)) continue;
    WRITE_PATH_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WRITE_PATH_RE.exec(m.content)) !== null) {
      const p = match[1];
      if (typeof p === 'string' && p.length > 0) {
        seen.add(p);
        if (seen.size >= PATH_LIST_CAP) return [...seen];
      }
    }
  }
  return [...seen];
}

function buildCompactionSummary(
  state: InlineAgentRunState,
  droppedCount: number,
  fetchedUrls: readonly string[],
  writtenPaths: readonly string[],
): string {
  const lines: string[] = [];
  lines.push(COMPACT_BOUNDARY_MARKER);
  lines.push(`Earlier ${droppedCount} messages were compacted to free context.`);

  appendArtifactsSection(lines, state.publishedArtifacts);
  appendTodosSection(lines, state.todos);
  appendListSection(
    lines,
    fetchedUrls,
    'URLs already fetched (do NOT refetch — bodies are gone but the work is done):',
  );
  appendListSection(
    lines,
    writtenPaths,
    'Sandbox files already written (use list_dir / read_file / glob to inspect):',
  );
  if (state.notes.length > 0) {
    lines.push('');
    lines.push(`Research notes captured: ${state.notes.length}.`);
  }

  lines.push('');
  lines.push(
    'Recent assistant + tool messages follow. Use those plus the lists above to decide the next tool call. The prior raw fetched bodies, write_file payloads, and listing results are gone — do not try to re-read them.',
  );

  return lines.join('\n');
}

function appendArtifactsSection(
  lines: string[],
  artifacts: InlineAgentRunState['publishedArtifacts'],
): void {
  if (artifacts.length === 0) return;
  lines.push('');
  lines.push('Already published artifacts (do NOT publish again):');
  for (const a of artifacts) {
    const summary = a.summary !== undefined ? ` — ${a.summary}` : '';
    lines.push(`- ${a.relPath}${summary}`);
  }
}

function appendTodosSection(lines: string[], todos: InlineAgentRunState['todos']): void {
  if (todos.length === 0) return;
  lines.push('');
  lines.push('Current TODO list (use as authoritative progress state):');
  for (const t of todos) lines.push(`- [${t.status}] ${t.id}: ${t.content}`);
}

function appendListSection(lines: string[], items: readonly string[], header: string): void {
  if (items.length === 0) return;
  lines.push('');
  lines.push(header);
  for (const item of items) lines.push(`- ${item}`);
}
