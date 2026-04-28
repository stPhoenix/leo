import type { Logger } from '@/platform/Logger';
import type { McpServerConfig, SafeStorageLike } from './config';
import { SAFE_STORAGE_PREFIX } from './config';

export interface SecretField {
  readonly key: string;
  readonly name: string;
  readonly value: string;
  readonly secret?: boolean;
}

export interface ConfigFileIo {
  read(): Promise<unknown>;
  write(data: { mcpServers: McpServerConfig[] }): Promise<void>;
}

export interface WritableSafeStorage extends SafeStorageLike {
  set(key: string, value: string): Promise<void>;
  remove?(key: string): Promise<void>;
}

export interface McpSettingsLoggerLike {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
}

export interface McpSettingsStoreOpts {
  readonly io: ConfigFileIo;
  readonly safeStorage: WritableSafeStorage;
  readonly logger: Logger | McpSettingsLoggerLike;
}

export function validateAddition(
  existing: readonly McpServerConfig[],
  candidate: McpServerConfig,
): string | null {
  if (!/^[-a-z0-9_]+$/i.test(candidate.id)) {
    return 'id must be non-empty URL-safe';
  }
  if (existing.some((e) => e.id === candidate.id)) {
    return `duplicate id: ${candidate.id}`;
  }
  if (candidate.transport === 'stdio') {
    if (candidate.command.length === 0) return 'command required';
  } else {
    if (!/^https?:\/\//.test(candidate.url)) return 'url must start with http(s)://';
  }
  return null;
}

export async function applySecretPlaceholders(
  fields: readonly SecretField[],
  safeStorage: WritableSafeStorage,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.secret === true) {
      await safeStorage.set(f.key, f.value);
      out[f.name] = `${SAFE_STORAGE_PREFIX}${f.key}`;
    } else {
      out[f.name] = f.value;
    }
  }
  return out;
}

export class McpSettingsStore {
  private readonly io: ConfigFileIo;
  private readonly safeStorage: WritableSafeStorage;
  private readonly logger: McpSettingsLoggerLike;

  constructor(opts: McpSettingsStoreOpts) {
    this.io = opts.io;
    this.safeStorage = opts.safeStorage;
    this.logger = opts.logger as McpSettingsLoggerLike;
  }

  async list(): Promise<readonly McpServerConfig[]> {
    const raw = await this.io.read();
    const root = raw as { mcpServers?: McpServerConfig[] } | null;
    return root?.mcpServers ?? [];
  }

  async add(entry: McpServerConfig): Promise<{ ok: true } | { ok: false; error: string }> {
    const existing = await this.list();
    const err = validateAddition([...existing], entry);
    if (err !== null) return { ok: false, error: err };
    await this.io.write({ mcpServers: [...existing, entry] });
    this.logger.info('mcp.settings.add', {
      serverId: entry.id,
      transport: entry.transport,
      enabled: entry.enabled,
    });
    return { ok: true };
  }

  async edit(
    id: string,
    updates: Partial<McpServerConfig>,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const existing = await this.list();
    const idx = existing.findIndex((e) => e.id === id);
    if (idx < 0) return { ok: false, error: `unknown id: ${id}` };
    const current = existing[idx]!;
    const next = { ...current, ...updates, id: current.id, transport: current.transport };
    const copy = [...existing];
    copy[idx] = next as McpServerConfig;
    await this.io.write({ mcpServers: copy });
    this.logger.info('mcp.settings.edit', {
      serverId: id,
      transport: current.transport,
    });
    return { ok: true };
  }

  async remove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const existing = await this.list();
    const idx = existing.findIndex((e) => e.id === id);
    if (idx < 0) return { ok: false, error: `unknown id: ${id}` };
    const copy = existing.filter((e) => e.id !== id);
    await this.io.write({ mcpServers: [...copy] });
    this.logger.info('mcp.settings.delete', {
      serverId: id,
    });
    return { ok: true };
  }

  async toggle(id: string): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> {
    const existing = await this.list();
    const idx = existing.findIndex((e) => e.id === id);
    if (idx < 0) return { ok: false, error: `unknown id: ${id}` };
    const current = existing[idx]!;
    const nextEnabled = !current.enabled;
    const next = { ...current, enabled: nextEnabled } as McpServerConfig;
    const copy = [...existing];
    copy[idx] = next;
    await this.io.write({ mcpServers: copy });
    this.logger.info('mcp.settings.toggle', {
      serverId: id,
      enabled: nextEnabled,
    });
    return { ok: true, enabled: nextEnabled };
  }
}
