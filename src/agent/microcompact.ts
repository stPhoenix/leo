import { IMAGE_DOCUMENT_TOKENS, roughTokenCountEstimation } from './tokenEstimator';

export const CLEARED_CONTENT_MARKER = '[Old tool result content cleared]';
export const MICROCOMPACT_BOUNDARY_MARKER = '[leo.microcompact.boundary]';
export const DEFAULT_GAP_THRESHOLD_MINUTES = 60;
export const DEFAULT_KEEP_RECENT = 5;

export const BUILTIN_COMPACTABLE_TOOLS: ReadonlySet<string> = new Set([
  'read_note',
  'edit_note',
  'create_note',
  'append_to_note',
  'search_vault',
]);

export interface CompactToolCallRef {
  readonly id: string;
  readonly name: string;
  readonly input?: unknown;
  readonly argsJson?: string;
}

export type CompactContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'thinking'; readonly thinking: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input?: unknown;
    }
  | { readonly type: 'image' }
  | { readonly type: 'document' };

export interface CompactUserMessage {
  readonly role: 'user';
  readonly content: string | readonly CompactContentBlock[];
  readonly messageId?: string;
  readonly timestamp?: number;
}

export interface CompactAssistantMessage {
  readonly role: 'assistant';
  readonly content: string | readonly CompactContentBlock[];
  readonly toolCalls?: readonly CompactToolCallRef[];
  readonly messageId?: string;
  readonly timestamp?: number;
}

export interface CompactToolMessage {
  readonly role: 'tool';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: string | readonly CompactContentBlock[];
  readonly messageId?: string;
  readonly timestamp?: number;
}

export type CompactSystemKind =
  | 'microcompact_boundary'
  | 'skill_discovery'
  | 'skill_listing'
  | 'other';

export interface CompactSystemMessage {
  readonly role: 'system';
  readonly content: string;
  readonly kind?: CompactSystemKind;
  readonly messageId?: string;
  readonly timestamp?: number;
}

export type CompactMessage =
  | CompactUserMessage
  | CompactAssistantMessage
  | CompactToolMessage
  | CompactSystemMessage;

export interface SystemMicrocompactBoundaryMessage extends CompactSystemMessage {
  readonly kind: 'microcompact_boundary';
}

export function isMicrocompactBoundary(m: CompactMessage): m is SystemMicrocompactBoundaryMessage {
  return m.role === 'system' && m.kind === 'microcompact_boundary';
}

export function createMicrocompactBoundary(timestamp?: number): SystemMicrocompactBoundaryMessage {
  const base: SystemMicrocompactBoundaryMessage = {
    role: 'system',
    kind: 'microcompact_boundary',
    content: MICROCOMPACT_BOUNDARY_MARKER,
  };
  return timestamp === undefined ? base : { ...base, timestamp };
}

export interface MicrocompactLogger {
  info(event: string, fields: Record<string, unknown>): void;
}

export interface MicrocompactContext {
  readonly now?: Date | number;
  readonly gapThresholdMinutes?: number;
  readonly keepRecent?: number;
  readonly isCompactable?: (toolName: string) => boolean;
  readonly logger?: MicrocompactLogger;
  readonly estimateTokens?: (messages: readonly CompactMessage[]) => number;
}

export interface MicrocompactResult {
  readonly messages: readonly CompactMessage[];
  readonly boundaryMarker: SystemMicrocompactBoundaryMessage;
  readonly tokensSaved: number;
  readonly toolsCleared: number;
  readonly toolsKept: number;
  readonly gapMinutes: number;
  readonly keepRecent: number;
  readonly querySource?: string;
}

// NOSONAR(typescript:S3776): linear microcompact pipeline (gather → gate → clear → rebuild → measure) sharing ctx/messages/clearIds state across phases; extracting fragments the gating logic.
export function microcompactMessages(
  messages: readonly CompactMessage[],
  ctx: MicrocompactContext = {},
  querySource?: string,
): MicrocompactResult | null {
  const keepRecent = Math.max(1, Math.floor(ctx.keepRecent ?? DEFAULT_KEEP_RECENT));
  const gapThresholdMinutes = ctx.gapThresholdMinutes ?? DEFAULT_GAP_THRESHOLD_MINUTES;
  const isCompactable =
    ctx.isCompactable ?? ((name: string): boolean => BUILTIN_COMPACTABLE_TOOLS.has(name));
  const estimate = ctx.estimateTokens ?? estimateCompactTokens;

  const gapMinutes = computeGapMinutes(messages, ctx.now);
  if (gapMinutes === null) return null;
  if (gapMinutes < gapThresholdMinutes) return null;

  const orderedToolUses = collectCompactableToolUses(messages, isCompactable);
  if (orderedToolUses.length === 0) return null;

  const keepFromIdx = Math.max(0, orderedToolUses.length - keepRecent);
  const clearIds = new Set(orderedToolUses.slice(0, keepFromIdx).map((u) => u.id));
  if (clearIds.size === 0) return null;

  const before = estimate(messages);

  const nowMs = toMs(ctx.now);
  const boundary = createMicrocompactBoundary(nowMs);

  const firstClearIdx = findFirstClearedToolResultIdx(messages, clearIds);
  if (firstClearIdx < 0) return null;

  const next: CompactMessage[] = [];
  let toolsCleared = 0;
  for (let i = 0; i < messages.length; i += 1) {
    if (i === firstClearIdx) next.push(boundary);
    const m = messages[i]!;
    if (m.role === 'tool' && clearIds.has(m.toolCallId)) {
      next.push(clearedToolResult(m));
      toolsCleared += 1;
    } else {
      next.push(m);
    }
  }

  const after = estimate(next);
  const tokensSaved = Math.max(0, before - after);
  if (tokensSaved === 0) return null;

  const toolsKept = orderedToolUses.length - toolsCleared;
  ctx.logger?.info('microcompact.cleared', {
    gapMinutes,
    toolsCleared,
    toolsKept,
    keepRecent,
    tokensSaved,
    ...(querySource !== undefined ? { querySource } : {}),
  });

  const result: MicrocompactResult = {
    messages: next,
    boundaryMarker: boundary,
    tokensSaved,
    toolsCleared,
    toolsKept,
    gapMinutes,
    keepRecent,
    ...(querySource !== undefined ? { querySource } : {}),
  };
  return result;
}

function clearedToolResult(m: CompactToolMessage): CompactToolMessage {
  const next: CompactToolMessage = {
    role: 'tool',
    toolCallId: m.toolCallId,
    toolName: m.toolName,
    content: CLEARED_CONTENT_MARKER,
    ...(m.messageId !== undefined ? { messageId: m.messageId } : {}),
    ...(m.timestamp !== undefined ? { timestamp: m.timestamp } : {}),
  };
  return next;
}

function collectFromAssistantMessage(
  m: Extract<CompactMessage, { role: 'assistant' }>,
  isCompactable: (toolName: string) => boolean,
  out: { id: string; name: string }[],
): void {
  for (const call of m.toolCalls ?? []) {
    if (isCompactable(call.name)) out.push({ id: call.id, name: call.name });
  }
  if (!Array.isArray(m.content)) return;
  for (const block of m.content) {
    if (block.type === 'tool_use' && isCompactable(block.name)) {
      out.push({ id: block.id, name: block.name });
    }
  }
}

function collectCompactableToolUses(
  messages: readonly CompactMessage[],
  isCompactable: (toolName: string) => boolean,
): readonly { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    collectFromAssistantMessage(m, isCompactable, out);
  }
  return out;
}

function findFirstClearedToolResultIdx(
  messages: readonly CompactMessage[],
  clearIds: ReadonlySet<string>,
): number {
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i]!;
    if (m.role === 'tool' && clearIds.has(m.toolCallId)) return i;
  }
  return -1;
}

function computeGapMinutes(
  messages: readonly CompactMessage[],
  now: Date | number | undefined,
): number | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    if (typeof m.timestamp !== 'number') continue;
    const nowMs = toMs(now);
    const gapMs = nowMs - m.timestamp;
    return gapMs / 60_000;
  }
  return null;
}

function toMs(x: Date | number | undefined): number {
  if (x === undefined) return Date.now();
  if (x instanceof Date) return x.getTime();
  return x;
}

export function estimateCompactTokens(messages: readonly CompactMessage[]): number {
  let sum = 0;
  for (const m of messages) {
    if (m.role === 'system') {
      sum += roughTokenCountEstimation(m.content);
      continue;
    }
    if (m.role === 'tool') {
      sum += estimateContentTokens(m.content);
      continue;
    }
    sum += estimateContentTokens(m.content);
    if (m.role === 'assistant' && m.toolCalls !== undefined) {
      for (const call of m.toolCalls) {
        sum += roughTokenCountEstimation(call.name + JSON.stringify(call.input ?? null));
      }
    }
  }
  return sum;
}

function estimateContentTokens(content: string | readonly CompactContentBlock[]): number {
  if (typeof content === 'string') return roughTokenCountEstimation(content);
  let sum = 0;
  for (const block of content) {
    switch (block.type) {
      case 'text':
        sum += roughTokenCountEstimation(block.text);
        break;
      case 'thinking':
        sum += roughTokenCountEstimation(block.thinking);
        break;
      case 'tool_use':
        sum += roughTokenCountEstimation(block.name + JSON.stringify(block.input ?? null));
        break;
      case 'image':
      case 'document':
        sum += IMAGE_DOCUMENT_TOKENS;
        break;
      default:
        sum += roughTokenCountEstimation(JSON.stringify(block));
    }
  }
  return sum;
}
