export type McpTransportKind = 'stdio' | 'http';

export interface McpStdioConfig {
  readonly id: string;
  readonly enabled: boolean;
  readonly transport: 'stdio';
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
  readonly [extra: string]: unknown;
}

export interface McpHttpConfig {
  readonly id: string;
  readonly enabled: boolean;
  readonly transport: 'http';
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly [extra: string]: unknown;
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig;

export interface McpConfigFile {
  readonly mcpServers?: readonly McpServerConfig[];
}

export interface ParseError {
  readonly index: number;
  readonly reason: string;
}

export interface ParseResult {
  readonly configs: readonly McpServerConfig[];
  readonly errors: readonly ParseError[];
}

export function parseMcpConfig(raw: unknown): ParseResult {
  const errors: ParseError[] = [];
  if (raw === null || typeof raw !== 'object') {
    return { configs: [], errors: [{ index: -1, reason: 'root is not an object' }] };
  }
  const servers = (raw as { mcpServers?: unknown }).mcpServers;
  if (servers === undefined) return { configs: [], errors };
  if (!Array.isArray(servers)) {
    return { configs: [], errors: [{ index: -1, reason: 'mcpServers is not an array' }] };
  }
  const configs: McpServerConfig[] = [];
  servers.forEach((entry, i) => {
    const parsed = parseEntry(entry, i);
    if (parsed.ok) configs.push(parsed.data);
    else errors.push({ index: i, reason: parsed.error });
  });
  return { configs, errors };
}

function parseEntry(
  raw: unknown,
  idx: number,
): { ok: true; data: McpServerConfig } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: `entry ${idx} is not an object` };
  }
  const obj = raw as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, error: `entry ${idx} missing id` };
  }
  const enabled = obj.enabled;
  if (typeof enabled !== 'boolean') {
    return { ok: false, error: `entry ${idx} (${id}) missing enabled boolean` };
  }
  const rawTransport = obj.transport;
  if (rawTransport !== 'stdio' && rawTransport !== 'http' && rawTransport !== 'sse') {
    return { ok: false, error: `entry ${idx} (${id}) invalid transport` };
  }
  const transport: 'stdio' | 'http' = rawTransport === 'sse' ? 'http' : rawTransport;
  if (transport === 'stdio') {
    const command = obj.command;
    if (typeof command !== 'string' || command.length === 0) {
      return { ok: false, error: `entry ${idx} (${id}) missing command` };
    }
    const args = Array.isArray(obj.args)
      ? (obj.args.filter((x) => typeof x === 'string') as string[])
      : undefined;
    const env = isStringMap(obj.env) ? (obj.env as Record<string, string>) : undefined;
    const data: McpStdioConfig = {
      ...obj,
      id,
      enabled,
      transport,
      command,
      ...(args !== undefined ? { args } : {}),
      ...(env !== undefined ? { env } : {}),
    };
    return { ok: true, data };
  }
  const url = obj.url;
  if (typeof url !== 'string' || url.length === 0) {
    return { ok: false, error: `entry ${idx} (${id}) missing url` };
  }
  const headers = isStringMap(obj.headers) ? (obj.headers as Record<string, string>) : undefined;
  const data: McpHttpConfig = {
    ...obj,
    id,
    enabled,
    transport,
    url,
    ...(headers !== undefined ? { headers } : {}),
  };
  return { ok: true, data };
}

function isStringMap(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val !== 'string') return false;
  }
  return true;
}

export const SAFE_STORAGE_PREFIX = 'safestorage:';

export interface SafeStorageLike {
  get(key: string): Promise<string | null>;
}

export async function resolveSecrets<T extends Record<string, string>>(
  input: T | undefined,
  secrets: SafeStorageLike,
): Promise<T | undefined> {
  if (input === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v.startsWith(SAFE_STORAGE_PREFIX)) {
      const key = v.slice(SAFE_STORAGE_PREFIX.length);
      const plain = await secrets.get(key);
      out[k] = plain ?? '';
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export async function resolveSecretsForConfig(
  config: McpServerConfig,
  secrets: SafeStorageLike,
): Promise<McpServerConfig> {
  if (config.transport === 'stdio') {
    const env = await resolveSecrets(config.env, secrets);
    return { ...config, ...(env !== undefined ? { env } : {}) };
  }
  const headers = await resolveSecrets(config.headers, secrets);
  return { ...config, ...(headers !== undefined ? { headers } : {}) };
}
