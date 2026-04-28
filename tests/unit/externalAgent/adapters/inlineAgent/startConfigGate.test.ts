import { describe, expect, it } from 'vitest';
import {
  InlineAgentAdapter,
  type InlineAgentLogger,
  type ProviderFactory,
} from '@/agent/externalAgent/adapters/inlineAgent';

const noopLogger: InlineAgentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const stubFactory: ProviderFactory = () => {
  throw new Error('unused');
};

async function collect(adapter: InlineAgentAdapter, config: unknown): Promise<unknown[]> {
  const ctrl = new AbortController();
  const events: unknown[] = [];
  for await (const ev of adapter.start({
    refinedAsk: 'hello',
    systemPrompt: '',
    signal: ctrl.signal,
    timeoutMs: 1000,
    config,
  })) {
    events.push(ev);
  }
  return events;
}

describe('InlineAgentAdapter.start config gating (F02)', () => {
  it('AC2 invalid providerId → error.code=invalid_provider, terminates', async () => {
    const adapter = new InlineAgentAdapter({
      providerFactory: stubFactory,
      logger: noopLogger,
      knownProviderIds: () => ['openai', 'anthropic'],
    });
    const events = await collect(adapter, { providerId: 'frobnicator', model: 'fake' });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'error',
      error: expect.objectContaining({ code: 'invalid_provider' }),
    });
  });

  it('AC3 invalid temperature → error.code=invalid_config', async () => {
    const adapter = new InlineAgentAdapter({
      providerFactory: stubFactory,
      logger: noopLogger,
    });
    const events = await collect(adapter, { providerId: 'openai', temperature: 5 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'invalid_config' },
    });
  });

  it('valid provider passes config gate; F16 graph then surfaces invalid_provider when factory throws', async () => {
    const adapter = new InlineAgentAdapter({
      providerFactory: stubFactory,
      logger: noopLogger,
    });
    const events = await collect(adapter, { providerId: 'openai', model: 'gpt-4o-mini' });
    const last = events.at(-1) as { type: string; error?: { code: string } } | undefined;
    expect(last?.type).toBe('error');
    expect(last?.error?.code).toBe('invalid_provider');
  });

  it('AC5 adapter never reads thread provider — only configured providerId is used', async () => {
    const adapter = new InlineAgentAdapter({
      providerFactory: stubFactory,
      logger: noopLogger,
      knownProviderIds: () => ['custom'],
    });
    // 'openai' is in the default list but NOT in the explicit knownProviderIds
    // override. The adapter must reject it from config — proving it does not
    // fall back to the host's provider knowledge.
    const events = await collect(adapter, { providerId: 'openai', model: 'gpt-4o-mini' });
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'invalid_provider' },
    });
  });
});
