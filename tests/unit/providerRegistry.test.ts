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

  it('google kind produces google provider', () => {
    const p = createProviderForKind('google', ctx());
    expect(p.id).toBe('google');
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
      'google',
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
    expect(kindRequiresApiKey('google')).toBe(true);
    expect(kindRequiresApiKey('ollama-cloud')).toBe(true);
    expect(kindRequiresApiKey('custom')).toBe(true);
  });

  it('defaultEndpointFor("google") returns empty (SDK default)', () => {
    expect(defaultEndpointFor('google')).toBe('');
  });

  it('ollama-cloud routes listModels through injected fetch (bypasses renderer CORS)', async () => {
    const calls: string[] = [];
    const stubFetch = async (url: string): Promise<Response> => {
      calls.push(url);
      return new Response(JSON.stringify({ data: [{ id: 'gpt-oss:120b' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const provider = createProviderForKind('ollama-cloud', {
      endpoint: () => 'https://ollama.com',
      apiKey: () => 'KEY',
      fetch: stubFetch,
    });

    const models = await provider.listModels();

    expect(calls).toEqual(['https://ollama.com/v1/models']);
    expect(models).toEqual([{ id: 'gpt-oss:120b' }]);
  });

  it('ollama-cloud routes chat stream through injected fetch (bypasses renderer CORS)', async () => {
    const calls: string[] = [];
    const sseBody =
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}\n\n' +
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';
    const stubFetch = async (url: string | URL | Request): Promise<Response> => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      calls.push(u);
      return new Response(sseBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    const provider = createProviderForKind('ollama-cloud', {
      endpoint: () => 'https://ollama.com',
      apiKey: () => 'KEY',
      fetch: stubFetch as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    });

    const ac = new AbortController();
    const events: unknown[] = [];
    for await (const ev of provider.stream(
      { model: 'gpt-oss:120b', messages: [{ role: 'user', content: 'hi' }] },
      ac.signal,
    )) {
      events.push(ev);
    }

    expect(calls).toContain('https://ollama.com/v1/chat/completions');
    expect(events.length).toBeGreaterThan(0);
  });
});
