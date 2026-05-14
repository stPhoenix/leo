import { describe, expect, it } from 'vitest';
import { resolveEmbeddingTarget } from '@/providers/embeddingResolver';
import { migrate } from '@/settings/settingsStore';

describe('resolveEmbeddingTarget', () => {
  it('inherits from chat provider when inheritFromChat is true', () => {
    const settings = migrate({
      provider: {
        kind: 'ollama',
        endpoint: 'http://localhost:11434',
        embeddingModel: 'nomic-embed-text',
      },
    });
    const t = resolveEmbeddingTarget(settings);
    expect(t).toEqual({
      kind: 'ollama',
      endpoint: 'http://localhost:11434',
      model: 'nomic-embed-text',
      apiKeyName: 'provider.ollama.apiKey',
    });
  });

  it('uses embeddingProvider fields when inheritFromChat is false', () => {
    const settings = migrate({
      provider: {
        kind: 'ollama-cloud',
        endpoint: 'https://ollama.com',
        embeddingModel: 'unused',
      },
      embeddingProvider: {
        inheritFromChat: false,
        kind: 'openai',
        endpoint: 'https://api.openai.com',
        model: 'text-embedding-3-small',
      },
    });
    const t = resolveEmbeddingTarget(settings);
    expect(t).toEqual({
      kind: 'openai',
      endpoint: 'https://api.openai.com',
      model: 'text-embedding-3-small',
      apiKeyName: 'embeddingProvider.openai.apiKey',
    });
  });

  it('toggling inheritFromChat flips the apiKeyName namespace', () => {
    const inherit = migrate({
      provider: { kind: 'openai', endpoint: 'https://api.openai.com', embeddingModel: 'e' },
    });
    expect(resolveEmbeddingTarget(inherit).apiKeyName).toBe('provider.openai.apiKey');

    const override = migrate({
      provider: { kind: 'ollama-cloud', endpoint: 'https://ollama.com' },
      embeddingProvider: {
        inheritFromChat: false,
        kind: 'openai',
        endpoint: 'https://api.openai.com',
        model: 'e',
      },
    });
    expect(resolveEmbeddingTarget(override).apiKeyName).toBe('embeddingProvider.openai.apiKey');
  });
});
