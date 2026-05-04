import { describe, it, expect, vi } from 'vitest';
import { makeAnthropicFetchPatch } from '@/providers/anthropicFetchPatch';

function makeUnderlyingSpy(): {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const f = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    calls.push({ url, init });
    return new Response('ok', { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

describe('anthropicFetchPatch', () => {
  it('passes through non-/v1/messages requests unchanged', async () => {
    const { fetch: under, calls } = makeUnderlyingSpy();
    const patched = makeAnthropicFetchPatch({
      betas: ['advanced-tool-use-2025-11-20'],
      deferLoading: new Set(['mcp.x.y']),
      underlying: under,
    });
    await patched('https://api.anthropic.com/v1/models', { method: 'GET' });
    expect(calls.length).toBe(1);
    expect((calls[0]!.init?.headers as Headers | undefined)?.get?.('anthropic-beta')).toBeFalsy();
  });

  it('appends anthropic-beta header for /v1/messages', async () => {
    const { fetch: under, calls } = makeUnderlyingSpy();
    const patched = makeAnthropicFetchPatch({
      betas: ['advanced-tool-use-2025-11-20'],
      deferLoading: new Set(),
      underlying: under,
    });
    await patched('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tools: [] }),
    });
    expect(calls.length).toBe(1);
    const headers = calls[0]!.init?.headers as Headers;
    expect(headers.get('anthropic-beta')).toBe('advanced-tool-use-2025-11-20');
  });

  it('preserves existing anthropic-beta header by appending', async () => {
    const { fetch: under, calls } = makeUnderlyingSpy();
    const patched = makeAnthropicFetchPatch({
      betas: ['advanced-tool-use-2025-11-20'],
      deferLoading: new Set(),
      underlying: under,
    });
    await patched('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'anthropic-beta': 'other-beta' },
      body: JSON.stringify({}),
    });
    const headers = calls[0]!.init?.headers as Headers;
    expect(headers.get('anthropic-beta')).toBe('other-beta,advanced-tool-use-2025-11-20');
  });

  it('adds defer_loading: true to matching tools by name', async () => {
    const { fetch: under, calls } = makeUnderlyingSpy();
    const patched = makeAnthropicFetchPatch({
      betas: [],
      deferLoading: new Set(['mcp.slack.post_message']),
      underlying: under,
    });
    await patched('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        tools: [
          { name: 'mcp.slack.post_message', description: 'a' },
          { name: 'Read', description: 'b' },
        ],
      }),
    });
    const sentBody = JSON.parse(calls[0]!.init!.body as string) as {
      tools: { name: string; defer_loading?: boolean }[];
    };
    expect(sentBody.tools[0]).toMatchObject({
      name: 'mcp.slack.post_message',
      defer_loading: true,
    });
    expect(sentBody.tools[1]).toMatchObject({ name: 'Read' });
    expect(sentBody.tools[1]?.defer_loading).toBeUndefined();
  });

  it('leaves body intact when not JSON', async () => {
    const { fetch: under, calls } = makeUnderlyingSpy();
    const patched = makeAnthropicFetchPatch({
      betas: ['x'],
      deferLoading: new Set(),
      underlying: under,
    });
    await patched('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: 'not-json',
    });
    expect(calls[0]!.init?.body).toBe('not-json');
  });

  it('no-op when init is undefined', async () => {
    const { fetch: under, calls } = makeUnderlyingSpy();
    const patched = makeAnthropicFetchPatch({
      betas: ['x'],
      deferLoading: new Set(),
      underlying: under,
    });
    await patched('https://api.anthropic.com/v1/messages');
    expect(calls.length).toBe(1);
    expect(calls[0]!.init).toBeUndefined();
  });
});
