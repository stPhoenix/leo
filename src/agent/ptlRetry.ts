import type { ChatMessage } from '@/providers/types';
import { estimateMessageTokens, type TokenMessage } from './tokenEstimator';

export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'prompt is too long';
export const ERROR_MESSAGE_PROMPT_TOO_LONG =
  'Conversation too long. Press esc twice to go up a few messages and try again.';
export const PTL_TRUNCATION_MARKER = '[earlier conversation truncated for compaction retry]';
export const MAX_PTL_RETRIES = 3;

export interface PtlMetaMessage extends ChatMessage {
  readonly role: 'user';
  readonly content: string;
  readonly isMeta: true;
}

export function isPtlTruncationMarker(m: ChatMessage): m is PtlMetaMessage {
  return (
    m.role === 'user' &&
    m.content === PTL_TRUNCATION_MARKER &&
    (m as PtlMetaMessage).isMeta === true
  );
}

export function groupMessagesByApiRound(messages: readonly ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  let seenAssistant = false;
  for (const m of messages) {
    if (m.role === 'assistant' && seenAssistant && current.length > 0) {
      groups.push(current);
      current = [m];
    } else {
      current.push(m);
    }
    if (m.role === 'assistant') seenAssistant = true;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function parseTokenGap(response: string): number | null {
  const patterns = [
    /tokens?:?\s*(\d+)\s*(?:>|over|exceeded)/i,
    /exceeds?[^0-9]*(\d+)\s*tokens?/i,
    /(\d+)\s*tokens?\s*(?:over|too many)/i,
    /gap[^0-9]*(\d+)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(response);
    if (m !== null) {
      const n = Number.parseInt(m[1]!, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

export interface TruncateResult {
  readonly messages: ChatMessage[];
  readonly droppedMessages: number;
  readonly remainingMessages: number;
  readonly groupsBefore: number;
  readonly groupsAfter: number;
  readonly dropCount: number;
}

export function truncateHeadForPTLRetry(
  messages: readonly ChatMessage[],
  ptlResponse: string,
): TruncateResult | null {
  const stripped = stripLeadingMarker(messages);
  const groups = groupMessagesByApiRound(stripped);
  if (groups.length < 2) return null;

  const gap = parseTokenGap(ptlResponse);
  const dropCount =
    gap !== null ? dropCountByGap(groups, gap) : dropCountByTwentyPercent(groups.length);
  if (dropCount <= 0 || dropCount >= groups.length) return null;

  const kept = groups.slice(dropCount).flat();
  const droppedMessageCount = stripped.length - kept.length;
  const withMarker = kept[0]?.role === 'assistant' ? [buildPtlMarkerMessage(), ...kept] : kept;
  return {
    messages: withMarker,
    droppedMessages: droppedMessageCount,
    remainingMessages: withMarker.length,
    groupsBefore: groups.length,
    groupsAfter: groups.length - dropCount,
    dropCount,
  };
}

export function buildPtlMarkerMessage(): PtlMetaMessage {
  return {
    role: 'user',
    content: PTL_TRUNCATION_MARKER,
    isMeta: true,
  };
}

function stripLeadingMarker(messages: readonly ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return [];
  if (isPtlTruncationMarker(messages[0]!)) return messages.slice(1);
  return [...messages];
}

function dropCountByGap(groups: readonly (readonly ChatMessage[])[], gap: number): number {
  let accum = 0;
  for (let i = 0; i < groups.length; i += 1) {
    const tokens = estimateMessageTokens(groupToTokenMessages(groups[i]!));
    accum += tokens;
    if (accum >= gap) return Math.min(groups.length - 1, i + 1);
  }
  return Math.min(groups.length - 1, groups.length);
}

function dropCountByTwentyPercent(groupCount: number): number {
  if (groupCount < 2) return 0;
  const pct = Math.floor(0.2 * groupCount);
  const raw = Math.max(1, pct);
  return Math.min(groupCount - 1, raw);
}

function groupToTokenMessages(group: readonly ChatMessage[]): TokenMessage[] {
  return group.map((m) => ({ role: m.role, content: m.content }));
}
