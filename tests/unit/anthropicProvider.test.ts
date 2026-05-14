import { describe, expect, it } from 'vitest';
import {
  AnthropicProvider,
  mergeSystemMessages,
  sanitizeToolNames,
  toAnthropicThinkingParam,
} from '@/providers/anthropicProvider';
import type { ChatMessage, OpenAITool } from '@/providers/types';

describe('AnthropicProvider', () => {
  it('listModels returns bundled default list', async () => {
    const provider = new AnthropicProvider({ apiKey: () => 'k' });
    const models = await provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id.startsWith('claude-'))).toBe(true);
  });

  it('listModels respects a user-supplied bundledModels list', async () => {
    const provider = new AnthropicProvider({
      apiKey: () => 'k',
      bundledModels: ['custom-anthropic-model'],
    });
    const models = await provider.listModels();
    expect(models).toEqual([{ id: 'custom-anthropic-model' }]);
  });

  it('reports id "anthropic"', () => {
    const provider = new AnthropicProvider({ apiKey: () => 'k' });
    expect(provider.id).toBe('anthropic');
  });
});

describe('mergeSystemMessages', () => {
  it('merges mid-conversation system messages into a single leading system', () => {
    const input: readonly ChatMessage[] = [
      { role: 'system', content: 'main prompt' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'reminder A' },
      { role: 'assistant', content: 'ok' },
      { role: 'system', content: 'reminder B' },
    ];
    const out = mergeSystemMessages(input);
    expect(out).toEqual([
      { role: 'system', content: 'main prompt\n\nreminder A\n\nreminder B' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('returns input unchanged when no system messages', () => {
    const input: readonly ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ];
    const out = mergeSystemMessages(input);
    expect(out).toEqual(input);
  });

  it('extracts text from system content blocks', () => {
    const input: readonly ChatMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'prompt' }] },
      { role: 'user', content: 'hi' },
      { role: 'system', content: [{ type: 'text', text: 'reminder' }] },
    ];
    const out = mergeSystemMessages(input);
    expect(out[0]).toEqual({ role: 'system', content: 'prompt\n\nreminder' });
    expect(out[1]).toEqual({ role: 'user', content: 'hi' });
    expect(out).toHaveLength(2);
  });

  it('skips empty system messages', () => {
    const input: readonly ChatMessage[] = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: '' },
    ];
    const out = mergeSystemMessages(input);
    expect(out).toEqual([
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'hi' },
    ]);
  });
});

describe('toAnthropicThinkingParam', () => {
  it('returns undefined when config is absent or disabled', () => {
    expect(toAnthropicThinkingParam(undefined)).toBeUndefined();
    expect(toAnthropicThinkingParam({ type: 'disabled' })).toBeUndefined();
  });

  it('passes through adaptive', () => {
    expect(toAnthropicThinkingParam({ type: 'adaptive' })).toEqual({ type: 'adaptive' });
  });

  it('maps enabled with budgetTokens to snake_case budget_tokens', () => {
    expect(toAnthropicThinkingParam({ type: 'enabled', budgetTokens: 8192 })).toEqual({
      type: 'enabled',
      budget_tokens: 8192,
    });
  });

  it('clamps enabled budget to the 1024 minimum', () => {
    expect(toAnthropicThinkingParam({ type: 'enabled', budgetTokens: 100 })).toEqual({
      type: 'enabled',
      budget_tokens: 1024,
    });
  });
});

describe('sanitizeToolNames', () => {
  const mkTool = (name: string): OpenAITool => ({
    type: 'function',
    function: { name, description: 'd', parameters: { type: 'object', properties: {} } },
  });

  it('passes names that already match Anthropic regex through unchanged', () => {
    const tools = [mkTool('read_note'), mkTool('Skill'), mkTool('TodoWrite-2')];
    const { tools: out, reverseMap } = sanitizeToolNames(tools);
    expect(out.map((t) => t.function.name)).toEqual(['read_note', 'Skill', 'TodoWrite-2']);
    expect(reverseMap.size).toBe(0);
  });

  it('replaces disallowed chars (e.g. dots in MCP IDs) with underscores and records reverse map', () => {
    const tools = [mkTool('mcp.jim.vault_info'), mkTool('read_note')];
    const { tools: out, reverseMap } = sanitizeToolNames(tools);
    expect(out.map((t) => t.function.name)).toEqual(['mcp_jim_vault_info', 'read_note']);
    expect(reverseMap.get('mcp_jim_vault_info')).toBe('mcp.jim.vault_info');
    expect(reverseMap.has('read_note')).toBe(false);
  });

  it('disambiguates collisions caused by sanitization', () => {
    const tools = [mkTool('mcp.jim.a_b'), mkTool('mcp.jim_a.b')];
    const { tools: out, reverseMap } = sanitizeToolNames(tools);
    expect(out.map((t) => t.function.name)).toEqual(['mcp_jim_a_b', 'mcp_jim_a_b_2']);
    expect(reverseMap.get('mcp_jim_a_b')).toBe('mcp.jim.a_b');
    expect(reverseMap.get('mcp_jim_a_b_2')).toBe('mcp.jim_a.b');
  });
});
