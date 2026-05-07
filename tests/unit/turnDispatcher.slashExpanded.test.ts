import { describe, it, expect, vi } from 'vitest';
import { TurnDispatcher } from '@/ui/chat/turnDispatcher';
import { ChatMessageStore } from '@/chat/messageStore';
import type { StreamEvent } from '@/agent/streamEvents';
import type { ContentBlock } from '@/chat/types';
import type { StreamingTurnController } from '@/chat/streamingController';

function makeController(): StreamingTurnController {
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

describe('TurnDispatcher.submit with slashCommand opt', () => {
  it('shows typed text in the user record but sends expanded body to LLM', async () => {
    const store = new ChatMessageStore();
    const controller = makeController();
    const starter = vi.fn(async function* () {
      yield { type: 'done' } as StreamEvent;
    });
    const d = new TurnDispatcher({
      messageStore: store,
      controller,
      starter,
      nowIso: () => '2026-05-07T00:00:00Z',
    });

    d.submit('Run the foo workflow with arg: bar.', {
      slashCommand: { typed: '/foo bar', command: 'foo' },
    });
    await new Promise((r) => setTimeout(r, 0));

    const records = store.getSnapshot();
    expect(records).toHaveLength(1);
    expect(records[0]!.role).toBe('user');
    expect(records[0]!.content).toBe('/foo bar');
    expect(records[0]!.blocks).toEqual([
      {
        type: 'slash_expanded',
        command: 'foo',
        typed: '/foo bar',
        expandedBody: 'Run the foo workflow with arg: bar.',
      },
    ]);

    expect(starter).toHaveBeenCalledTimes(1);
    const call = starter.mock.calls[0] as unknown as [string, AbortSignal, ...unknown[]];
    expect(call[0]).toBe('Run the foo workflow with arg: bar.');
  });

  it('prepends slash_expanded block before attachment blocks', async () => {
    const store = new ChatMessageStore();
    const controller = makeController();
    const starter = vi.fn(async function* () {
      yield { type: 'done' } as StreamEvent;
    });
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    const attachments: readonly ContentBlock[] = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ];

    d.submit('expanded body text', {
      blocks: attachments,
      slashCommand: { typed: '/foo', command: 'foo' },
    });
    await new Promise((r) => setTimeout(r, 0));

    const record = store.getSnapshot()[0]!;
    expect(record.content).toBe('/foo');
    expect(record.blocks).toHaveLength(2);
    expect(record.blocks![0]!.type).toBe('slash_expanded');
    expect(record.blocks![1]!.type).toBe('image');

    const call = starter.mock.calls[0] as unknown as [string, AbortSignal, readonly ContentBlock[]];
    expect(call[2]).toEqual(attachments);
  });

  it('falls back to text as display when slashCommand absent', async () => {
    const store = new ChatMessageStore();
    const controller = makeController();
    const starter = vi.fn(async function* () {
      yield { type: 'done' } as StreamEvent;
    });
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    d.submit('plain text');
    await new Promise((r) => setTimeout(r, 0));
    const record = store.getSnapshot()[0]!;
    expect(record.content).toBe('plain text');
    expect(record.blocks).toBeUndefined();
  });
});
