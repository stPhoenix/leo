import { describe, expect, it, vi } from 'vitest';
import { TurnDispatcher } from '@/ui/chat/turnDispatcher';
import { ChatMessageStore } from '@/chat/messageStore';
import { StreamingTurnController } from '@/chat/streamingController';
import type { StreamEvent } from '@/providers/types';

function makeController(store: ChatMessageStore): StreamingTurnController {
  return new StreamingTurnController({
    messageStore: store,
    announce: () => undefined,
    schedulers: {
      raf: (cb) => {
        cb(0);
        return 0;
      },
      caf: () => undefined,
    },
  });
}

interface DeferredSource {
  readonly iter: AsyncIterable<StreamEvent>;
  push(ev: StreamEvent): void;
  close(): void;
}

function makeDeferredStream(): DeferredSource {
  const pending: StreamEvent[] = [];
  let resolver: ((r: IteratorResult<StreamEvent>) => void) | null = null;
  let closed = false;
  const iter: AsyncIterable<StreamEvent> = {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        if (pending.length > 0) {
          return Promise.resolve({ value: pending.shift()!, done: false });
        }
        if (closed)
          return Promise.resolve({ value: undefined as unknown as StreamEvent, done: true });
        return new Promise<IteratorResult<StreamEvent>>((r) => {
          resolver = r;
        });
      },
    }),
  };
  return {
    iter,
    push: (ev) => {
      if (resolver !== null) {
        const r = resolver;
        resolver = null;
        r({ value: ev, done: false });
      } else {
        pending.push(ev);
      }
    },
    close: () => {
      closed = true;
      if (resolver !== null) {
        const r = resolver;
        resolver = null;
        r({ value: undefined as unknown as StreamEvent, done: true });
      }
    },
  };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe('TurnDispatcher', () => {
  it('submits the first message immediately to the controller', async () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const stream = makeDeferredStream();
    const starter = vi.fn(() => stream.iter);
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    d.submit('hello');
    await flush();
    expect(starter).toHaveBeenCalledWith('hello', expect.any(Object));
    expect(controller.phase).toBe('streaming');
    expect(store.getSnapshot().find((m) => m.role === 'user')?.content).toBe('hello');
    expect(d.queueLength()).toBe(0);
    stream.push({ type: 'done' });
    stream.close();
    await flush();
  });

  it('enqueues subsequent submits while a turn is in flight and preserves FIFO order', async () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const streams: DeferredSource[] = [];
    const starter = vi.fn(() => {
      const s = makeDeferredStream();
      streams.push(s);
      return s.iter;
    });
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    d.submit('m1');
    d.submit('m2');
    d.submit('m3');
    await flush();
    expect(starter).toHaveBeenCalledTimes(1);
    expect(starter).toHaveBeenNthCalledWith(1, 'm1', expect.any(Object));
    expect(d.queueLength()).toBe(2);
    streams[0]!.push({ type: 'done' });
    streams[0]!.close();
    await flush();
    await flush();
    expect(starter).toHaveBeenCalledTimes(2);
    expect(starter).toHaveBeenNthCalledWith(2, 'm2', expect.any(Object));
    expect(d.queueLength()).toBe(1);
    streams[1]!.push({ type: 'done' });
    streams[1]!.close();
    await flush();
    await flush();
    expect(starter).toHaveBeenCalledTimes(3);
    expect(starter).toHaveBeenNthCalledWith(3, 'm3', expect.any(Object));
  });

  it('auto-flushes the queue on done / cancelled / error terminal events', async () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const streams: DeferredSource[] = [];
    const starter = vi.fn(() => {
      const s = makeDeferredStream();
      streams.push(s);
      return s.iter;
    });
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    d.submit('a');
    d.submit('b');
    d.submit('c');
    await flush();
    expect(starter).toHaveBeenCalledTimes(1);
    streams[0]!.push({ type: 'error', error: new Error('boom') });
    streams[0]!.close();
    await flush();
    await flush();
    expect(starter).toHaveBeenCalledTimes(2);
    streams[1]!.push({ type: 'done' });
    streams[1]!.close();
    await flush();
    await flush();
    expect(starter).toHaveBeenCalledTimes(3);
  });

  it('notifies subscribers on every enqueue and dequeue', async () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const streams: DeferredSource[] = [];
    const starter = (): AsyncIterable<StreamEvent> => {
      const s = makeDeferredStream();
      streams.push(s);
      return s.iter;
    };
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    const observations: number[] = [];
    d.subscribe(() => observations.push(d.queueLength()));
    d.submit('one');
    d.submit('two');
    await flush();
    streams[0]!.push({ type: 'done' });
    streams[0]!.close();
    await flush();
    await flush();
    expect(observations.length).toBeGreaterThan(0);
    expect(observations[observations.length - 1]).toBe(0);
  });

  it('unsubscribe removes the listener', () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const d = new TurnDispatcher({ messageStore: store, controller });
    const cb = vi.fn();
    const off = d.subscribe(cb);
    d.submit('x');
    const before = cb.mock.calls.length;
    off();
    d.submit('y');
    expect(cb.mock.calls.length).toBe(before);
  });

  it('commits provider-supplied usage verbatim on done', async () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const stream = makeDeferredStream();
    const d = new TurnDispatcher({
      messageStore: store,
      controller,
      starter: () => stream.iter,
    });
    d.submit('abcd');
    await flush();
    stream.push({ type: 'token', text: 'hi' });
    stream.push({ type: 'usage', input: 100, output: 200 });
    stream.push({ type: 'done' });
    stream.close();
    await flush();
    await flush();
    const record = store.getSnapshot().find((m) => m.role === 'assistant' && m.status === 'done');
    expect(record?.tokens).toEqual({ input: 100, output: 200, total: 300 });
  });

  it('falls back to len/4 estimation when the provider omits usage', async () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const stream = makeDeferredStream();
    const d = new TurnDispatcher({
      messageStore: store,
      controller,
      starter: () => stream.iter,
    });
    d.submit('hello there');
    await flush();
    stream.push({ type: 'token', text: 'ok then' });
    stream.push({ type: 'done' });
    stream.close();
    await flush();
    await flush();
    const record = store.getSnapshot().find((m) => m.role === 'assistant' && m.status === 'done');
    expect(record?.tokens).toEqual({
      input: 3,
      output: 2,
      total: 5,
      estimatedInput: true,
      estimatedOutput: true,
    });
  });

  it('commits tokens on provider error using tokens received up to the error', async () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const stream = makeDeferredStream();
    const d = new TurnDispatcher({
      messageStore: store,
      controller,
      starter: () => stream.iter,
    });
    d.submit('hello there');
    await flush();
    stream.push({ type: 'token', text: 'partial' });
    stream.push({ type: 'error', error: new Error('boom') });
    stream.close();
    await flush();
    await flush();
    const record = store.getSnapshot().find((m) => m.role === 'assistant' && m.status === 'error');
    expect(record?.tokens).toBeDefined();
    expect(record?.tokens?.estimatedInput).toBe(true);
    expect(record?.tokens?.estimatedOutput).toBe(true);
    expect(record?.tokens?.output).toBe(Math.ceil('partial'.length / 4));
  });

  it('commits tokens on Stop / cancel after partial stream', async () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const stream = makeDeferredStream();
    const d = new TurnDispatcher({
      messageStore: store,
      controller,
      starter: () => stream.iter,
    });
    d.submit('hello');
    await flush();
    stream.push({ type: 'token', text: 'partial' });
    await flush();
    controller.stop();
    stream.close();
    await flush();
    await flush();
    const record = store
      .getSnapshot()
      .find((m) => m.role === 'assistant' && m.status === 'cancelled');
    expect(record?.tokens).toBeDefined();
    expect(record?.tokens?.output).toBe(Math.ceil('partial'.length / 4));
  });

  it('dispose clears pending queue and prevents further submits', async () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const starter = vi.fn(() => makeDeferredStream().iter);
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    d.submit('one');
    d.submit('two');
    d.submit('three');
    d.dispose();
    expect(d.queueLength()).toBe(0);
    d.submit('four');
    expect(d.queueLength()).toBe(0);
  });

  it('clear drops pending turns without disposing the dispatcher', async () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const streams: DeferredSource[] = [];
    const starter = vi.fn(() => {
      const s = makeDeferredStream();
      streams.push(s);
      return s.iter;
    });
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    d.submit('a');
    d.submit('b');
    d.submit('c');
    await flush();
    expect(starter).toHaveBeenCalledTimes(1);
    expect(d.queueLength()).toBe(2);
    d.clear();
    expect(d.queueLength()).toBe(0);
    streams[0]!.push({ type: 'done' });
    streams[0]!.close();
    await flush();
    await flush();
    expect(starter).toHaveBeenCalledTimes(1);
    d.submit('d');
    await flush();
    expect(starter).toHaveBeenCalledTimes(2);
    expect(starter).toHaveBeenLastCalledWith('d', expect.any(Object));
  });

  it('clear notifies subscribers when it drops pending turns', async () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const starter = (): AsyncIterable<StreamEvent> => makeDeferredStream().iter;
    const d = new TurnDispatcher({ messageStore: store, controller, starter });
    const cb = vi.fn();
    d.submit('a');
    d.submit('b');
    await flush();
    d.subscribe(cb);
    d.clear();
    expect(cb).toHaveBeenCalled();
  });

  it('clear is a no-op when there are no pending turns', () => {
    const store = new ChatMessageStore();
    const controller = makeController(store);
    const d = new TurnDispatcher({ messageStore: store, controller });
    const cb = vi.fn();
    d.subscribe(cb);
    d.clear();
    expect(cb).not.toHaveBeenCalled();
  });
});
