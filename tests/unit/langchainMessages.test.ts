import { describe, expect, it } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { toLangchainMessages } from '@/providers/langchainMessages';

describe('toLangchainMessages', () => {
  it('maps system → SystemMessage', () => {
    const out = toLangchainMessages([{ role: 'system', content: 'You are a helpful agent.' }]);
    expect(out.length).toBe(1);
    expect(out[0]).toBeInstanceOf(SystemMessage);
    expect((out[0] as SystemMessage).content).toBe('You are a helpful agent.');
  });

  it('maps user → HumanMessage', () => {
    const out = toLangchainMessages([{ role: 'user', content: 'Hi' }]);
    expect(out[0]).toBeInstanceOf(HumanMessage);
  });

  it('maps assistant with no toolCalls → AIMessage with content only', () => {
    const out = toLangchainMessages([{ role: 'assistant', content: 'Hello there' }]);
    expect(out[0]).toBeInstanceOf(AIMessage);
    const ai = out[0] as AIMessage;
    expect(ai.content).toBe('Hello there');
    expect(ai.tool_calls?.length ?? 0).toBe(0);
  });

  it('maps assistant with toolCalls → AIMessage carrying tool_calls', () => {
    const out = toLangchainMessages([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'readNote', argsJson: '{"path":"a.md"}' }],
      },
    ]);
    const ai = out[0] as AIMessage;
    expect(ai.tool_calls?.length).toBe(1);
    expect(ai.tool_calls?.[0]?.id).toBe('t1');
    expect(ai.tool_calls?.[0]?.name).toBe('readNote');
    expect(ai.tool_calls?.[0]?.args).toEqual({ path: 'a.md' });
  });

  it('maps tool → ToolMessage with tool_call_id', () => {
    const out = toLangchainMessages([
      { role: 'tool', content: 'file contents', toolCallId: 't1', name: 'readNote' },
    ]);
    expect(out[0]).toBeInstanceOf(ToolMessage);
    const tm = out[0] as ToolMessage;
    expect(tm.tool_call_id).toBe('t1');
    expect(tm.content).toBe('file contents');
  });

  it('skips tool messages without a toolCallId', () => {
    const out = toLangchainMessages([{ role: 'tool', content: 'orphan' }]);
    expect(out.length).toBe(0);
  });

  it('handles malformed argsJson by passing empty args', () => {
    const out = toLangchainMessages([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'x', argsJson: 'not-json' }],
      },
    ]);
    const ai = out[0] as AIMessage;
    expect(ai.tool_calls?.[0]?.args).toEqual({});
  });
});
