import { describe, it, expect, vi } from 'vitest';
import { TurnDispatcher } from '@/ui/chat/turnDispatcher';
import { ChatMessageStore } from '@/chat/messageStore';
import type { StreamEvent } from '@/agent/streamEvents';
import type { ContentBlock } from '@/chat/types';
import type { StreamingTurnController } from '@/chat/streamingController';

function makeController() {
  return {
    startTurn: vi.fn(() => new AbortController().signal),
    consume: vi.fn(),
    consumeIterable: vi.fn(async (iter: AsyncIterable<StreamEvent>) => {
      for await (const _ev of iter) {
        /* noop */
      }
    }),
  } as unknown as StreamingTurnController;
}

describe('TurnDispatcher.submit with attachment blocks', () => {
  it('persists blocks on the user record', async () => {
    const store = new ChatMessageStore();
    const controller = makeController();
    const blocks: readonly ContentBlock[] = [
      { type: 'text', text: 'hi' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ];
    const starter = vi.fn(async function* () {
      yield { type: 'done' } as StreamEvent;
    });
    const d = new TurnDispatcher({
      messageStore: store,
      controller,
      starter,
      nowIso: () => '2026-04-26T00:00:00Z',
    });
    d.submit('hi', { blocks });
    await new Promise((r) => setTimeout(r, 0));
    const records = store.getSnapshot();
    expect(records).toHaveLength(1);
    expect(records[0]!.role).toBe('user');
    expect(records[0]!.content).toBe('hi');
    expect(records[0]!.blocks).toEqual(blocks);
  });

  it('passes blocks as third arg of starter when present', async () => {
    const store = new ChatMessageStore();
    const controller = makeController();
    const blocks: readonly ContentBlock[] = [{ type: 'text', text: 'hi' }];
    const starter = vi.fn(async function* () {
      yield { type: 'done' } as StreamEvent;
    });
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    d.submit('hi', { blocks });
    await new Promise((r) => setTimeout(r, 0));
    expect(starter).toHaveBeenCalledTimes(1);
    const call = starter.mock.calls[0] as unknown as [string, AbortSignal, ContentBlock[]];
    expect(call[0]).toBe('hi');
    expect(call[2]).toEqual(blocks);
  });

  it('omits third arg when no blocks given', async () => {
    const store = new ChatMessageStore();
    const controller = makeController();
    const starter = vi.fn(async function* () {
      yield { type: 'done' } as StreamEvent;
    });
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    d.submit('hi');
    await new Promise((r) => setTimeout(r, 0));
    expect(starter).toHaveBeenCalledTimes(1);
    const call = starter.mock.calls[0] as unknown as unknown[];
    expect(call.length).toBe(2);
  });

  it('allows submit with only blocks (empty text)', async () => {
    const store = new ChatMessageStore();
    const controller = makeController();
    const blocks: readonly ContentBlock[] = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ];
    const starter = vi.fn(async function* () {
      yield { type: 'done' } as StreamEvent;
    });
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    d.submit('', { blocks });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getSnapshot()).toHaveLength(1);
  });
});
