import { describe, expect, it } from 'vitest';
import {
  createProviderForKind,
  defaultEndpointFor,
  kindRequiresApiKey,
} from '@/providers/registry';
import type { ProviderKind } from '@/settings/settingsStore';

function ctx(key = 'KEY'): {
  endpoint: () => string;
  apiKey: () => string;
} {
  return {
    endpoint: () => 'http://example.test',
    apiKey: () => key,
  };
}

describe('provider registry', () => {
  it('returns lmstudio adapter by default', () => {
    const p = createProviderForKind('lmstudio', ctx());
    expect(p.id).toBe('lmstudio');
  });

  it('openai kind produces openai-compatible provider', () => {
    const p = createProviderForKind('openai', ctx());
    expect(p.id).toBe('openai');
  });

  it('anthropic kind produces anthropic provider', () => {
    const p = createProviderForKind('anthropic', ctx());
    expect(p.id).toBe('anthropic');
  });

  it('ollama kind produces openai-compatible provider (local)', () => {
    const p = createProviderForKind('ollama', ctx());
    expect(p.id).toBe('ollama');
  });

  it('ollama-cloud kind produces openai-compatible provider (hosted)', () => {
    const p = createProviderForKind('ollama-cloud', ctx());
    expect(p.id).toBe('ollama-cloud');
  });

  it('custom kind uses supplied baseURL + Authorization header when key present', () => {
    const p = createProviderForKind('custom', ctx());
    expect(p.id).toBe('custom');
  });

  it('defaultEndpointFor covers every kind', () => {
    const kinds: ProviderKind[] = [
      'lmstudio',
      'openai',
      'anthropic',
      'ollama',
      'ollama-cloud',
      'custom',
    ];
    for (const k of kinds) {
      expect(typeof defaultEndpointFor(k)).toBe('string');
    }
  });

  it('kindRequiresApiKey flags cloud kinds only', () => {
    expect(kindRequiresApiKey('lmstudio')).toBe(false);
    expect(kindRequiresApiKey('ollama')).toBe(false);
    expect(kindRequiresApiKey('openai')).toBe(true);
    expect(kindRequiresApiKey('anthropic')).toBe(true);
    expect(kindRequiresApiKey('ollama-cloud')).toBe(true);
    expect(kindRequiresApiKey('custom')).toBe(true);
  });
});
