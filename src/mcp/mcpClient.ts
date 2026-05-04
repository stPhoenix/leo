import { z } from 'zod';
import type { Logger } from '@/platform/Logger';
import type { JsonSchema, ToolCtx, ToolResult, ToolSpec } from '@/tools/types';
import type { ToolRegistry } from '@/tools/toolRegistry';

// MCP tools advertise their own JsonSchema via the server handshake; we keep
// that for LLM tool-calling and satisfy the zod contract with a permissive
// pass-through schema.
const mcpPermissiveSchema: z.ZodType<unknown> = z.unknown();
import {
  parseMcpConfig,
  resolveSecretsForConfig,
  type McpServerConfig,
  type SafeStorageLike,
} from './config';

export type ServerStatus = 'pending' | 'connected' | 'failed' | 'closed';

export interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

export interface McpResourceInfo {
  readonly uri: string;
  readonly name?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpPromptInfo {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly {
    readonly name: string;
    readonly description?: string;
    readonly required?: boolean;
  }[];
}

export interface McpCallToolResult {
  readonly ok: true;
  readonly data: unknown;
}

export interface McpTransportConnection {
  readonly kind: 'stdio' | 'sse';
  listTools(): Promise<readonly McpToolInfo[]>;
  listResources(): Promise<readonly McpResourceInfo[]>;
  listPrompts(): Promise<readonly McpPromptInfo[]>;
  callTool(name: string, args: unknown, signal?: AbortSignal): Promise<unknown>;
  readResource?(uri: string, signal?: AbortSignal): Promise<McpResourceContent>;
  getPrompt?(
    name: string,
    args: Record<string, unknown> | undefined,
    signal?: AbortSignal,
  ): Promise<McpPromptContent>;
  close(): Promise<void>;
}

export interface McpPromptMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface McpPromptContent {
  readonly description?: string;
  readonly messages: readonly McpPromptMessage[];
}

export interface McpResourceContent {
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
  readonly blob?: Uint8Array;
}

export interface McpTransportFactory {
  connect(config: McpServerConfig, signal?: AbortSignal): Promise<McpTransportConnection>;
}

export interface ServerRuntime {
  readonly id: string;
  readonly config: McpServerConfig;
  readonly status: ServerStatus;
  readonly tools: readonly McpToolInfo[];
  readonly resources: readonly McpResourceInfo[];
  readonly prompts: readonly McpPromptInfo[];
  readonly error?: string;
  readonly connection?: McpTransportConnection;
}

export interface McpClientOptions {
  readonly logger: Logger;
  readonly transportFactory: McpTransportFactory;
  readonly registry: ToolRegistry;
  readonly secrets: SafeStorageLike;
  readonly clock?: () => number;
}

export function namespaceTool(serverId: string, toolName: string): string {
  return `mcp.${serverId}.${toolName}`;
}

export class MCPClient {
  private readonly logger: Logger;
  private readonly transportFactory: McpTransportFactory;
  private readonly registry: ToolRegistry;
  private readonly secrets: SafeStorageLike;
  private readonly clock: () => number;
  private readonly servers = new Map<string, ServerRuntime>();
  private readonly listeners = new Set<
    (event: { serverId: string; status: ServerStatus }) => void
  >();

  constructor(opts: McpClientOptions) {
    this.logger = opts.logger;
    this.transportFactory = opts.transportFactory;
    this.registry = opts.registry;
    this.secrets = opts.secrets;
    this.clock = opts.clock ?? ((): number => Date.now());
  }

  loadConfig(raw: unknown): readonly McpServerConfig[] {
    const parsed = parseMcpConfig(raw);
    for (const err of parsed.errors) {
      this.logger.warn('mcp.config.parse.fail', {
        index: err.index,
        reason: err.reason,
      });
    }
    return parsed.configs;
  }

  connectAll(
    configs: readonly McpServerConfig[],
    signal?: AbortSignal,
  ): Promise<PromiseSettledResult<ServerRuntime>[]> {
    const enabled = configs.filter((c) => c.enabled);
    const promises = enabled.map(
      async (cfg): Promise<ServerRuntime> => this.connectOne(cfg, signal),
    );
    return Promise.allSettled(promises);
  }

  private async connectOne(config: McpServerConfig, signal?: AbortSignal): Promise<ServerRuntime> {
    const start = this.clock();
    this.logger.info('mcp.connect.start', {
      serverId: config.id,
      transport: config.transport,
    });
    const initial: ServerRuntime = {
      id: config.id,
      config,
      status: 'pending',
      tools: [],
      resources: [],
      prompts: [],
    };
    this.servers.set(config.id, initial);
    this.notifyStatus(config.id, 'pending');
    let connection: McpTransportConnection | undefined;
    try {
      const resolvedConfig = await resolveSecretsForConfig(config, this.secrets);
      connection = await this.transportFactory.connect(resolvedConfig, signal);
      const [tools, resources, prompts] = await Promise.all([
        connection.listTools(),
        connection.listResources(),
        connection.listPrompts(),
      ]);
      for (const tool of tools) {
        this.registerTool(config.id, tool);
      }
      const runtime: ServerRuntime = {
        ...initial,
        status: 'connected',
        tools,
        resources,
        prompts,
        connection,
      };
      this.servers.set(config.id, runtime);
      this.notifyStatus(config.id, 'connected');
      this.logger.info('mcp.discovery.ok', {
        serverId: config.id,
        toolCount: tools.length,
        resourceCount: resources.length,
        promptCount: prompts.length,
      });
      this.logger.info('mcp.connect.ok', {
        serverId: config.id,
        transport: config.transport,
        durationMs: this.clock() - start,
      });
      return runtime;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const runtime: ServerRuntime = {
        ...initial,
        status: 'failed',
        error,
      };
      this.servers.set(config.id, runtime);
      this.notifyStatus(config.id, 'failed');
      this.logger.warn('mcp.connect.fail', {
        serverId: config.id,
        transport: config.transport,
        error,
        durationMs: this.clock() - start,
      });
      if (connection !== undefined) {
        try {
          await connection.close();
        } catch {
          /* ignore */
        }
      }
      return runtime;
    }
  }

  getServer(id: string): ServerRuntime | undefined {
    return this.servers.get(id);
  }

  listServers(): readonly ServerRuntime[] {
    return [...this.servers.values()];
  }

  listResources(serverId?: string): readonly { serverId: string; resource: McpResourceInfo }[] {
    const out: { serverId: string; resource: McpResourceInfo }[] = [];
    for (const runtime of this.servers.values()) {
      if (serverId !== undefined && runtime.id !== serverId) continue;
      for (const r of runtime.resources) out.push({ serverId: runtime.id, resource: r });
    }
    return out;
  }

  listPrompts(serverId?: string): readonly { serverId: string; prompt: McpPromptInfo }[] {
    const out: { serverId: string; prompt: McpPromptInfo }[] = [];
    for (const runtime of this.servers.values()) {
      if (serverId !== undefined && runtime.id !== serverId) continue;
      for (const p of runtime.prompts) out.push({ serverId: runtime.id, prompt: p });
    }
    return out;
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: unknown,
    ctx: ToolCtx,
  ): Promise<ToolResult<unknown>> {
    const runtime = this.servers.get(serverId);
    if (runtime?.connection === undefined) {
      return { ok: false, error: `mcp server not connected: ${serverId}` };
    }
    const start = this.clock();
    this.logger.info('mcp.tool.invoke.start', {
      serverId,
      toolName,
    });
    try {
      const data = await runtime.connection.callTool(toolName, args, ctx.signal);
      this.logger.info('mcp.tool.invoke.ok', {
        serverId,
        toolName,
        durationMs: this.clock() - start,
      });
      return { ok: true, data };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn('mcp.tool.invoke.error', {
        serverId,
        toolName,
        error,
        durationMs: this.clock() - start,
      });
      return { ok: false, error };
    }
  }

  async readResource(
    serverId: string,
    uri: string,
    signal?: AbortSignal,
  ): Promise<{ ok: true; data: McpResourceContent } | { ok: false; error: string }> {
    const runtime = this.servers.get(serverId);
    if (runtime?.connection === undefined) {
      return { ok: false, error: `mcp server not connected: ${serverId}` };
    }
    if (runtime.connection.readResource === undefined) {
      return { ok: false, error: `resources/read not supported by ${serverId}` };
    }
    const start = this.clock();
    try {
      const content = await runtime.connection.readResource(uri, signal);
      this.logger.info('mcp.resource.read.ok', {
        serverId,
        uri,
        mimeType: content.mimeType,
        bytes: content.text?.length ?? content.blob?.byteLength ?? 0,
        durationMs: this.clock() - start,
      });
      return { ok: true, data: content };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn('mcp.resource.read.err', {
        serverId,
        uri,
        error,
        durationMs: this.clock() - start,
      });
      return { ok: false, error };
    }
  }

  async getPrompt(
    serverId: string,
    promptName: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ ok: true; data: McpPromptContent } | { ok: false; error: string }> {
    const runtime = this.servers.get(serverId);
    if (runtime?.connection === undefined) {
      return { ok: false, error: `mcp server not connected: ${serverId}` };
    }
    if (runtime.connection.getPrompt === undefined) {
      return { ok: false, error: `prompts/get not supported by ${serverId}` };
    }
    const start = this.clock();
    try {
      const data = await runtime.connection.getPrompt(promptName, args, signal);
      this.logger.info('skill.mcp.resolve.ok', {
        serverId,
        promptName,
        durationMs: this.clock() - start,
      });
      return { ok: true, data };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn('skill.mcp.resolve.err', {
        serverId,
        promptName,
        error,
        durationMs: this.clock() - start,
      });
      return { ok: false, error };
    }
  }

  onStatusChange(
    listener: (event: { serverId: string; status: ServerStatus }) => void,
  ): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  async disconnect(serverId: string): Promise<void> {
    const runtime = this.servers.get(serverId);
    if (runtime === undefined) return;
    if (runtime.connection !== undefined) {
      try {
        await runtime.connection.close();
      } catch (err) {
        this.logger.warn('mcp.disconnect.error', {
          serverId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const next: ServerRuntime = { ...runtime, status: 'closed' };
    this.servers.set(serverId, next);
    this.notifyStatus(serverId, 'closed');
    this.unregisterServerTools(serverId, runtime.tools);
  }

  async reload(config: McpServerConfig, signal?: AbortSignal): Promise<ServerRuntime> {
    await this.disconnect(config.id);
    this.servers.delete(config.id);
    return this.connectOne(config, signal);
  }

  private unregisterServerTools(serverId: string, tools: readonly McpToolInfo[]): void {
    for (const t of tools) {
      const id = namespaceTool(serverId, t.name);
      if (
        typeof (this.registry as unknown as { unregister?: (id: string) => void }).unregister ===
        'function'
      ) {
        (this.registry as unknown as { unregister: (id: string) => void }).unregister(id);
      }
    }
  }

  private notifyStatus(serverId: string, status: ServerStatus): void {
    for (const l of this.listeners) {
      try {
        l({ serverId, status });
      } catch {
        /* ignore listener errors */
      }
    }
  }

  async disconnectAll(): Promise<void> {
    const closings: Promise<void>[] = [];
    for (const runtime of this.servers.values()) {
      if (runtime.connection !== undefined) {
        closings.push(
          runtime.connection.close().catch((err) => {
            this.logger.warn('mcp.disconnect.error', {
              serverId: runtime.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }),
        );
      }
      this.servers.set(runtime.id, { ...runtime, status: 'closed' });
    }
    await Promise.allSettled(closings);
  }

  private registerTool(serverId: string, tool: McpToolInfo): void {
    const id = namespaceTool(serverId, tool.name);
    const spec: ToolSpec<unknown, unknown> & {
      readonly source: 'mcp';
      readonly mcpServerId: string;
    } = {
      id,
      description: tool.description,
      schema: mcpPermissiveSchema,
      parameters: tool.inputSchema,
      requiresConfirmation: true,
      source: 'mcp',
      isMcp: true,
      mcpServerId: serverId,
      validate: (raw): ToolResult<unknown> => ({ ok: true, data: raw }),
      invoke: async (args, ctx): Promise<ToolResult<unknown>> =>
        this.callTool(serverId, tool.name, args, ctx),
    };
    try {
      this.registry.register(spec as ToolSpec<unknown, unknown>);
      this.logger.info('mcp.tool.register', {
        serverId,
        toolName: tool.name,
        toolId: id,
      });
      this.logger.debug('mcp.tool.confirmation.default', {
        serverId,
        toolId: id,
        requiresConfirmation: true,
      });
    } catch (err) {
      this.logger.warn('mcp.tool.register.fail', {
        serverId,
        toolName: tool.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
