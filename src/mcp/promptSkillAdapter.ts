// MCP prompt body cache. The old skill adapter is parked until MCP-sourced
// skills (doc §12) are reintegrated into the new registry; for now the plugin
// only depends on the cache plus the body-rendering helper.

import type { McpPromptContent, McpPromptInfo } from './mcpClient';

export interface McpPromptEnvelope {
  readonly serverId: string;
  readonly prompt: McpPromptInfo;
}

export function resolvePromptBody(content: McpPromptContent): string {
  const parts: string[] = [];
  if (content.description !== undefined) parts.push(content.description);
  for (const msg of content.messages) {
    if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant') {
      parts.push(msg.content);
    }
  }
  return parts.join('\n\n').trim();
}

export class McpPromptCache {
  private readonly cache = new Map<string, string>();

  put(serverId: string, promptName: string, body: string): void {
    this.cache.set(keyFor(serverId, promptName), body);
  }

  get(serverId: string, promptName: string): string | null {
    return this.cache.get(keyFor(serverId, promptName)) ?? null;
  }

  invalidateServer(serverId: string): void {
    const prefix = `${serverId}|`;
    for (const k of [...this.cache.keys()]) {
      if (k.startsWith(prefix)) this.cache.delete(k);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

function keyFor(serverId: string, promptName: string): string {
  return `${serverId}|${promptName}`;
}
