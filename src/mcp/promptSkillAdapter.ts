import type { Skill } from '@/agent/types';
import type { McpPromptContent, McpPromptInfo } from './mcpClient';

export interface McpPromptEnvelope {
  readonly serverId: string;
  readonly prompt: McpPromptInfo;
}

export interface McpPromptSkill extends Skill {
  readonly source: 'mcp';
  readonly mcpServerId: string;
  readonly resolved: boolean;
}

export function adaptPromptToSkill(envelope: McpPromptEnvelope): McpPromptSkill {
  const id = `mcp.${envelope.serverId}.${envelope.prompt.name}`;
  return {
    id,
    source: 'mcp',
    mcpServerId: envelope.serverId,
    systemPrompt: '',
    resolved: false,
    examples: [],
  };
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

export interface SkillCatalog {
  list(): readonly Skill[];
}

export interface McpSkillSource {
  list(): readonly McpPromptEnvelope[];
}

export class CompositeSkillSource implements SkillCatalog {
  constructor(
    private readonly builtIn: SkillCatalog,
    private readonly mcp: McpSkillSource,
  ) {}

  list(): readonly Skill[] {
    const built = [...this.builtIn.list()];
    const extras = this.mcp.list().map((env) => adaptPromptToSkill(env));
    return [...built, ...extras];
  }
}
