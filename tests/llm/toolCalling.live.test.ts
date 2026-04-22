import { expect, it } from 'vitest';
import { LMStudioProvider } from '@/providers/lmStudioProvider';
import type { ChatMessage, OpenAITool, StreamEvent, ToolCallRequest } from '@/providers/types';
import { liveDescribe, skipIfUnreachable } from './_liveEnv';

const READ_NOTE_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'read_note',
    description:
      'Read the contents of a markdown note in the user vault by its vault-relative path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Vault-relative path like "Notes/Daily.md".',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
};

const GET_WEATHER_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get current weather for a city. Use when user asks about weather.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name.' },
      },
      required: ['city'],
      additionalProperties: false,
    },
  },
};

liveDescribe('live: tool-calling correctness', (getCtx) => {
  it('invokes read_note with the requested path', async (t) => {
    const ctx = getCtx();
    if (skipIfUnreachable(t, ctx)) return;

    const provider = new LMStudioProvider({ endpoint: () => ctx.env.endpoint });
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You can call tools. When the user asks to read a note, call the read_note tool with the exact path they gave. Do not answer without calling the tool.',
      },
      { role: 'user', content: 'Please read the note at path "Projects/Alpha.md".' },
    ];
    const calls = await collectToolCalls(
      provider,
      ctx.env.chatModel,
      messages,
      [READ_NOTE_TOOL],
      ctx.env.timeoutMs,
    );
    const readCall = calls.find((c) => c.name === 'read_note');
    expect(readCall, `no read_note call in ${JSON.stringify(calls)}`).toBeDefined();
    const args = JSON.parse(readCall!.argsJson) as { path?: unknown };
    expect(typeof args.path).toBe('string');
    expect(args.path).toBe('Projects/Alpha.md');
  }, 120_000);

  it('does not invoke tools on plain conversational input', async (t) => {
    const ctx = getCtx();
    if (skipIfUnreachable(t, ctx)) return;

    const provider = new LMStudioProvider({ endpoint: () => ctx.env.endpoint });
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You can call tools when needed. Only call get_weather if the user explicitly asks about weather. Otherwise reply normally.',
      },
      { role: 'user', content: 'Say hello back to me in one sentence.' },
    ];
    const { calls, text } = await collectStreamWithTools(
      provider,
      ctx.env.chatModel,
      messages,
      [GET_WEATHER_TOOL],
      ctx.env.timeoutMs,
    );
    expect(calls.length).toBe(0);
    expect(text.trim().length).toBeGreaterThan(0);
  }, 120_000);
});

async function collectToolCalls(
  provider: LMStudioProvider,
  model: string,
  messages: readonly ChatMessage[],
  tools: readonly OpenAITool[],
  timeoutMs: number,
): Promise<ToolCallRequest[]> {
  const { calls } = await collectStreamWithTools(provider, model, messages, tools, timeoutMs);
  return calls;
}

async function collectStreamWithTools(
  provider: LMStudioProvider,
  model: string,
  messages: readonly ChatMessage[],
  tools: readonly OpenAITool[],
  timeoutMs: number,
): Promise<{ calls: ToolCallRequest[]; text: string; events: StreamEvent[] }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const calls: ToolCallRequest[] = [];
  const events: StreamEvent[] = [];
  let text = '';
  try {
    for await (const ev of provider.stream({ model, messages, tools }, ctl.signal)) {
      events.push(ev);
      if (ev.type === 'tool_call') calls.push(ev.call);
      if (ev.type === 'token') text += ev.text;
    }
  } finally {
    clearTimeout(timer);
  }
  return { calls, text, events };
}
