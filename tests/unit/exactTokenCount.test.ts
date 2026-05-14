import { describe, expect, it, vi } from 'vitest';
import { createExactTokenCounter, fnv1a, hashRequest } from '@/agent/exactTokenCount';
import type { ProviderChatRequest } from '@/providers/types';

function req(over: Partial<ProviderChatRequest> = {}): ProviderChatRequest {
  return {
    model: over.model ?? 'claude-opus-4-7',
    messages: over.messages ?? [{ role: 'user', content: 'hi' }],
    ...(over.tools !== undefined ? { tools: over.tools } : {}),
  };
}

describe('fnv1a + hashRequest', () => {
  it('fnv1a is deterministic', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });

  it('hashRequest is stable across key order in tools/messages', () => {
    const r1: ProviderChatRequest = {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: { name: 'f', description: 'd', parameters: { a: 1, b: 2 } },
        },
      ],
    };
    const r2: ProviderChatRequest = {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: { name: 'f', description: 'd', parameters: { b: 2, a: 1 } },
        },
      ],
    };
    expect(hashRequest(r1)).toBe(hashRequest(r2));
  });

  it('hashRequest changes when model differs', () => {
    expect(hashRequest(req({ model: 'a' }))).not.toBe(hashRequest(req({ model: 'b' })));
  });
});

describe('createExactTokenCounter', () => {
  it('returns null when provider lacks countTokens', () => {
    expect(createExactTokenCounter({ provider: {} })).toBeNull();
  });

  it('caches identical requests (LRU hit avoids second provider call)', async () => {
    const fn = vi.fn(async () => 42);
    const counter = createExactTokenCounter({ provider: { countTokens: fn } })!;
    const r = req();
    expect(await counter.count(r)).toBe(42);
    expect(await counter.count(r)).toBe(42);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('dedupes in-flight identical requests (single provider call for concurrent waiters)', async () => {
    let resolveFn!: (n: number) => void;
    const promise = new Promise<number>((resolve) => {
      resolveFn = resolve;
    });
    const fn = vi.fn(async () => promise);
    const counter = createExactTokenCounter({ provider: { countTokens: fn } })!;
    const a = counter.count(req());
    const b = counter.count(req());
    resolveFn(99);
    expect(await a).toBe(99);
    expect(await b).toBe(99);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('different requests trigger separate provider calls', async () => {
    const fn = vi.fn(async (r: ProviderChatRequest) => (r.model === 'a' ? 1 : 2));
    const counter = createExactTokenCounter({ provider: { countTokens: fn } })!;
    expect(await counter.count(req({ model: 'a' }))).toBe(1);
    expect(await counter.count(req({ model: 'b' }))).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('LRU eviction drops oldest entry past capacity', async () => {
    const fn = vi.fn(async (r: ProviderChatRequest) => r.model.length);
    const counter = createExactTokenCounter({
      provider: { countTokens: fn },
      cacheCapacity: 2,
    })!;
    await counter.count(req({ model: 'a' }));
    await counter.count(req({ model: 'bb' }));
    await counter.count(req({ model: 'ccc' })); // evicts 'a'
    fn.mockClear();
    await counter.count(req({ model: 'a' })); // miss → re-fetch
    await counter.count(req({ model: 'ccc' })); // hit
    expect(fn).toHaveBeenCalledOnce();
  });

  it('invalidate() clears the cache', async () => {
    const fn = vi.fn(async () => 5);
    const counter = createExactTokenCounter({ provider: { countTokens: fn } })!;
    await counter.count(req());
    counter.invalidate();
    await counter.count(req());
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not cache rejections (next call retries)', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return 7;
    });
    const counter = createExactTokenCounter({ provider: { countTokens: fn } })!;
    await expect(counter.count(req())).rejects.toThrow('boom');
    expect(await counter.count(req())).toBe(7);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
