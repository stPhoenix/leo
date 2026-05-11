import type { Logger } from '@/platform/Logger';
import type { MCPClient } from './mcpClient';
import type { ConfirmationController, ConfirmationDecision } from '@/agent/confirmationController';
import { prettifyArgs } from '@/agent/confirmationController';
import { namespaceTool } from './mcpClient';
import type { ToolCtx } from '@/tools/types';

export type McpUiActionType = 'tool' | 'prompt' | 'link' | 'notify';

export interface McpUiToolAction {
  readonly type: 'tool';
  readonly payload: {
    readonly toolName: string;
    readonly params?: Record<string, unknown>;
  };
  readonly messageId?: string;
}

export interface McpUiPromptAction {
  readonly type: 'prompt';
  readonly payload: { readonly prompt: string };
  readonly messageId?: string;
}

export interface McpUiLinkAction {
  readonly type: 'link';
  readonly payload: { readonly url: string };
  readonly messageId?: string;
}

export interface McpUiNotifyAction {
  readonly type: 'notify';
  readonly payload: { readonly message: string };
  readonly messageId?: string;
}

export type McpUiAction = McpUiToolAction | McpUiPromptAction | McpUiLinkAction | McpUiNotifyAction;

export interface McpUiActionResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: unknown;
}

export interface McpUiActionDeps {
  readonly serverId: string;
  readonly thread: string;
  readonly mcpClient: MCPClient;
  readonly confirmation: ConfirmationController;
  readonly logger: Logger;
  readonly signal: AbortSignal;
  readonly submitPrompt: (text: string) => void;
  readonly openLink: (url: string) => void;
  readonly notify: (message: string) => void;
  readonly buildToolCtx: () => ToolCtx;
}

const ALLOWED_LINK_SCHEMES = new Set(['http:', 'https:']);

export async function routeMcpUiAction(
  action: McpUiAction,
  deps: McpUiActionDeps,
): Promise<McpUiActionResponse> {
  deps.logger.info('mcp.ui.action', {
    serverId: deps.serverId,
    thread: deps.thread,
    type: action.type,
  });
  switch (action.type) {
    case 'tool':
      return handleToolAction(action, deps);
    case 'prompt':
      return handlePromptAction(action, deps);
    case 'link':
      return handleLinkAction(action, deps);
    case 'notify':
      return handleNotifyAction(action, deps);
    default: {
      const t = (action as { type: string }).type;
      deps.logger.warn('mcp.ui.action.unknown', { serverId: deps.serverId, type: t });
      return { ok: false, error: `unknown action type: ${t}` };
    }
  }
}

async function handleToolAction(
  action: McpUiToolAction,
  deps: McpUiActionDeps,
): Promise<McpUiActionResponse> {
  const toolName = action.payload.toolName;
  if (typeof toolName !== 'string' || toolName.length === 0) {
    return { ok: false, error: 'tool action missing toolName' };
  }
  const params = action.payload.params ?? {};
  const argsJson = JSON.stringify(params);
  const decision: ConfirmationDecision = await deps.confirmation.request({
    toolId: namespaceTool(deps.serverId, toolName),
    thread: deps.thread,
    argsJson,
    argsPretty: prettifyArgs(argsJson),
    category: 'write',
    disableAllowForThread: true,
  });
  if (decision === 'deny') {
    deps.logger.info('mcp.ui.action.tool.denied', {
      serverId: deps.serverId,
      toolName,
    });
    return { ok: false, error: 'user denied tool call' };
  }
  const result = await deps.mcpClient.callTool(
    deps.serverId,
    toolName,
    params,
    deps.buildToolCtx(),
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, data: result.data };
}

function handlePromptAction(action: McpUiPromptAction, deps: McpUiActionDeps): McpUiActionResponse {
  const text = action.payload.prompt;
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, error: 'prompt action missing prompt text' };
  }
  deps.submitPrompt(text);
  return { ok: true };
}

function handleLinkAction(action: McpUiLinkAction, deps: McpUiActionDeps): McpUiActionResponse {
  const raw = action.payload.url;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'link action missing url' };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'invalid url' };
  }
  if (!ALLOWED_LINK_SCHEMES.has(parsed.protocol)) {
    deps.logger.warn('mcp.ui.action.link.blocked', {
      serverId: deps.serverId,
      scheme: parsed.protocol,
    });
    return { ok: false, error: `blocked url scheme: ${parsed.protocol}` };
  }
  deps.openLink(parsed.toString());
  return { ok: true };
}

function handleNotifyAction(action: McpUiNotifyAction, deps: McpUiActionDeps): McpUiActionResponse {
  const message = action.payload.message;
  if (typeof message !== 'string' || message.length === 0) {
    return { ok: false, error: 'notify action missing message' };
  }
  deps.notify(message);
  return { ok: true };
}

export function parseMcpUiAction(raw: unknown): McpUiAction | null {
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type !== 'string') return null;
  const payload = (obj.payload ?? {}) as Record<string, unknown>;
  const messageId = typeof obj.messageId === 'string' ? obj.messageId : undefined;
  switch (obj.type) {
    case 'tool': {
      if (typeof payload.toolName !== 'string') return null;
      const params =
        payload.params !== undefined &&
        typeof payload.params === 'object' &&
        payload.params !== null
          ? (payload.params as Record<string, unknown>)
          : undefined;
      return {
        type: 'tool',
        payload: { toolName: payload.toolName, ...(params !== undefined ? { params } : {}) },
        ...(messageId !== undefined ? { messageId } : {}),
      };
    }
    case 'prompt':
      if (typeof payload.prompt !== 'string') return null;
      return {
        type: 'prompt',
        payload: { prompt: payload.prompt },
        ...(messageId !== undefined ? { messageId } : {}),
      };
    case 'link':
      if (typeof payload.url !== 'string') return null;
      return {
        type: 'link',
        payload: { url: payload.url },
        ...(messageId !== undefined ? { messageId } : {}),
      };
    case 'notify':
      if (typeof payload.message !== 'string') return null;
      return {
        type: 'notify',
        payload: { message: payload.message },
        ...(messageId !== undefined ? { messageId } : {}),
      };
    default:
      return null;
  }
}
