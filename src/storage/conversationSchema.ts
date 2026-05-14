import type { Logger } from '@/platform/Logger';
import type {
  ContentBlock,
  McpUiContent,
  TextBlock,
  ToolReferenceBlock,
  ToolResultContent,
} from '@/chat/types';

export const CONVERSATION_SCHEMA_VERSION = 2;

export type StoredRole = 'user' | 'assistant' | 'tool' | 'banner' | 'widget';

export interface StoredTokenUsage {
  readonly input: number;
  readonly output: number;
  readonly total: number;
  readonly source?: 'api' | 'estimate';
}

export interface StoredMessage {
  readonly id: string;
  readonly role: StoredRole;
  readonly content: string;
  readonly createdAt: string;
  readonly status?: string;
  readonly tokens?: StoredTokenUsage;
  readonly banner?: {
    readonly kind: string;
    readonly toolCount?: number;
    readonly message?: string;
  };
  readonly widget?: {
    readonly kind: string;
    readonly props: unknown;
  };
  readonly toolUse?: unknown;
  readonly toolResult?: unknown;
  readonly blocks?: readonly ContentBlock[];
  readonly extras?: Readonly<Record<string, unknown>>;
}

export interface StoredThreadMetadata {
  readonly allowedTools: readonly string[];
  readonly title?: string;
  readonly extras?: Readonly<Record<string, unknown>>;
}

export interface StoredThread {
  readonly id: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: StoredThreadMetadata;
  readonly messages: readonly StoredMessage[];
  readonly extras?: Readonly<Record<string, unknown>>;
}

const TOP_LEVEL_KEYS = new Set([
  'id',
  'schemaVersion',
  'createdAt',
  'updatedAt',
  'metadata',
  'messages',
]);

const MESSAGE_KEYS = new Set([
  'id',
  'role',
  'content',
  'createdAt',
  'status',
  'tokens',
  'banner',
  'widget',
  'toolUse',
  'toolResult',
  'blocks',
]);

const METADATA_KEYS = new Set(['allowedTools', 'skillId', 'title']);
const LEGACY_METADATA_KEYS = new Set(['skillId']);

export interface ParseContext {
  readonly logger?: Logger;
  readonly path: string;
}

export function emptyThread(id: string, nowIso: string): StoredThread {
  return {
    id,
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    createdAt: nowIso,
    updatedAt: nowIso,
    metadata: { allowedTools: [] },
    messages: [],
  };
}

export function parseThread(raw: unknown, ctx: ParseContext): StoredThread {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('conversation JSON root must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : 'default';
  const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : new Date(0).toISOString();
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : createdAt;
  const schemaVersion =
    typeof obj.schemaVersion === 'number' ? obj.schemaVersion : CONVERSATION_SCHEMA_VERSION;
  const metadata = parseMetadata(obj.metadata, ctx);
  const messages = parseMessages(obj.messages, ctx);
  const extras = collectExtras(obj, TOP_LEVEL_KEYS, ctx, '');
  const thread: StoredThread = {
    id,
    schemaVersion,
    createdAt,
    updatedAt,
    metadata,
    messages,
    ...(extras !== undefined ? { extras } : {}),
  };
  return thread;
}

function parseMetadata(raw: unknown, ctx: ParseContext): StoredThreadMetadata {
  if (raw === null || typeof raw !== 'object') {
    return { allowedTools: [] };
  }
  const obj = raw as Record<string, unknown>;
  const allowedTools = Array.isArray(obj.allowedTools)
    ? obj.allowedTools.filter((v): v is string => typeof v === 'string')
    : [];
  const title = typeof obj.title === 'string' ? obj.title : undefined;
  const extras = collectExtras(obj, METADATA_KEYS, ctx, 'metadata', LEGACY_METADATA_KEYS);
  return {
    allowedTools,
    ...(title !== undefined ? { title } : {}),
    ...(extras !== undefined ? { extras } : {}),
  };
}

function parseMessages(raw: unknown, ctx: ParseContext): readonly StoredMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredMessage[] = [];
  raw.forEach((entry, i) => {
    const parsed = parseMessage(entry, ctx, i);
    if (parsed !== null) out.push(parsed);
  });
  return out;
}

function parseMessage(raw: unknown, ctx: ParseContext, index: number): StoredMessage | null {
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : null;
  const role = isStoredRole(obj.role) ? obj.role : null;
  const content = typeof obj.content === 'string' ? obj.content : null;
  const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : null;
  if (id === null || role === null || content === null || createdAt === null) return null;
  const status = typeof obj.status === 'string' ? obj.status : undefined;
  const tokens = parseTokens(obj.tokens);
  const banner = parseBanner(obj.banner);
  const widget = parseWidget(obj.widget);
  const blocks = parseBlocks(obj.blocks);
  const extras = collectExtras(obj, MESSAGE_KEYS, ctx, `messages[${index}]`);
  return {
    id,
    role,
    content,
    createdAt,
    ...(status !== undefined ? { status } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
    ...(banner !== undefined ? { banner } : {}),
    ...(widget !== undefined ? { widget } : {}),
    ...(obj.toolUse !== undefined ? { toolUse: obj.toolUse } : {}),
    ...(obj.toolResult !== undefined ? { toolResult: obj.toolResult } : {}),
    ...(blocks !== undefined ? { blocks } : {}),
    ...(extras !== undefined ? { extras } : {}),
  };
}

function parseBlocks(raw: unknown): readonly ContentBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ContentBlock[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const block = parseSingleBlock(entry as Record<string, unknown>);
    if (block !== null) out.push(block);
  }
  return out;
}

type BlockParser = (obj: Record<string, unknown>) => ContentBlock | null;

function parseTextBlock(obj: Record<string, unknown>): ContentBlock | null {
  if (typeof obj.text !== 'string') return null;
  return { type: 'text', text: obj.text };
}

function parseThinkingBlock(obj: Record<string, unknown>): ContentBlock | null {
  if (typeof obj.thinking !== 'string') return null;
  return {
    type: 'thinking',
    thinking: obj.thinking,
    ...(typeof obj.signature === 'string' ? { signature: obj.signature } : {}),
  };
}

function parseRedactedThinkingBlock(obj: Record<string, unknown>): ContentBlock | null {
  if (typeof obj.data !== 'string') return null;
  return { type: 'redacted_thinking', data: obj.data };
}

function parseToolUseEntry(obj: Record<string, unknown>): ContentBlock | null {
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string') return null;
  return parseToolUseBlock(obj);
}

function parseToolResultBlock(obj: Record<string, unknown>): ContentBlock | null {
  if (typeof obj.tool_use_id !== 'string') return null;
  return {
    type: 'tool_result',
    tool_use_id: obj.tool_use_id,
    content: parseToolResultContent(obj.content),
    ...(typeof obj.is_error === 'boolean' ? { is_error: obj.is_error } : {}),
  };
}

function parseToolReferenceBlock(obj: Record<string, unknown>): ContentBlock | null {
  if (typeof obj.tool_name !== 'string') return null;
  return { type: 'tool_reference', tool_name: obj.tool_name };
}

function parseSlashExpandedBlock(obj: Record<string, unknown>): ContentBlock | null {
  if (
    typeof obj.command !== 'string' ||
    typeof obj.typed !== 'string' ||
    typeof obj.expandedBody !== 'string'
  ) {
    return null;
  }
  return {
    type: 'slash_expanded',
    command: obj.command,
    typed: obj.typed,
    expandedBody: obj.expandedBody,
  };
}

function parseImageBlock(obj: Record<string, unknown>): ContentBlock | null {
  const source = parseBase64Source(obj.source);
  if (source === null) return null;
  return {
    type: 'image',
    source,
    ...(typeof obj.name === 'string' ? { name: obj.name } : {}),
    ...(typeof obj.size === 'number' ? { size: obj.size } : {}),
  };
}

function parseDocumentBlock(obj: Record<string, unknown>): ContentBlock | null {
  const source = parseBase64Source(obj.source);
  if (source === null) return null;
  return {
    type: 'document',
    source,
    ...(typeof obj.name === 'string' ? { name: obj.name } : {}),
    ...(typeof obj.size === 'number' ? { size: obj.size } : {}),
  };
}

function parseAttachmentChipBlock(obj: Record<string, unknown>): ContentBlock | null {
  const kind = obj.kind;
  if (kind !== 'image' && kind !== 'document') return null;
  if (
    typeof obj.name !== 'string' ||
    typeof obj.mimeType !== 'string' ||
    typeof obj.size !== 'number'
  ) {
    return null;
  }
  return {
    type: 'attachment_chip',
    kind,
    name: obj.name,
    mimeType: obj.mimeType,
    size: obj.size,
    ...(typeof obj.path === 'string' ? { path: obj.path } : {}),
  };
}

const BLOCK_PARSERS: Readonly<Record<string, BlockParser>> = {
  text: parseTextBlock,
  thinking: parseThinkingBlock,
  redacted_thinking: parseRedactedThinkingBlock,
  tool_use: parseToolUseEntry,
  tool_result: parseToolResultBlock,
  tool_reference: parseToolReferenceBlock,
  slash_expanded: parseSlashExpandedBlock,
  image: parseImageBlock,
  document: parseDocumentBlock,
  attachment_chip: parseAttachmentChipBlock,
};

function parseSingleBlock(obj: Record<string, unknown>): ContentBlock | null {
  const type = obj.type;
  if (typeof type !== 'string') return null;
  const parser = BLOCK_PARSERS[type];
  return parser !== undefined ? parser(obj) : null;
}

function parseBase64Source(
  raw: unknown,
): { readonly type: 'base64'; readonly media_type: string; readonly data: string } | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== 'base64') return null;
  if (typeof o.media_type !== 'string' || typeof o.data !== 'string') return null;
  return { type: 'base64', media_type: o.media_type, data: o.data };
}

function parseToolUseBlock(obj: Record<string, unknown>): ContentBlock {
  const decisionRaw = obj.decision;
  const decision =
    decisionRaw === 'allow-once' || decisionRaw === 'allow-thread' || decisionRaw === 'deny'
      ? decisionRaw
      : undefined;
  return {
    type: 'tool_use',
    id: obj.id as string,
    name: obj.name as string,
    input: obj.input,
    ...(typeof obj.raw === 'string' ? { raw: obj.raw } : {}),
    ...(decision !== undefined ? { decision } : {}),
  };
}

function parseToolResultContent(raw: unknown): ToolResultContent {
  if (typeof raw === 'string') return raw;
  if (!Array.isArray(raw)) return '';
  type Inner = TextBlock | ToolReferenceBlock | McpUiContent;
  const inner: Inner[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    if (o.type === 'text' && typeof o.text === 'string') {
      inner.push({ type: 'text', text: o.text });
    } else if (o.type === 'tool_reference' && typeof o.tool_name === 'string') {
      inner.push({ type: 'tool_reference', tool_name: o.tool_name });
    } else if (
      o.type === 'mcp_ui' &&
      typeof o.uri === 'string' &&
      typeof o.mimeType === 'string' &&
      typeof o.html === 'string'
    ) {
      inner.push({
        type: 'mcp_ui',
        uri: o.uri,
        mimeType: o.mimeType,
        html: o.html,
        ...(typeof o.serverId === 'string' ? { serverId: o.serverId } : {}),
      });
    }
  }
  return inner;
}

/**
 * Synthesize canceled tool_result blocks for any tool_use without a paired
 * tool_result. Returns the augmented block list. Used by the conversation
 * loader so `statusOf` resolves to `canceled` on resume without any run-state
 * mutation.
 */
export function applyReplayCancelMarkers(blocks: readonly ContentBlock[]): readonly ContentBlock[] {
  const haveResult = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'tool_result') haveResult.add(b.tool_use_id);
  }
  const out: ContentBlock[] = blocks.slice();
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue;
    if (haveResult.has(b.id)) continue;
    out.push({
      type: 'tool_result',
      tool_use_id: b.id,
      content: '(canceled)',
      is_error: true,
    });
  }
  return out;
}

function parseWidget(raw: unknown): StoredMessage['widget'] {
  if (raw === null || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const kind = typeof obj.kind === 'string' ? obj.kind : null;
  if (kind === null) return undefined;
  return { kind, props: obj.props };
}

function parseTokens(raw: unknown): StoredTokenUsage | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const input = typeof obj.input === 'number' ? obj.input : null;
  const output = typeof obj.output === 'number' ? obj.output : null;
  const total = typeof obj.total === 'number' ? obj.total : null;
  if (input === null || output === null || total === null) return undefined;
  const source = obj.source === 'api' || obj.source === 'estimate' ? obj.source : undefined;
  return { input, output, total, ...(source !== undefined ? { source } : {}) };
}

function parseBanner(raw: unknown): StoredMessage['banner'] {
  if (raw === null || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const kind = typeof obj.kind === 'string' ? obj.kind : null;
  if (kind === null) return undefined;
  const toolCount = typeof obj.toolCount === 'number' ? obj.toolCount : undefined;
  const message = typeof obj.message === 'string' ? obj.message : undefined;
  return {
    kind,
    ...(toolCount !== undefined ? { toolCount } : {}),
    ...(message !== undefined ? { message } : {}),
  };
}

function isStoredRole(v: unknown): v is StoredRole {
  return v === 'user' || v === 'assistant' || v === 'tool' || v === 'banner' || v === 'widget';
}

function collectExtras(
  obj: Record<string, unknown>,
  known: ReadonlySet<string>,
  ctx: ParseContext,
  path: string,
  ignored?: ReadonlySet<string>,
): Readonly<Record<string, unknown>> | undefined {
  let result: Record<string, unknown> | undefined;
  for (const key of Object.keys(obj)) {
    if (known.has(key)) continue;
    if (ignored?.has(key) === true) continue;
    if (result === undefined) result = {};
    result[key] = obj[key];
    ctx.logger?.info('conversation.schema.unknown-field', {
      path: ctx.path,
      field: path === '' ? key : `${path}.${key}`,
    });
  }
  return result;
}

export function serializeThread(thread: StoredThread): string {
  const raw: Record<string, unknown> = {
    id: thread.id,
    schemaVersion: thread.schemaVersion,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    metadata: serializeMetadata(thread.metadata),
    messages: thread.messages.map((m) => serializeMessage(m)),
  };
  if (thread.extras !== undefined) {
    for (const [k, v] of Object.entries(thread.extras)) raw[k] = v;
  }
  return JSON.stringify(raw, null, 2);
}

function serializeMetadata(m: StoredThreadMetadata): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    allowedTools: [...m.allowedTools],
  };
  if (m.title !== undefined) raw.title = m.title;
  if (m.extras !== undefined) {
    for (const [k, v] of Object.entries(m.extras)) raw[k] = v;
  }
  return raw;
}

function serializeMessage(msg: StoredMessage): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.createdAt,
  };
  if (msg.status !== undefined) raw.status = msg.status;
  if (msg.tokens !== undefined) raw.tokens = { ...msg.tokens };
  if (msg.banner !== undefined) raw.banner = { ...msg.banner };
  if (msg.widget !== undefined) raw.widget = { ...msg.widget };
  if (msg.toolUse !== undefined) raw.toolUse = msg.toolUse;
  if (msg.toolResult !== undefined) raw.toolResult = msg.toolResult;
  if (msg.blocks !== undefined) raw.blocks = msg.blocks.map((b) => ({ ...b }));
  if (msg.extras !== undefined) {
    for (const [k, v] of Object.entries(msg.extras)) raw[k] = v;
  }
  return raw;
}
