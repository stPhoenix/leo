import { describe, expect, it } from 'vitest';
import { ChatMessageStore } from '@/chat/messageStore';
import { StreamingTurnController } from '@/chat/streamingController';
import type { StreamEvent } from '@/agent/streamEvents';
import type { ContentBlock, ToolUseBlock, ThinkingBlock, TextBlock } from '@/chat/types';

interface Harness {
  readonly store: ChatMessageStore;
  readonly controller: StreamingTurnController;
  readonly tick: () => void;
  parseErrors: { toolUseIndex: number; raw: string; error: string }[];
}

function makeHarness(): Harness {
  const store = new ChatMessageStore();
  const announce = (): void => undefined;
  const onPhaseChange = (): void => undefined;
  let pendingCb: FrameRequestCallback | null = null;
  const schedulers = {
    raf: (cb: FrameRequestCallback): number => {
      pendingCb = cb;
      return 1;
    },
    caf: (): void => {
      pendingCb = null;
    },
  };
  const parseErrors: { toolUseIndex: number; raw: string; error: string }[] = [];
  const controller = new StreamingTurnController({
    messageStore: store,
    announce,
    onPhaseChange,
    schedulers,
    onParseError: (info) => parseErrors.push(info),
  });
  return {
    store,
    controller,
    tick: () => {
      const cb = pendingCb;
      pendingCb = null;
      if (cb !== null) cb(performance.now());
    },
    parseErrors,
  };
}

function blocks(store: ChatMessageStore, id: string): readonly ContentBlock[] {
  const m = store.getSnapshot().find((r) => r.id === id);
  return m?.blocks ?? [];
}

describe('StreamingTurnController — typed-block path (F02 AC1, AC2)', () => {
  it('block_start + block_delta + block_stop seeds a tool_use block with parsed input', () => {
    const h = makeHarness();
    h.controller.startTurn('a1');
    const events: StreamEvent[] = [
      { type: 'block_start', index: 0, block: { type: 'tool_use', id: 't1', name: 'Read' } },
      {
        type: 'block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"path":' },
      },
      {
        type: 'block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"a.md"}' },
      },
      { type: 'block_stop', index: 0 },
    ];
    for (const ev of events) h.controller.consume(ev);
    h.tick();
    const b = blocks(h.store, 'a1')[0] as ToolUseBlock;
    expect(b.type).toBe('tool_use');
    expect(b.name).toBe('Read');
    expect(b.input).toEqual({ path: 'a.md' });
  });

  it('parse failure on tool_use input keeps raw payload', () => {
    const h = makeHarness();
    h.controller.startTurn('a1');
    h.controller.consume({
      type: 'block_start',
      index: 0,
      block: { type: 'tool_use', id: 't1', name: 'Read' },
    });
    h.controller.consume({
      type: 'block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: 'not-json' },
    });
    h.controller.consume({ type: 'block_stop', index: 0 });
    const b = blocks(h.store, 'a1')[0] as ToolUseBlock;
    expect(b.input).toEqual({});
    expect(b.raw).toBe('not-json');
    expect(h.parseErrors.length).toBe(1);
  });

  it('text_delta on a text block appends text', () => {
    const h = makeHarness();
    h.controller.startTurn('a1');
    h.controller.consume({ type: 'block_start', index: 0, block: { type: 'text' } });
    h.controller.consume({
      type: 'block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hi ' },
    });
    h.controller.consume({
      type: 'block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'there' },
    });
    h.tick();
    const b = blocks(h.store, 'a1')[0] as TextBlock;
    expect(b.text).toBe('hi there');
  });

  it('thinking_delta + signature_delta land on thinking block', () => {
    const h = makeHarness();
    h.controller.startTurn('a1');
    h.controller.consume({ type: 'block_start', index: 0, block: { type: 'thinking' } });
    h.controller.consume({
      type: 'block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'reasoning…' },
    });
    h.controller.consume({
      type: 'block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'sig123' },
    });
    h.tick();
    const b = blocks(h.store, 'a1')[0] as ThinkingBlock;
    expect(b.thinking).toBe('reasoning…');
    expect(b.signature).toBe('sig123');
  });

  it('text-block stream populates both content and blocks[0] for legacy + new consumers', () => {
    const h = makeHarness();
    h.controller.startTurn('a1');
    h.controller.consume({ type: 'block_start', index: 0, block: { type: 'text' } });
    h.controller.consume({
      type: 'block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello ' },
    });
    h.controller.consume({
      type: 'block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'world' },
    });
    h.tick();
    const m = h.store.getSnapshot()[0]!;
    expect(m.content).toBe('hello world');
    expect((m.blocks?.[0] as TextBlock).text).toBe('hello world');
  });

  it('does not mutate when phase is cancelling', () => {
    const h = makeHarness();
    h.controller.startTurn('a1');
    h.controller.stop();
    h.controller.consume({
      type: 'block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'y' },
    });
    h.tick();
    const m = h.store.getSnapshot()[0]!;
    expect(m.content).toBe('');
  });

  it('coalesces multiple block_deltas into a single RAF flush per frame (NFR-02)', () => {
    const h = makeHarness();
    h.controller.startTurn('a1');
    h.controller.consume({ type: 'block_start', index: 0, block: { type: 'text' } });
    let updates = 0;
    h.store.subscribe(() => {
      updates += 1;
    });
    for (let i = 0; i < 100; i += 1) {
      h.controller.consume({
        type: 'block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'x' },
      });
    }
    expect(updates).toBe(0); // nothing flushed yet
    h.tick();
    expect(updates).toBe(1); // single flush
    const b = blocks(h.store, 'a1')[0] as TextBlock;
    expect(b.text).toBe('x'.repeat(100));
  });

  it('ignores progress events (handled by F08)', () => {
    const h = makeHarness();
    h.controller.startTurn('a1');
    h.controller.consume({
      type: 'progress',
      event: { kind: 'bash', toolUseId: 't1', stdout: 'hi' },
    });
    h.tick();
    expect(blocks(h.store, 'a1')).toEqual([]);
  });
});
