import type { Logger } from '@/platform/Logger';
import type { ToolRegistry } from '@/tools/toolRegistry';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { SafeStorage } from '@/storage/safeStorage';
import {
  MCPClient,
  type McpTransportConnection,
  type McpTransportFactory,
  type ServerRuntime,
} from './mcpClient';
import type { McpServerConfig } from './config';
import {
  McpSettingsStore,
  type ConfigFileIo,
  type McpSettingsStoreOpts,
  type WritableSafeStorage,
} from './settingsStore';
import { ResourcePickerStore } from './resourcePicker';
import { McpPromptCache } from './promptSkillAdapter';
import {
  computeBackoffDelay,
  runReconnectLoop,
  shutdownStdioChild,
  MAX_RECONNECT_ATTEMPTS,
} from './reconnect';

export interface WireMcpOptions {
  readonly logger: Logger;
  readonly vault: VaultAdapter;
  readonly toolRegistry: ToolRegistry;
  readonly safeStorage: SafeStorage;
  readonly transportFactory?: McpTransportFactory;
  readonly configPath?: string;
}

export interface McpWiring {
  readonly client: MCPClient;
  readonly settingsStore: McpSettingsStore;
  readonly resourcePicker: ResourcePickerStore;
  readonly promptCache: McpPromptCache;
  readonly connectAll: () => Promise<readonly PromiseSettledResult<ServerRuntime>[]>;
  readonly shutdown: () => Promise<void>;
  readonly reconnect: {
    readonly computeBackoffDelay: typeof computeBackoffDelay;
    readonly runReconnectLoop: typeof runReconnectLoop;
    readonly shutdownStdioChild: typeof shutdownStdioChild;
    readonly MAX_RECONNECT_ATTEMPTS: number;
  };
}

export type { ReconnectHandle, ChildProcessLike } from './reconnect';

const DEFAULT_CONFIG_PATH = '.leo/config.json';

const NOOP_TRANSPORT: McpTransportFactory = {
  async connect(): Promise<McpTransportConnection> {
    throw new Error('mcp transport factory not installed — add @modelcontextprotocol/sdk wiring');
  },
};

function buildConfigFileIo(vault: VaultAdapter, path: string): ConfigFileIo {
  return {
    async read(): Promise<unknown> {
      if (!(await vault.exists(path))) return null;
      try {
        const raw = await vault.read(path);
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    async write(data): Promise<void> {
      await vault.mkdir('.leo');
      await vault.write(path, JSON.stringify(data, null, 2));
    },
  };
}

function adaptSafeStorage(safeStorage: SafeStorage): WritableSafeStorage {
  return {
    async get(key: string): Promise<string | null> {
      return safeStorage.get(key);
    },
    async set(key: string, value: string): Promise<void> {
      await safeStorage.set(key, value);
    },
    async remove(key: string): Promise<void> {
      await safeStorage.delete(key);
    },
  };
}

export async function wireMcp(opts: WireMcpOptions): Promise<McpWiring> {
  const configPath = opts.configPath ?? DEFAULT_CONFIG_PATH;
  const writableSafeStorage = adaptSafeStorage(opts.safeStorage);
  const settingsStoreOpts: McpSettingsStoreOpts = {
    logger: opts.logger,
    io: buildConfigFileIo(opts.vault, configPath),
    safeStorage: writableSafeStorage,
  };
  const settingsStore = new McpSettingsStore(settingsStoreOpts);

  const client = new MCPClient({
    logger: opts.logger,
    transportFactory: opts.transportFactory ?? NOOP_TRANSPORT,
    registry: opts.toolRegistry,
    secrets: writableSafeStorage,
  });

  const resourcePicker = new ResourcePickerStore();
  const promptCache = new McpPromptCache();

  const connectAll = async (): Promise<readonly PromiseSettledResult<ServerRuntime>[]> => {
    const configs: readonly McpServerConfig[] = await settingsStore.list();
    if (configs.length === 0) {
      opts.logger.info('mcp.client.ready', { servers: 0 });
      return [];
    }
    return client.connectAll(configs);
  };

  const shutdown = async (): Promise<void> => {
    try {
      await client.disconnectAll();
    } catch (err) {
      opts.logger.warn('mcp.shutdown.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return {
    client,
    settingsStore,
    resourcePicker,
    promptCache,
    connectAll,
    shutdown,
    reconnect: {
      computeBackoffDelay,
      runReconnectLoop,
      shutdownStdioChild,
      MAX_RECONNECT_ATTEMPTS,
    },
  };
}
