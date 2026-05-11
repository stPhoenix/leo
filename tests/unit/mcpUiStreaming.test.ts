import { describe, expect, it } from 'vitest';
import { ChatMessageStore } from '@/chat/messageStore';
import { StreamingTurnController } from '@/chat/streamingController';
import type { StreamEvent } from '@/agent/streamEvents';
import type { ContentBlock, McpUiContent, ToolResultBlock } from '@/chat/types';

function harness() {
  const store = new ChatMessageStore();
  let pendingCb: FrameRequestCallback | null = null;
  const controller = new StreamingTurnController({
    messageStore: store,
    announce: () => undefined,
    onPhaseChange: () => undefined,
    schedulers: {
      raf: (cb) => {
        pendingCb = cb;
        return 1;
      },
      caf: () => {
        pendingCb = null;
      },
    },
  });
  return {
    store,
    controller,
    tick: (): void => {
      const cb = pendingCb;
      pendingCb = null;
      if (cb !== null) cb(performance.now());
    },
  };
}

describe('streamingController — MCP-UI tool_result block', () => {
  it('persists structured ToolResultContent with mcp_ui variant', () => {
    const h = harness();
    h.controller.startTurn('a1');
    const ui: McpUiContent = {
      type: 'mcp_ui',
      uri: 'ui://srv/widget',
      mimeType: 'text/html',
      html: '<button>Accept</button>',
    };
    const events: StreamEvent[] = [
      {
        type: 'block_start',
        index: 0,
        block: {
          type: 'tool_result',
          tool_use_id: 'call-1',
          content: [{ type: 'text', text: 'done' }, ui],
        },
      },
      { type: 'block_stop', index: 0 },
      { type: 'done' },
    ];
    for (const ev of events) h.controller.consume(ev);
    h.tick();
    const message = h.store.getSnapshot().find((r) => r.id === 'a1');
    const block = (message?.blocks ?? [])[0] as ToolResultBlock | undefined;
    expect(block?.type).toBe('tool_result');
    expect(block?.tool_use_id).toBe('call-1');
    const content = block?.content as readonly ContentBlock[];
    expect(content).toHaveLength(2);
    expect(content[0]?.type).toBe('text');
    expect(content[1]?.type).toBe('mcp_ui');
    expect((content[1] as McpUiContent).uri).toBe('ui://srv/widget');
  });

  it('falls back to empty string content when none provided (back-compat)', () => {
    const h = harness();
    h.controller.startTurn('a1');
    h.controller.consume({
      type: 'block_start',
      index: 0,
      block: { type: 'tool_result', tool_use_id: 'call-2' },
    });
    h.controller.consume({ type: 'block_stop', index: 0 });
    h.tick();
    const message = h.store.getSnapshot().find((r) => r.id === 'a1');
    const block = (message?.blocks ?? [])[0] as ToolResultBlock | undefined;
    expect(block?.content).toBe('');
  });
});
