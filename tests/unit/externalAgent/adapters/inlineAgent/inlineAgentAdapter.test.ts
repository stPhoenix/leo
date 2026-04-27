import { describe, expect, it } from 'vitest';
import {
  InlineAgentAdapter,
  type InlineAgentLogger,
  type ProviderFactory,
  resolveSystemPrompt,
  getInlineAgentSystemPrompt,
} from '@/agent/externalAgent/adapters/inlineAgent';
import { makeScriptedAdapter } from './_fakes/fakeChatModel';
import type { ExternalEvent } from '@/agent/externalAgent/adapters/base';

function silentLogger(): InlineAgentLogger {
  return {
    debug: (): void => undefined,
    info: (): void => undefined,
    warn: (): void => undefined,
    error: (): void => undefined,
  };
}

function nullProviderFactory(): ProviderFactory {
  return (): never => ({}) as never;
}

async function collect(iter: AsyncIterable<ExternalEvent>): Promise<ExternalEvent[]> {
  const out: ExternalEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('InlineAgentAdapter — class wrapper', () => {
  it('exposes id, label, capabilities, defaultTimeoutMs, configSchema', () => {
    const a = new InlineAgentAdapter({
      providerFactory: nullProviderFactory(),
      logger: silentLogger(),
    });
    expect(a.id).toBe('inline-agent');
    expect(a.label).toBe('Inline Agent');
    expect(a.defaultTimeoutMs).toBe(300_000);
    expect(a.capabilities).toEqual({ files: true, stream: true });
    expect(a.configSchema).toBeDefined();
    // Must accept empty config (all fields default).
    expect(() => a.configSchema.parse({})).not.toThrow();
  });

  it('emits invalid_config error when config does not validate', async () => {
    const a = new InlineAgentAdapter({
      providerFactory: nullProviderFactory(),
      logger: silentLogger(),
    });
    const events = await collect(
      a.start({
        refinedAsk: 'q',
        systemPrompt: '',
        signal: new AbortController().signal,
        timeoutMs: 1_000,
        config: { providerId: 123 },
        runId: 'cfg-bad',
      }),
    );
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    if (err?.type === 'error') {
      expect(err.error.code).toBe('invalid_config');
    }
  });

  it('emits invalid_provider when providerId is not in known list', async () => {
    const a = new InlineAgentAdapter({
      providerFactory: nullProviderFactory(),
      logger: silentLogger(),
      knownProviderIds: () => ['lmstudio', 'openai'],
    });
    const events = await collect(
      a.start({
        refinedAsk: 'q',
        systemPrompt: '',
        signal: new AbortController().signal,
        timeoutMs: 1_000,
        config: { providerId: 'mystery' },
        runId: 'cfg-prov',
      }),
    );
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    if (err?.type === 'error') {
      expect(err.error.code).toBe('invalid_provider');
      expect(err.error.message).toContain('mystery');
    }
  });

  it('happy path dispatches to graph and yields done with text body', async () => {
    const adapter = new InlineAgentAdapter({
      providerFactory: nullProviderFactory(),
      logger: silentLogger(),
      chatModelAdapter: () =>
        makeScriptedAdapter([{ text: 'final body', toolCalls: [], usage: 1 }]),
    });
    const events = await collect(
      adapter.start({
        refinedAsk: 'q',
        systemPrompt: '',
        signal: new AbortController().signal,
        timeoutMs: 30_000,
        config: { providerId: 'lmstudio', routing: { mode: 'simple' } },
        runId: `iaw-${Date.now()}`,
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    const text = events.find((e) => e.type === 'text');
    expect(text).toBeDefined();
    if (text?.type === 'text') {
      expect(text.chunk).toContain('final body');
    }
  });

  it('synthesizes a runId when not provided (no throw)', async () => {
    const adapter = new InlineAgentAdapter({
      providerFactory: nullProviderFactory(),
      logger: silentLogger(),
      chatModelAdapter: () => makeScriptedAdapter([{ text: 'x', toolCalls: [], usage: 1 }]),
    });
    const events = await collect(
      adapter.start({
        refinedAsk: 'q',
        systemPrompt: '',
        signal: new AbortController().signal,
        timeoutMs: 30_000,
        config: { providerId: 'lmstudio', routing: { mode: 'simple' } },
        // intentionally no runId
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });
});

describe('resolveSystemPrompt', () => {
  it('returns built-in inline-agent prompt when override is null and host is empty', () => {
    expect(resolveSystemPrompt({ hostPrompt: '', override: null })).toBe(
      getInlineAgentSystemPrompt(),
    );
  });

  it('uses override when non-null and non-empty', () => {
    const out = resolveSystemPrompt({ hostPrompt: '', override: 'CUSTOM PROMPT' });
    expect(out).toBe('CUSTOM PROMPT');
  });

  it('joins hostPrompt + inline prompt with a blank line separator', () => {
    const out = resolveSystemPrompt({ hostPrompt: 'HOST', override: null });
    expect(out.startsWith('HOST\n\n')).toBe(true);
    expect(out.endsWith(getInlineAgentSystemPrompt())).toBe(true);
  });

  it('falls back to built-in when override is empty string', () => {
    const out = resolveSystemPrompt({ hostPrompt: '', override: '' });
    expect(out).toBe(getInlineAgentSystemPrompt());
  });
});
