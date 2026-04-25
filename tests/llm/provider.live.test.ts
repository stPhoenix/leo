import { expect, it } from 'vitest';
import { LMStudioProvider } from '@/providers/lmStudioProvider';
import type { ChatMessage, StreamEvent } from '@/providers/types';
import { liveDescribe, skipIfUnreachable } from './_liveEnv';
import { makeJudge } from './_judge';

liveDescribe('live: LMStudioProvider.stream', (getCtx) => {
  it('streams tokens and a final done event for a simple question', async (t) => {
    const ctx = getCtx();
    if (skipIfUnreachable(t, ctx)) return;

    const provider = new LMStudioProvider({ endpoint: () => ctx.env.endpoint });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Answer concisely in one short sentence.' },
      { role: 'user', content: 'What is the capital of France?' },
    ];
    const { events, text } = await collectStream(
      provider,
      ctx.env.chatModel,
      messages,
      ctx.env.timeoutMs,
    );

    expect(events.some((e) => e.type === 'block_delta' && e.delta.type === 'text_delta')).toBe(
      true,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toContain('paris');
  }, 90_000);

  it('produces a judge-approved explanation for a concept prompt', async (t) => {
    const ctx = getCtx();
    if (skipIfUnreachable(t, ctx)) return;

    const provider = new LMStudioProvider({ endpoint: () => ctx.env.endpoint });
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'Explain what a hash table is in 2-3 sentences for a junior engineer.',
      },
    ];
    const { text } = await collectStream(provider, ctx.env.chatModel, messages, ctx.env.timeoutMs);

    const judge = makeJudge(provider, ctx.env.judgeModel, ctx.env.timeoutMs);
    const verdict = await judge({
      task: 'Explain what a hash table is in 2-3 sentences for a junior engineer.',
      response: text,
      rubric:
        'Response must mention key-value lookup AND (hashing OR hash function OR bucket). Must be in English, roughly 2-4 sentences, and not empty.',
    });
    if (!verdict.pass) {
      throw new Error(`judge rejected: ${verdict.reason}\n--- response ---\n${text}`);
    }
    expect(verdict.score).toBeGreaterThanOrEqual(5);
  }, 180_000);

  it('honours abort mid-stream', async (t) => {
    const ctx = getCtx();
    if (skipIfUnreachable(t, ctx)) return;

    const provider = new LMStudioProvider({ endpoint: () => ctx.env.endpoint });
    const ctl = new AbortController();
    const received: StreamEvent[] = [];
    let aborted = false;
    try {
      const iter = provider.stream(
        {
          model: ctx.env.chatModel,
          messages: [{ role: 'user', content: 'Count from 1 to 200, one number per line.' }],
        },
        ctl.signal,
      );
      for await (const ev of iter) {
        received.push(ev);
        const textDeltas = received.filter(
          (e) => e.type === 'block_delta' && e.delta.type === 'text_delta',
        );
        if (ev.type === 'block_delta' && ev.delta.type === 'text_delta' && textDeltas.length >= 2) {
          ctl.abort();
        }
      }
    } catch (err) {
      aborted = true;
      expect(String(err)).toMatch(/abort/i);
    }
    expect(received.some((e) => e.type === 'block_delta' && e.delta.type === 'text_delta')).toBe(
      true,
    );
    // Either the iterator surfaces the abort or ends cleanly after abort — both valid.
    expect(aborted || ctl.signal.aborted).toBe(true);
  }, 90_000);
});

async function collectStream(
  provider: LMStudioProvider,
  model: string,
  messages: readonly ChatMessage[],
  timeoutMs: number,
): Promise<{ events: StreamEvent[]; text: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const events: StreamEvent[] = [];
  let text = '';
  try {
    for await (const ev of provider.stream({ model, messages }, ctl.signal)) {
      events.push(ev);
      if (ev.type === 'block_delta' && ev.delta.type === 'text_delta') text += ev.delta.text;
    }
  } finally {
    clearTimeout(timer);
  }
  return { events, text };
}
