import * as http from 'node:http';
import * as https from 'node:https';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  McpPromptContent,
  McpPromptInfo,
  McpPromptMessage,
  McpResourceContent,
  McpResourceInfo,
  McpToolInfo,
  McpTransportConnection,
  McpTransportFactory,
} from './mcpClient';
import type { McpServerConfig } from './config';
import type { JsonSchema } from '@/tools/types';
import { createNodeFetch } from './nodeFetch';

interface ClientIdentity {
  readonly name: string;
  readonly version: string;
}

export interface SdkTransportFactoryOptions {
  readonly clientIdentity?: ClientIdentity;
  readonly fetchImpl?: typeof fetch;
  readonly logger?: {
    info(event: string, fields: Record<string, unknown>): void;
    warn(event: string, fields: Record<string, unknown>): void;
  };
  readonly connectTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

const DEFAULT_IDENTITY: ClientIdentity = { name: 'leo', version: '0.1.0' };

export function createSdkTransportFactory(
  opts: SdkTransportFactoryOptions = {},
): McpTransportFactory {
  const identity = opts.clientIdentity ?? DEFAULT_IDENTITY;
  const fetchImpl =
    opts.fetchImpl ??
    createNodeFetch(opts.logger !== undefined ? { http, https, logger: opts.logger } : undefined);
  const connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  return {
    async connect(config: McpServerConfig, signal?: AbortSignal): Promise<McpTransportConnection> {
      const transport = buildTransport(config, fetchImpl);
      const client = new Client(
        { name: identity.name, version: identity.version },
        { capabilities: {} },
      );
      const timeoutCtrl = new AbortController();
      const composed = combineSignals(signal, timeoutCtrl.signal);
      const timer = setTimeout(() => timeoutCtrl.abort(), connectTimeoutMs);
      try {
        await client.connect(transport, { signal: composed });
      } catch (err) {
        try {
          await transport.close();
        } catch {
          /* ignore */
        }
        if (timeoutCtrl.signal.aborted) {
          throw new Error(`mcp connect timeout after ${connectTimeoutMs}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
      return wrapClient(client, config.transport);
    },
  };
}

function combineSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (a === undefined) return b;
  const ctrl = new AbortController();
  const onAbort = (): void => ctrl.abort();
  if (a.aborted || b.aborted) ctrl.abort();
  else {
    a.addEventListener('abort', onAbort, { once: true });
    b.addEventListener('abort', onAbort, { once: true });
  }
  return ctrl.signal;
}

function buildTransport(
  config: McpServerConfig,
  fetchImpl: typeof fetch,
): StdioClientTransport | StreamableHTTPClientTransport {
  if (config.transport === 'stdio') {
    return new StdioClientTransport({
      command: config.command,
      ...(config.args !== undefined ? { args: [...config.args] } : {}),
      ...(config.env !== undefined ? { env: { ...config.env } } : {}),
    });
  }
  const url = new URL(config.url);
  const headers = config.headers;
  const requestInit: RequestInit | undefined =
    headers !== undefined && Object.keys(headers).length > 0
      ? { headers: { ...headers } }
      : undefined;
  return new StreamableHTTPClientTransport(url, {
    fetch: fetchImpl,
    ...(requestInit !== undefined ? { requestInit } : {}),
  });
}

function wrapClient(client: Client, kind: 'stdio' | 'http'): McpTransportConnection {
  return {
    kind,
    async listTools(): Promise<readonly McpToolInfo[]> {
      const res = await client.listTools();
      return res.tools.map(
        (t): McpToolInfo => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: (t.inputSchema ?? { type: 'object' }) as JsonSchema,
        }),
      );
    },
    async listResources(): Promise<readonly McpResourceInfo[]> {
      try {
        const res = await client.listResources();
        return res.resources.map(
          (r): McpResourceInfo => ({
            uri: r.uri,
            ...(r.name !== undefined ? { name: r.name } : {}),
            ...(r.description !== undefined ? { description: r.description } : {}),
            ...(r.mimeType !== undefined ? { mimeType: r.mimeType } : {}),
          }),
        );
      } catch (err) {
        if (isMethodNotFound(err)) return [];
        throw err;
      }
    },
    async listPrompts(): Promise<readonly McpPromptInfo[]> {
      try {
        const res = await client.listPrompts();
        return res.prompts.map(
          (p): McpPromptInfo => ({
            name: p.name,
            ...(p.description !== undefined ? { description: p.description } : {}),
            ...(p.arguments !== undefined ? { arguments: [...p.arguments] } : {}),
          }),
        );
      } catch (err) {
        if (isMethodNotFound(err)) return [];
        throw err;
      }
    },
    async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
      const params: { name: string; arguments?: Record<string, unknown> } = { name };
      if (args !== undefined && args !== null) {
        params.arguments = args as Record<string, unknown>;
      }
      const result = await client.callTool(params, undefined, signalOpts(signal));
      if ((result as { isError?: unknown }).isError === true) {
        const err = new Error(extractErrorText(result as { content?: unknown })) as Error & {
          data?: unknown;
        };
        const structured = (result as { structuredContent?: unknown }).structuredContent;
        if (structured !== undefined) err.data = structured;
        throw err;
      }
      return result;
    },
    async readResource(uri: string, signal?: AbortSignal): Promise<McpResourceContent> {
      const res = await client.readResource({ uri }, signalOpts(signal));
      const first = res.contents[0] as
        | { uri?: string; mimeType?: string; text?: string; blob?: string }
        | undefined;
      if (first === undefined) {
        throw new Error(`empty resource: ${uri}`);
      }
      const out: { uri: string; mimeType?: string; text?: string; blob?: Uint8Array } = {
        uri: first.uri ?? uri,
      };
      if (typeof first.mimeType === 'string') out.mimeType = first.mimeType;
      if (typeof first.text === 'string') out.text = first.text;
      if (typeof first.blob === 'string') out.blob = base64ToBytes(first.blob);
      return out;
    },
    async getPrompt(
      name: string,
      args: Record<string, unknown> | undefined,
      signal?: AbortSignal,
    ): Promise<McpPromptContent> {
      const params: { name: string; arguments?: Record<string, string> } = { name };
      if (args !== undefined) params.arguments = stringifyArgs(args);
      const res = await client.getPrompt(params, signalOpts(signal));
      const messages = res.messages.map(
        (m): McpPromptMessage => ({
          role: normalizeRole(m.role),
          content: extractMessageText(m.content),
        }),
      );
      return {
        ...(res.description !== undefined ? { description: res.description } : {}),
        messages,
      };
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

function signalOpts(signal: AbortSignal | undefined): { signal: AbortSignal } | undefined {
  return signal !== undefined ? { signal } : undefined;
}

function isMethodNotFound(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === -32601 || code === -32_601) return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && /method not found/i.test(message);
}

function extractErrorText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return 'mcp tool error';
  const parts: string[] = [];
  for (const c of result.content) {
    if (c !== null && typeof c === 'object' && (c as { type?: unknown }).type === 'text') {
      const text = (c as { text?: unknown }).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join('\n') : 'mcp tool error';
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      const text = (c as { text?: unknown } | null)?.text;
      if (typeof text === 'string') parts.push(text);
    }
    return parts.join('\n');
  }
  if (content !== null && typeof content === 'object') {
    const text = (content as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

function normalizeRole(role: string): McpPromptMessage['role'] {
  if (role === 'system' || role === 'user' || role === 'assistant') return role;
  return 'user';
}

function stringifyArgs(args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
