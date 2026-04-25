import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '@/providers/anthropicProvider';

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
