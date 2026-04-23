import type { Logger } from '@/platform/Logger';

export const CONVERSATION_SCHEMA_VERSION = 1;

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
    ...(extras !== undefined ? { extras } : {}),
  };
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
  if (msg.extras !== undefined) {
    for (const [k, v] of Object.entries(msg.extras)) raw[k] = v;
  }
  return raw;
}
